---
paths:
  - "src/uniffy/domains/agents/**/*.py"
  - "src/uniffy/core/models/agents/**/*.py"
  - "src/proto/agents/**/*.proto"
  - "src/ui/src/features/agents/**/*.ts"
  - "src/ui/src/features/agents/**/*.tsx"
---

# Agents Domain

LLM-powered assistants (Anthropic, OpenAI, Google, OpenRouter, xAI) that act on other domains through a built-in tool system. Sub-domains, each its own ConnectRPC service mounted in `factory.py`: `agents/` (CRUD), `providers/`, `runtime/` (also hosts `RuntimeSettingsService`), `sessions/`, `skills/`, `memories/`, `cron/`, `budgets/`, and `rate_limits/`; `chat_integration/` mounts its handlers on the chat service, and `tools/` (registry + builtin executors) has no service. Models in `core/models/agents/`, protos in `src/proto/agents/v1/`.

This is one of the two performance-critical domains - the backend rules' "Performance-critical domains" section applies to every change here.

## Surface split (three tiers, one domain model)

Agents are plain content rows under the generic permission model; the tiers differ only in which page hosts which controls.

| Tier | Surface | Contents |
|---|---|---|
| Chat | `/chat` | ALL conversation: 1:1 agent DMs, channel agents. Skill slash-invoke, feedback thumbs, proposed-skill draft cards, thinking/tool panes, context bar, per-DM model + params overrides. Average users never leave this tier. |
| Builder | `/agents` | **Builder-gated**: org OWNER/ADMIN or AGENTS domain admin (`require_agents_builder`, `domains/agents/access.py`; UI `useAgentsBuilderAccess` + `AgentsBuilderRoute`, nav icon hidden for non-builders). One sidebar with Agents, Skills, and Automations sections; URL-first routes (`/agents/agents/:id/:panel`, `/agents/skills/:id`, `/agents/skills/drafts`, `/agents/automations/:id`). Agent detail has 4 route-driven panels: Overview (identity + collapsed Model settings), Instructions (soul prompt + AI Builder), Capabilities (tool groups + skills), Memory. Skills edit in a full-height markdown surface. Testing happens in the AgentTestDrawer on the detail page, not in a chat surface. |
| Admin | `/admin/agents` | Org keys (the ONLY key-management surface), org usage, budgets, rate limits, currencies, skills metrics, Runtime tab (org default model, memory-bridge gate, failover/resume/deadline/circuit knobs). Members' Settings > AI holds only their own usage view and the personal memory-bridge consent toggle. |

There is no personal tier: agents, skills, automations, and provider keys are org-level resources managed by builders (keys: org admins only). Builder management is a domain-level power, not content access - agent/cron mutations gate on `require_agents_builder`, and a `ContentMembersOperations` manage override lets builders run the sharing dialog on agents they don't own (see `permissions.md`). Provider keys are not shareable content at all: they have no access policy, and any org member can use any enabled key. Chat USAGE is unchanged: any member can use an agent whose access policy allows it (`OPEN_TO_ORG` default), and model pickers keep member-readable `ListKeys`/`GetAvailableModels`.

**Cron execution identity is a security boundary.** A run executes with `execution_user_id`'s permissions, so whoever authors the prompt must own the identity it runs under: `update_cron_task` repoints `execution_user_id` + `owner_id` to the editor whenever a builder changes someone else's prompt, and `trigger_now` refuses anyone but the execution user. `AGENT_CRON_TASK` deliberately has NO manage override - handing builders member-management on a task they don't execute reopens the impersonation path. Cron tasks default to `OWNER_ONLY` and `list_cron_tasks` applies `build_accessible_filter` on the TASK even when scoped to an agent, so a per-agent listing (and the `cron.list` tool) shows only tasks the caller owns or was granted - an accessible agent does not expose its automations' prompts.

Old `/agents/chat` links redirect to `/chat`. There is no user-facing session list anywhere.

## Deletion is a retirement, not a purge

`DeleteAgent` retires: the row keeps `is_deleted=true` forever because it is also the display record for every chat message the agent sent (`SenderResolver` resolves agents by id and deliberately does NOT filter deletion). Never hard-delete an agent row outside an org purge - it would strip the name and avatar off history that users still read.

`delete_agent` fans out in one transaction: clears `is_default`, disables the agent's cron tasks (`is_enabled=false`, rows kept), deletes the org-for-one-agent memory tier (`agents_memories.agent_id = id`) and invalidates its bucket, drops the search row and the agent caches. Deliberately kept: `AgentChannelBinding` rows (per-conversation model/param config, so a restore comes back configured), agent DM channels, sessions, run logs, spend, skill usage, feedback, the S3 avatar, and memories the agent merely WROTE elsewhere (`created_by_agent_id` is provenance, the audience owns the entry).

**Soft delete is enforced where the agent ACTS, not only where it is listed.** Four gates, all required: `mention_detector.py` joins the agent row so a deleted agent yields no invocation (no run, no typing indicator); `chat_integration/operations.py::respond_to_chat_message` re-checks for the explicit-invoke path; `CronTaskOperations.get_due_tasks` joins the agent row and `trigger_now` refuses; `ChatMessageOperations.send_message` refuses a send into an agent DM whose agent is gone. A new path that makes an agent act needs the same check.

`RestoreAgent` un-deletes, re-indexes and re-caches, and leaves cron tasks disabled - a restore must never resume schedules nobody asked for. `ListAgents.deleted_only` (builder-gated) serves the builder's Deleted group; every other listing stays live-only.

Frozen agent DMs: `ChatChannel.agent_is_retired` is hydrated on `ListChannels`, `ListAgentChats` and `GetChannel`, so a client renders the read-only state instead of inferring it from an agent missing off a picker (which is also true for an agent that member simply cannot see). There is no live event for an agent deleted while a DM is open; the next load renders read-only and a send is refused by the typed error.

## Sessions are internal, not user content

`agents_sessions` rows back the test drawer, the AI Builder, and cron runs - chat channels are THE user conversation system. `SessionsService` is trimmed to what those need: CreateSession, GetSession, ListMessages, EditMessage, RetryMessage, SubmitMessageFeedback. There is deliberately no list/rename/archive/stats/compact RPC; do not add user-facing session surfaces without revisiting the sessions-vs-chat consolidation plan. `RerunFromMessage` and run streaming live on `RuntimeService`.

Test sessions: `agents_sessions.is_test` marks drawer + AI Builder sessions. Invariants:

- The runtime sets `ToolContext.is_test_session` from the session row; `memory.save` / `memory.forget` return a structured "disabled in test sessions" error before touching scope. Reads and index injection are unchanged.
- Run logs and spend are still recorded (test spend counts against budgets by design).
- Session access: user owns the session or kind is `global`.

## The identity boundary (security, not preference)

**Agents have no identity of their own for data access.** Every tool executor receives a `ToolContext` whose `user_id` is the HUMAN user from the JWT and acts with exactly that user's permissions:

```python
@dataclass
class ToolContext:
    session: AsyncSession       # shared DB session
    user_id: UUID               # the HUMAN user's ID from the JWT
    organization_id: UUID       # org scope
    agent_id: UUID | None       # used by memory tools
    is_test_session: bool       # memory write tools refuse when True
```

Tool executors call domain `*Operations` classes directly in-process (no RPC hop), on the same `AsyncSession`, so the canonical permission checks (`BaseContentOperations` -> `effective_role`, see `permissions.md`) run unchanged. An agent can never reach content its user cannot. Imports inside executor functions are lazy to break circular deps - the one permitted exception to the imports-at-top rule.

## Tool loop invariants

- `ToolExecutor.execute()` converts EVERY exception to `ToolResult(success=False, error=...)` - errors never crash the loop; the LLM sees them and recovers.
- Max `MAX_TOOL_ITERATIONS = 10` per message; exceeding raises `ValidationError`.
- Within one LLM turn, calls are partitioned by `ToolDefinition.read_only`: read-only tools fan out concurrently on fresh per-tool sessions from a small pool (each commits its own session); write tools run sequentially on the runtime session so transaction boundaries hold. New tools default `read_only=False`; flipping to True is a deliberate annotation meaning "no transaction-shared writes on the runtime session" (own-session side-effect writes like `memory.read` bumping `access_count` are fine).
- Every tool has `timeout_seconds` (default 15s; search/file reads 30s; image gen up to 300s) wrapped in `asyncio.wait_for`; timeout yields a structured error result, never a stuck event loop.
- Tool results are stored in original tool-call order regardless of read-group concurrency.
- Destructive tools (`destructive=True`: the four `*.delete_*` tools) require user approval in streaming mode via `ApprovalStore` - an in-process `asyncio.Event` store with TTL sweep. It does NOT survive restarts or span processes; durability is not part of the contract.

Adding a tool: executor in `tools/builtin/{domain}.py` -> module-level `ToolDefinition` -> export in the module tool list -> register in `tools/builtin/__init__.py:register_all()` -> add to `src/ui/src/features/agents/config/toolCatalog.ts` for the builder UI.

## Templates and the default agent

The catalog is one markdown file per template in `uniffy/data/catalog/` - frontmatter carries `key`, `order`, `name`, `emoji`, `description`, and the `tools` / `skills` lists; the body is the soul prompt. `domains/agents/templates.py` reads that directory once at import into `AGENT_TEMPLATES` (sorted by `order`; `assistant` first). Adding or retuning a template is a markdown edit - no python change.

Org bootstrap (`OrganizationOperations.create`) seeds one org-visible default agent from the assistant template: `is_default=true` (partial unique index), `OPEN_TO_ORG`, name-only - it runs once the admin sets the org default model. The create-flow gallery FETCHES the catalog over `ListAgentTemplates` (builder-gated, resolves `skills` names to bundled skill row ids server-side) into `agentTemplatesSlice`; there is no frontend copy of the catalog. Templates are prefill only - created agents are ordinary rows with no link back. `is_default` changes are org-admin-gated.

## Runtime performance rules

| Rule | Why |
|---|---|
| LLM calls stay off the request thread. | Compaction / summarisation go to ARQ with a Valkey `SET NX` idempotency lock; the request enqueues and returns. |
| Pre-flight reads go through the agent caches. | `fetch_agent_row` / `fetch_agent_skills` / `get_provider_for_key` / `SenderResolver`. A new runtime read gets a cache helper alongside. |
| Agent / skill mutations invalidate dependent caches in the same commit. | Reverse-index sets `tag:skill:{id}` hold dependent agent ids; mutations SMEMBERS + bulk-wipe, deletes drop the set; `enabled_skills` changes diff old vs new and SREM/SADD. |
| Hot-row counters gate on prior value. | `WHERE current < new_value` (or `IS NULL`) so concurrent agents race deterministically. |
| Session context size is read from provider counts, never estimated per message. | The latest non-compacted assistant row's `input_tokens` + `output_tokens` is the ground truth for active context; there is no per-message token column. |
| New runtime metrics get a label. | Without metrics a regression is invisible. |

## Caching (domains/agents/cache.py)

| Key | Contents | TTL |
|---|---|---|
| `agent:{id}` / `agent:{id}:skills` | Serialised row / resolved skills | 900s |
| `provider:key:{key_id}` | NON-SECRET routing metadata only | 3600s |
| `tag:skill:{id}` | Reverse-index sets of dependent agent ids | - |
| `agentmem:{org}:{scope}:{subject}:{agent\|all}` | Rendered memory index lines per bucket | see memories |

- Soft-deleted agents are never seeded (read path filters `is_deleted=false`).
- **Decrypted credentials MUST NOT enter Valkey.** The in-process `ProviderClientLRU` is the only place a decrypted credential lives. This is a security boundary.

## Providers

Keys are Fernet-encrypted in `agents_provider_keys` (`provider`, `key_hint`, `is_valid` + `is_enabled` both required). API keys are the only credential shape; there is no credential-type column and **no format validation** - key shapes change without notice, so the only trusted signal is the live probe (`LLMProvider.validate()`, a models-list call) run on add and on demand, whose failure lands on `is_valid` + `last_error`. A rejected key is still stored, with the error surfaced in the UI. Resolution consults two tiers before PG:

1. `ProviderClientLRU` (`providers/client_cache.py`): process singleton, 1h TTL, 256 entries - holds decrypted credential + constructed SDK client (reuses the httpx pool).
2. Valkey `provider:key:{key_id}`: non-secret routing metadata, so `get_provider_for_model` skips decrypt/construction for keys that don't own the model.

Any key mutation publishes `provider_keys:invalidate:{key_id}` and deletes the Valkey entry; a `PSUBSCRIBE` listener in app lifespan + worker startup drops the LRU entry on every pod. One signal, both tiers drop.

Key permissions: add/remove/toggle/validate = org admin only. Keys carry NO access policy - no `access_mode`, no `ContentMember` rows, no sharing dialog - so every enabled org key is usable by every org member; spend control lives in budgets and rate limits. List and model reads stay org-member so chat pickers work, but diagnostics are admin-only: `last_error` is unredacted provider/transport text, so `provider_key_to_proto` gates it behind `include_diagnostics` and the handler resolves `is_org_admin` once per RPC. A member sees `key_hint` + `is_valid` and nothing more.

Model listing is catalog-only: `ListAvailableModels` / `ListModelsForKey` read the key's PROVIDER column and project the local catalog, so they never decrypt a credential, construct an SDK client, or call a provider API. Clients cache the result per provider, not per key, and prefetch it on chat init and on the builder layout so every model dropdown opens populated. A picker must not fetch its own list on open.

Model resolution priority: session `model_override` -> agent `primary_model` -> `fallback_models` -> org default (`default_provider_key_id` + `default_chat_model` in the `agents/runtime` settings blob) -> typed `ValidationError`. There is no silent catalog pick. Every resolve site (sends, compaction workers, background analysis) goes through `runtime/model_resolver.py::resolve_provider_and_model` - do not hand-roll provider/model resolution.

The `agents/runtime` settings blob (`runtime/settings.py`) is cached in-process for 30s per org; `invalidate_runtime_settings_cache` drops only the local process's entry, so other web processes and ARQ workers converge via TTL - acceptable for these knobs, do not build pubsub invalidation for them. Writes go through `RuntimeSettingsService` (`require_org_admin` on both methods). The blob carries: org default model config, `personal_memory_bridge_enabled`, and the failover/resume/deadline/circuit knobs.

## Model parameters

The tunable knob surface is catalog-driven end to end; there is no per-model control list anywhere else.

- The catalog (`uniffy/data/models/catalog.json`, loaded by `providers/catalog/loader.py`) declares per-provider `params_base` (ParamSpec bounds for `temperature`/`top_p`/`max_tokens`), per-provider `provider_options` (escape-hatch keys like `top_k`, `parallel_tool_calls`), per-model `options` (default overrides), and per-model `unsupported_params` (knobs the model's API rejects, e.g. temperature on Claude 4.7+ and OpenAI reasoning models). The reasoning knob is DERIVED, never declared: `reasoning_levels` -> enum `["off", ...levels]`; `can_reason` without levels -> `["off", "on"]`; `"off"` always means "do not request reasoning explicitly".
- `get_parameter_schema(provider, model_id)` merges all of that into one bounded schema consumed by the frontend form (`ModelInfo.parameter_schema_json`), write-time validation (`AgentOperations.create/update` -> `validate_model_params`; switching `primary_model` auto-strips now-invalid knobs), and request building.
- Values live in TWO layers. Base: `Agent.model_params` (JSONB, `{}` = provider defaults; absent knob = provider default, schema defaults are never auto-injected). Chat override: `AgentChannelBinding.model_params_override` per (channel, agent), managed with `model_override` via the chat service's `Get/UpdateChannelAgentConfig`; writes validate against the binding's effective model (binding `model_override` else agent primary else org default, resolved through the shared resolver) and a binding model switch strips now-invalid knobs like the agent layer does. Sessions carry only a MODEL override (`AgentSession.model_override`), no params layer. `resolve_request_params(agent_params, override_params, provider, model_id)` merges binding-over-agent, then strips anything the TARGET model rejects (warn log + `AGENT_MODEL_PARAM_DROPPED_TOTAL` metric) before every `chat_completion(params=...)` call.
- Per-provider request mapping: Anthropic adaptive thinking + `output_config.effort` on models with `reasoning_levels` (legacy `enabled`+`budget_tokens` otherwise; sampling params never ride alongside thinking); OpenAI uses the RESPONSES API (`providers/openai/responses.py`, `store:false` + encrypted reasoning-item re-feed in tool loops - chat completions rejects reasoning+tools on gpt-5.4+); OpenRouter sends `extra_body.reasoning`; xAI sends nothing (grok always reasons); Google maps `thinking_level` / `thinking_budget` with `include_thoughts=True`.
- Adding a knob: declare it in `params_base` (or `provider_options`), map it in each affected provider's request builder, done - the form renders it from the schema.

## Image generation parameters

Same catalog-driven shape as the chat knobs, on a parallel set of catalog keys: per-provider `image_params_base`, per-model `image_options` / `unsupported_image_params` / `image_enums` (narrows an enum to the subset a model accepts), surfaced by `get_image_parameter_schema` as `ModelInfo.image_parameter_schema_json`.

- **The portable axis is `aspect_ratio` + `resolution`, never a pixel size.** Google and xAI speak ratios; OpenAI speaks pixels. Providers map the normalised knobs in their own request builder: `providers/openai/images.py` turns ratio + tier into a `WIDTHxHEIGHT` inside gpt-image-2's envelope (edges x16, long edge <= 3840, ratio <= 3:1, 655,360-8,294,400 px) and falls back to the three fixed sizes on gpt-image-1; Google maps `imageConfig.aspectRatio` + `imageSize`, where the **uppercase K is load-bearing** - `1k` is rejected silently and the image comes back at the default size with no error.
- **`style` is not a provider parameter** on anything we ship (only dall-e-3 had one). House style is `Agent.image_style_prompt`, appended to the tool's prompt.
- Values live in THREE layers, not two: `Agent.image_params` (builder default) -> `AgentChannelBinding.image_params_override` (per conversation) -> the LLM's own tool args, which win because "make it wide" is how users ask. `resolve_image_params` merges them, clamps to the org ceiling, then strips what the target model rejects (`AGENT_IMAGE_PARAM_DROPPED_TOTAL`).
- `ParamSpec.audience="builder"` marks a knob the builder owns (`moderation`, `output_format`, `person_generation`): stripped from the tool schema the model sees, rejected on the per-conversation override path, hidden from the chat popover. This replaces per-agent lock flags - the audience is a property of the knob.
- The org ceiling (`image_max_resolution` / `image_max_quality` in the `agents/runtime` blob) **clamps rather than rejects**, so lowering it never breaks a run that was configured under the old ceiling. It applies to the LLM's args too, which is why `ToolContext` carries the ceiling alongside the resolved params.
- **The image tool's schema is per-agent, not static.** `runtime/image_config.py::apply_image_tool_schema` swaps in `build_image_tool_schema(provider, model)` after `_resolve_tool_schemas`, so enums match the effective model and the LLM cannot emit a value the provider would 400 on. The static definition in `tools/builtin/images.py` is the no-image-model fallback.
- Cost drives the UI: resolution and quality swing the per-image price by more than an order of magnitude. `pricing.image_price_estimates` precomputes `"{ratio}|{resolution}|{quality}" -> USD` server-side (`ModelInfo.image_price_estimates_json`) so no client reimplements the size math. gpt-image models are token-metered and publish rates only for their 1K sizes, so `image_price_scales_with_pixels` scales the nearest priced entry by pixel count - those figures are estimates and render with a `~`.
- `ToolResult.metadata` rides to chat rows as `message_metadata.tool_meta`; the image tool fills it with the prompt, resolved params, file urn and cost. That is what backs the generated-image card's chips and its "Regenerate with..." menu, which calls `RuntimeService.RegenerateImage` - a direct re-execution of the tool under the CALLER's identity (quota, audit and budget all still apply), not an LLM turn. `agents_messages` has no metadata column, so the session writer accepts and drops `tool_metadata`.

## Streaming protocol

One flat `StreamEvent` dataclass + `EventType` StrEnum (`providers/base.py`) travels provider -> runtime -> proto oneof (cases named 1:1) -> clients. `match evt.type` dispatch at every hop.

- Blocks are framed `*_BLOCK_START -> *_BLOCK_DELTA -> *_BLOCK_END`, correlated by `block_id`; deltas are incremental. Clients fold per block (`agentStreamFold.ts` on web).
- **Thinking separation is a hard contract:** thinking deltas travel ONLY as `THINKING_BLOCK_*` events / `AGENT_THINKING_DELTA` on the chat stream and never enter `accumulated_content`, a row's `content`, or the text fold. `elapsed_ms` is stamped by the runtime on `THINKING_BLOCK_END`; duration is never computed from client clocks.
- The provider terminal is `MODEL_CALL_END` carrying the `CompletionResult` (stripped before forwarding; the runtime's per-run terminal is `DONE`). The tool loop consumes whole `ToolCall`s from the result; block events are display-only.
- `CompletionResult.thinking_blocks` carries provider-native reasoning for within-turn re-feed (Anthropic signature blocks; OpenAI encrypted reasoning items). In-memory only, never persisted, never cross-provider.
- Display persistence is separate: `_stream_segment` folds thinking into `[{block_id, content, elapsed_ms}]`, stored on `agents_messages.thinking` (sessions) or chat `message_metadata.thinking`, surfaced as `MessageInfo.thinking_json` and rehydrated into the panes after reload.
- Every new event variant must serialize through all three surfaces: proto converter, JSON replay codec (`SubscribeToRun` replay), and the chat translator - and chat event types must be added to `_CHANNEL_EVENT_TYPES` (see `chat-domain.md`).

## Chat replies, feedback, skills-in-chat

- A chat agent reply's row id is STABLE: the streaming placeholder row is inserted once and finalized in place (`runtime/writers.py`); chat has no regenerate flow and user edits never re-trigger a run. Anything keyed on a reply id (feedback, draft back-links) relies on this.
- Feedback is dual-target: `agents_message_feedback` holds `(agents_message_id | chat_message_id)` with an exactly-one CHECK and per-target partial unique upserts. `SessionsService.SubmitMessageFeedback` takes exactly one of `message_id` / `chat_message_id`; the chat variant gates through `ChatAccessChecker` and only rates undeleted AGENT-sent rows. Thumbs-down enqueues skill analysis (session or channel destination). The caller's rating rides `MessageInfo.feedback_rating` (sessions) and `ChatMessage.feedback_rating` (chat, populated only on history reads, never on stream fanout).
- Skill slash-invoke in chat: the composer writes `invoked_skill_id` (+ display name) into `SendMessageRequest.metadata`; `chat_integration` parses it off the trigger row's `message_metadata` and threads it into the run. Proposed-skill draft cards are chat rows with `metadata.kind="skill_draft"` written by `ChatStreamPublisher.write_skill_draft_card`.

## Sessions and compaction

- Compaction never runs on the request path: a probe of the latest non-compacted assistant row's provider-reported `input_tokens + output_tokens` enqueues ARQ `compact_session(session_id)` on overage; the worker takes a Valkey `SET NX compaction_lock:{session_id}` (5-min TTL, lock-loss is a no-op), summarises the oldest slice into a `role="summary"` row, marks originals `is_compacted=True` in one batched UPDATE. There is no manual-compaction RPC.
- Context loading returns the most recent summaries (capped at `MAX_CONTEXT_SUMMARIES`) then the most recent non-summary rows (capped at `MAX_CONTEXT_RECENT_MESSAGES`); sizing is row-count based since provider token counts exist only on assistant rows. The compaction worker keeps the active set bounded.
- If the worker hasn't caught up, `apply_emergency_truncation` drops oldest `role="tool"` rows in-memory; `_build_llm_messages` synthesises an "interrupted" tool_result for any orphaned `tool_use` id.
- Channel-scoped (chat) agent compaction is a separate path (`chat_integration/context.py`); the runtime writer is a no-op for chat destinations.

## Skills and memories

- Skills are markdown snippets in `agents_skills`, injected into the system prompt. Sources: `bundled` (read-only, shipped) and `organization` (builders manage).
- **Bundled skills are a projection of `uniffy/data/skills/*.md`, not seed data** - `db/bundled_skills.py::sync_bundled_skills()` follows the project-into-rows contract in `backend.md` (every boot, own lock, before `seed_initial_data`, fixed ids in the files, retire never delete). Agent-specific consequences: bundled rows are global (`organization_id IS NULL`), so a new org needs NO per-org seeding and `list_skills` / `get_skills_for_agent` reach them through `organization_id == org OR organization_id IS NULL`. A retired skill leaves `get_skills_for_agent` alone, so an agent that already enabled it keeps working. `SkillOperations.resolve_bundled_skill_id_map` is the name-to-id hop the template catalog and org bootstrap share. Enabled per agent via `enabled_skills` + `always_active`. Skill drafts are an org-wide builder review inbox: anyone's thumbs-down or an agent's `skills.propose_skill` raises a draft (`propose_skill_draft` is deliberately ungated), but list/save/discard are builder-only and drafts always publish as organization skills; the draft row's `owner_id` is provenance only. Because that write is ungated it carries its own bounds - field caps, `has_hard_injection`, and `MAX_PENDING_DRAFTS_PER_USER` - so a member cannot flood the inbox or park injection markers in front of a reviewer. Any new ungated write here needs the same treatment.
- Memory tools are exactly `memory.save`, `memory.read`, `memory.forget`. `memory.read` takes `key` (exact) or `query` (search) and bumps `access_count` on returned rows (the sanctioned read_only exception).
- **A memory row has two axes: the audience (`scope` = user/channel/session/org plus its subject) and the agent binding (`agent_id`).** `agent_id IS NULL` means every agent that reaches the audience shares the entry, and a CHECK constraint allows a non-null binding ONLY on org scope. So there is one personal store per member (not per agent), one store per channel and per session, plus two org tiers: org-general and org-for-one-agent. `created_by_agent_id` records which agent wrote an entry - provenance, not visibility. `MemoryScopeRef` (scope, subject, agent) identifies a bucket end to end; build it with `MemoryScopeRef.user/channel/session/org`, and it raises if a non-org scope is handed an agent.
- The audience is resolved by the runtime from the surface (`_resolve_memory_scope`): personal scope ONLY for direct/cron sessions and 1:1 agent DMs; group/global sessions and channels get their shared subject's scope. This routing is a security boundary - a run must never read or write another audience's entries; tools error out when `ToolContext.memory_scope` is missing rather than falling back to personal. One consent exception: the personal-memory bridge (`memories/bridge.py`, per-user opt-in row + `personal_memory_bridge_enabled` org gate) widens the READ set of shared-space runs the opted-in user triggers with their own user scope (`ToolContext.memory_bridge_scope`); it never affects writes.
- A tool write targets the surface bucket by default and can never create an agent-private entry. `memory.save` takes an `audience` param for when the user names one: `organization` writes org-GENERAL memory only when the requesting HUMAN passes `is_agents_builder` (the same gate as the UI - the agent carries no identity of its own) and otherwise returns a structured refusal; `personal` outside a private 1:1 surface refuses likewise. A named audience must never silently degrade to the surface bucket. The org-for-one-agent tier stays tool-read-only, and `memory.forget` reaches only the surface bucket. Reads span surface + both org tiers (+ the bridge bucket when it applies).
- Prompt injection has a static and a dynamic half. Static (system prompt, cached): `_build_memory_context` renders org-general, org-for-this-agent, and the surface bucket as `key (category): description` lines via the `agentmem:{org}:{scope}:{subject}:{agent|all}` Valkey cache; full content enters the system prompt only through the human-pinned tier (pin caps 5 entries / 2000 chars, pinning is UI-only, never tool-settable). Every memory mutation invalidates the index cache in the same operation.
- Dynamic recall (`memories/recall.py` + `scoring.py`): each run scores the trigger message (plus the last two prior user turns) against the read set MINUS the bridge bucket with `word_similarity(unaccent(...))` OR-ed with escaped `ILIKE` - never `similarity()`, which underscores CJK substring matches. The trigram haystack is key + description + a 128-char content prefix and the query is capped at 256 chars - `word_similarity` cost scales with both lengths, and full 4KB bodies measured ~650ms per message at quota versus ~86ms worst / <5ms typical with the caps. Full-content search lives only in `memory.read` query mode. Top 3 entries / 800 chars ride the trigger user's turn in a nonce-delimited block; overflow surfaces as key-only pointers. The block is ephemeral (assembled per request in `llm_messages`, never persisted, never streamed) so it stays out of the provider prompt cache prefix. Invariants: scoring only ADDS - it never gates or reorders the static index (cross-lingual recall depends on the model reading the index); the bridge bucket is pull-only via `memory.read`; tool-written `instructions`-category entries never auto-promote; recall fails open (an error just means no block).
- Write-path hygiene: `_validate_entry_fields` strips Unicode control/format characters (zero-width, bidi, tag block) so the UI and the model read the same bytes; every memory search path escapes LIKE metacharacters (`sanitize.py::escape_like`); rendered recall content is stripped of delimiter-shaped text.
- Memory quotas: 300 entries per bucket, 4000-char content, description required (it is the index hook). `memory.forget` refuses pinned rows; org scope (both tiers) is mutable only by builders (`require_agents_builder`).
- Surfaces follow ownership: the builder's Memory panel lists ORG scope in its two tiers, and a member manages their one personal store in Settings > AI (`PersonalMemorySection`, no agent picker). `_require_view` already refuses `subject_id != user_id` on USER scope, so no surface can browse another member's memories - the split keeps the UI honest about that, it does not create it.

## System prompt

`runtime/prompt.py::build_system_prompt` assembles: agent identity, `soul_prompt` (the single user-editable instruction layer), `runtime/workspace_prompt.py::WORKSPACE_PROMPT` (appended to EVERY prompt; the text is `uniffy/data/prompts/workspace.md`, read once at import), skills, invoked skill, memory index, tool notes, workspace context. There is no prompts domain and no prompt template rows.

## Key files

| File | Purpose |
|---|---|
| `domains/agents/access.py` | `is_agents_builder` / `require_agents_builder` gate |
| `domains/agents/runtime/operations.py` | Orchestration: `send_message` + `stream_send_message` |
| `domains/agents/runtime/prompt.py` | System prompt assembly |
| `domains/agents/runtime/model_resolver.py` | Shared provider/model resolution (org default tier) |
| `domains/agents/runtime/settings.py` + `settings_handlers.py` | Org runtime settings blob + admin write surface |
| `domains/agents/runtime/approvals.py` | In-memory approval store |
| `uniffy/data/` | ALL shipped content: `catalog/` (agent templates), `skills/`, `prompts/`, `models/catalog.json`, `assets/` |
| `core/data_files.py` | `DATA_DIR` + the frontmatter reader every shipped-content loader uses |
| `db/bundled_skills.py` | Boot-time sync of `data/skills/*.md` into `agents_skills` |
| `domains/agents/templates.py` | Loads `data/catalog/` into `AGENT_TEMPLATES` |
| `domains/agents/tools/{registry,executor,definitions}.py` | ToolRegistry / ToolExecutor / dataclasses |
| `domains/agents/tools/builtin/` | Built-in executors grouped by domain |
| `domains/agents/providers/operations.py` + `client_cache.py` | Key management, two-tier resolution |
| `domains/agents/sessions/operations.py` | Session store, context query, compaction, feedback |
| `domains/agents/cache.py` | Valkey helpers + reverse-index discipline |
| `src/ui/src/features/agents/components/AgentTestDrawer.tsx` | Shared test / AI Builder drawer |
| `src/ui/src/features/agents/config/toolCatalog.ts` | Frontend tool catalog |
| `src/ui/src/features/agents/store/agentTemplatesSlice.ts` | Fetched template catalog for the create flow |
