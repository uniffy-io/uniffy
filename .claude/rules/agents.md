---
paths:
  - "src/uniffy/domains/agents/**/*.py"
  - "src/uniffy/core/models/agents/**/*.py"
  - "src/proto/agents/**/*.proto"
  - "src/ui/src/features/agents/**/*.ts"
  - "src/ui/src/features/agents/**/*.tsx"
---

# Agents Domain Documentation

The agents domain provides AI assistants that can converse with users and take actions on their behalf within the Uniffy workspace. Agents are LLM-powered (Anthropic, OpenAI, Google) and interact with other domains (notes, calendar, projects, tasks, search) through a built-in tool system. Agents do not have their own identity for data access - they always act as the human user, inheriting the exact same permissions the user has in the UI.

---

## Directory Structure

The agents domain is split into 5 sub-domains, each with its own ConnectRPC service:

```
src/uniffy/domains/agents/
|-- agents/          # Agent CRUD (create, read, update, delete, list)
|-- providers/       # LLM provider abstraction (Anthropic, OpenAI, Google)
|-- runtime/         # Core message execution, streaming, tool loop
|-- sessions/        # Session and message management, compaction
|-- skills/          # Skill CRUD and injection into system prompts
|-- tools/           # Tool registry + built-in tool implementations
    |-- builtin/     # Built-in tool executors grouped by domain
    |-- definitions.py  # ToolContext, ToolResult, ToolDefinition dataclasses
    |-- executor.py     # ToolExecutor with error handling
    |-- registry.py     # Singleton ToolRegistry
```

**Models:**

```
src/uniffy/core/models/agents/
|-- agent.py         # Agent model (personality, model config, enabled tools/skills)
|-- session.py       # AgentSession model (conversation container)
|-- message.py       # AgentMessage model (user/assistant/tool/summary messages)
|-- skill.py         # AgentSkill model (markdown instructions)
|-- provider_key.py  # ProviderKey model (encrypted LLM API keys)
|-- run_log.py       # AgentRunLog model (execution analytics)
|-- memory.py        # AgentMemory model (per-agent-user key-value facts)
```

**Proto definitions:**

```
src/proto/agents/v1/
|-- agents.proto     # AgentsService (CRUD)
|-- sessions.proto   # SessionsService (sessions + messages)
|-- runtime.proto    # RuntimeService (send/stream messages, confirmations)
|-- providers.proto  # ProvidersService (key management)
|-- skills.proto     # SkillsService (CRUD)
```

---

## Services

| Service | Proto | Purpose |
|---------|-------|---------|
| `agents.v1.AgentsService` | `agents.proto` | Agent CRUD |
| `agents.v1.SessionsService` | `sessions.proto` | Session + message CRUD, context retrieval |
| `agents.v1.RuntimeService` | `runtime.proto` | Message execution (blocking + streaming), confirmations, usage stats |
| `agents.v1.ProvidersService` | `providers.proto` | LLM API key management, model listing, validation |
| `agents.v1.SkillsService` | `skills.proto` | Skill CRUD |

All 5 services are mounted in `factory.py`.

---

## Key Concepts

### Tools vs Skills vs Memories

| Aspect | Tools | Skills | Memories |
|--------|-------|--------|----------|
| What | Executable async Python functions | Markdown instruction text | Key-value facts |
| Where they go | Passed as `tools` parameter to the LLM API | Injected into the system prompt | Injected into the system prompt |
| Stored in | `ToolRegistry` (in-memory at startup) | `agents_skills` table | `agents_memories` table |
| Enabled per-agent | `agent.enabled_tools` (name list) | `agent.enabled_skills` (UUID list) | Always available via memory tools |
| User-creatable | No (built-in only) | Yes (bundled + org + personal) | Yes (via memory tools during conversation) |
| Runtime behavior | LLM decides when to call them; functions execute domain operations | Shape agent personality and behavior | Top 10 auto-loaded into every prompt |

### Agent Identity for Data Access

**Agents do not have their own identity for accessing data.** When an agent executes a tool, it uses the **human user's** `user_id` and `organization_id`. The agent acts on behalf of the user, with the exact same permissions the user has in the UI - this is a security boundary, not a performance choice.

---

## Performance-Critical: Always Apply

The agent runtime is one of the two highest-traffic paths in the system. Every change here is held to the bar described in the backend rules' "Performance-Critical Domains" section. Agent-specific patterns that have served us well:

| Rule | Why |
|---|---|
| Keep LLM calls off the request thread. | Compaction, summarisation, and any future "let's send this to the model briefly" pattern goes to ARQ with a Valkey idempotency lock. The request thread enqueues and returns. |
| Pre-flight reads go through the agent caches. | `fetch_agent_row`, `fetch_agent_skills`, `fetch_agent_prompt`, `get_provider_for_key`, the user/agent profile cache via `SenderResolver`. When you add a new runtime read, adding a cache helper alongside is a good fit. |
| Agent / skill / prompt mutations invalidate the dependent agent caches in the same commit. | Reverse-index sets `tag:skill:{skill_id}` and `tag:prompt:{prompt_id}` hold the agent ids that reference each shared row. Skill / prompt update / delete = SMEMBERS the set, bulk wipe the dependent agent caches, drop the set on delete. Agent.enabled_skills / prompt_id changes diff old vs new and SREM / SADD the matching tag sets. |
| Tool calls within a single LLM turn are partitioned read / write. | Read-only tools fan out concurrently against per-tool sessions; writes run sequentially on the runtime session. New tools default to `read_only=False` - flipping to True is a deliberate annotation. |
| Per-tool `timeout_seconds`. | Default 15s. Long-running tools opt up explicitly with a clear reason in the `ToolDefinition`. Tools that have no upper bound on duration (open-ended search, image gen against a slow provider) live with 30-300s ceilings; if they exceed that, the LLM sees a structured timeout error and recovers, not a stuck event loop. |
| Hot-row counter UPDATEs gate on the prior value. | `agent_channel_bindings.last_active_token_estimate` and any future "biggest wins" counter use `WHERE current < new_value` (or `IS NULL`) so concurrent agents in the same channel race deterministically. |
| `agents_messages.token_estimate` is populated at INSERT, never at read time. | Every writer (runtime add_message, summary insert, consolidated summary, chat-channel writer) computes the estimate via `_estimate_message_tokens` and stores it. The window-function context loader assumes the column is populated. |
| ApprovalStore is in-process and ephemeral. | TTL sweep on every `register` evicts entries older than `APPROVAL_TTL_SECONDS + 60s` and releases their waiters. Pod restarts drop pending approvals - durability is not part of the contract here. |
| New agent-runtime metrics get a label. | LRU hit ratio, compaction lag, tool timeout count, parallel-tool concurrency. Without metrics a regression is invisible. |

---

## Message Execution Flow

When a user sends a message to an agent, the following happens. This applies to both `send_message` (blocking) and `stream_send_message` (streaming). The streaming path yields events at each stage.

### Phase 1: Pre-flight Checks

```
RuntimeHandlers.stream_send_message (handler)
  -> extracts user_id from JWT
  -> creates RuntimeOperations(AsyncSession)
  -> calls ops.stream_send_message()
```

Inside `RuntimeOperations`:

1. **Verify org membership**: `OrganizationOperations.require_org_member(user_id, organization_id)` -- confirms the user belongs to the org. Returns membership with role.

2. **Load session**: `SessionOperations.get_session(user_id, org_id, session_id)` -- verifies the user owns the session (or it is a `global` session).

3. **Load agent config**: `AgentOperations.get_by_id(user_id, org_id, agent_id)` -- runs the canonical permission check via `BaseContentOperations._require_view` (ownership, BLOCKED-wins, explicit `ContentMember` rows, and `OPEN_TO_ORG` baseline; org/domain admins get no bypass).

4. **Get LLM provider**: `ProviderOperations.get_provider_for_key(...)` or `get_provider_for_model(...)` -- consults the in-process `ProviderClientLRU` first (decrypted credential + constructed SDK client cached for 1 hour, 256-entry cap), falls through to PG + Fernet decrypt + SDK construction on miss, writes back to the LRU. Cross-pod invalidation flows through the `provider_keys:invalidate:{key_id}` pubsub channel (every pod's subscriber drops the matching LRU entry on receipt). The non-secret routing metadata (provider, credential_type, is_valid, is_enabled, model ids) is also Valkey-cached at `provider:key:{key_id}` so multi-key fan-out for `get_provider_for_model` skips the catalog round-trip.

### Phase 2: Prompt Assembly

5. **Tool schemas**: `get_tool_registry().get_anthropic_schemas(agent.enabled_tools)` -- converts enabled tools to Anthropic API `tools` format. Only tools in `agent.enabled_tools` are included.

6. **Active skills**: `SkillOperations.get_skills_for_agent(org_id, agent.enabled_skills)` -- loads explicitly enabled skills + `always_active=True` skills. Their markdown `content` is injected into the system prompt.

7. **Memory context**: Top 10 `AgentMemory` records (sorted by `importance DESC, updated_at DESC`) for this agent+user+org.

8. **Build system prompt** via `build_system_prompt()`:
   - Soul prompt (personality/instructions)
   - Agent name
   - Current date/time
   - User info (name, role)
   - Organization name
   - Skill instruction blocks
   - Tool descriptions (natural language)
   - Memory entries
   - Workspace URN context

9. **Resolve model**: Priority chain: session `model_override` > agent `primary_model` > `fallback_models` > first available from provider catalog.

### Phase 3: Context Window Management

10. **Compaction is async**: a cheap `SUM(token_estimate)` probe on `agents_messages` runs at request time. On overage the runtime enqueues an ARQ `compact_session(session_id)` job -- it never blocks on the LLM summarisation call. The worker is idempotent via a Valkey `SET NX compaction_lock:{session_id}` lock with a 5-min TTL; concurrent enqueues are no-ops.

11. **Load conversation context**: a single window-function query (`SUM(coalesce(token_estimate, 0)) OVER (ORDER BY created_at DESC)`) returns the most recent rows whose cumulative token count fits the budget, plus the absolute latest row as a guaranteed inclusion. Summaries come first under a 20% budget cap. No Python token estimation at read time -- `token_estimate` is computed once at INSERT and stored on the row.

12. **Emergency truncation**: if the worker hasn't caught up and the loaded context is still over budget, `apply_emergency_truncation` drops the oldest `role="tool"` rows in-memory until under budget. Orphan `tool_use` blocks left on assistant messages are tolerated -- `_build_llm_messages` synthesises an "interrupted" tool_result for any unmatched id.

### Phase 4: LLM Call + Tool Execution

12. **Store user message** in `agents_messages` with `role="user"`. Yield `RuntimeMessageStoredEvent`.

13. **Call LLM**: `provider.chat_completion(messages, model, system, tools, ...)`. In streaming mode, text tokens are yielded as `RuntimeTokenEvent`.

14. **If LLM returns `stop_reason="tool_use"`**: enter the tool loop (see below).

15. **Store final assistant message**, create `AgentRunLog`, yield `RuntimeDoneEvent`.

---

## Tool Execution: How Agents Access Domain Data

### Architecture: Direct In-Process Calls, NOT RPC

Tool executors call domain `*Operations` classes **directly as Python function calls**. There is no RPC hop, no HTTP call, no serialization boundary. The call stack is:

```
RuntimeOperations (runtime/operations.py)
  -> ToolExecutor.execute() (tools/executor.py)
    -> _execute_read_note() (tools/builtin/notes.py)
      -> NoteOperations.get_by_id() (domains/notes/operations.py)
        -> PermissionChecker.effective_role + role_can_* check
        -> SQL query via AsyncSession
```

Everything stays in-process, on the **same `AsyncSession`** (same database transaction). Imports are lazy (inside the executor function) to avoid circular dependencies between the `agents` domain and the target domains - this is the one permitted exception to the "no inline imports" rule.

### ToolContext

Every tool executor receives a `ToolContext`:

```python
@dataclass
class ToolContext:
    session: AsyncSession       # shared DB session
    user_id: UUID               # the HUMAN user's ID from the JWT
    organization_id: UUID       # org scope
    agent_id: UUID | None       # the agent (used by memory tools)
```

The `user_id` is always the human user who sent the message. The agent does not have its own identity for data access.

### Example: `notes.read_note`

```python
async def _execute_read_note(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.notes.operations import NoteOperations

    note_id = UUID(args["note_id"])
    ops = NoteOperations(ctx.session)
    note = await ops.get_by_id(ctx.user_id, ctx.organization_id, note_id)
    # serialize note to JSON and return as ToolResult
```

`NoteOperations.get_by_id()` inherits from `BaseContentOperations`, which runs the canonical permission check via `PermissionChecker.effective_role()` (resolution order, capability gates, and the no-admin-bypass rule are in **`.claude/rules/permissions.md`**). The agent acts as the human user, so it gets exactly the access that user has - no more.

If the resolved role does not satisfy `role_can_view`, `PermissionDeniedError` is raised. `ToolExecutor.execute()` catches it and returns `ToolResult(success=False, error="Permission denied: ...")`. The LLM sees the error in the tool result and explains it to the user.

### Error Handling in ToolExecutor

`ToolExecutor.execute()` catches all exceptions and converts them to `ToolResult` objects. Errors never crash the tool loop:

| Exception | Result |
|-----------|--------|
| `NotFoundError` | `ToolResult(success=False, error="Not found: ...")` |
| `PermissionDeniedError` | `ToolResult(success=False, error="Permission denied: ...")` |
| `ValidationError` | `ToolResult(success=False, error="Validation error: ...")` |
| Any other `Exception` | `ToolResult(success=False, error="Internal error: ...")` |

### Tool Loop

The tool loop runs up to `MAX_TOOL_ITERATIONS = 10` times per message. Within a single LLM turn the calls are split into read-only and write groups:

1. LLM returns `stop_reason="tool_use"` with one or more tool calls.
2. Tool calls are partitioned by `ToolDefinition.read_only`. Read-only tools fan out concurrently via `asyncio.gather(return_exceptions=True)` against fresh per-tool `AsyncSession`s acquired from a small per-turn pool (`READ_TOOL_POOL_SIZE=5`); each task commits its own session. Write tools run sequentially on the runtime's own session so transaction boundaries hold.
3. Every tool call has a wall-clock cap. `ToolDefinition.timeout_seconds` (default 15s; 30s for search and file reads; 300s for image generation) wraps the executor in `asyncio.wait_for`. On `TimeoutError` the result is a structured `ToolResult(success=False, error="Tool {name} exceeded {n}s timeout")`.
4. Tool results are stored in `agents_messages` with `role="tool"`, in the original tool-call order, regardless of read-group concurrency.
5. Tool results are appended to `llm_messages` and the LLM is re-invoked.
6. If LLM returns more tool calls, the loop continues.
7. If LLM returns `stop_reason != "tool_use"`, the loop exits with the final response.
8. If 10 iterations are exceeded, `ValidationError` is raised.

A read-only tool may perform side-effect writes on its own per-tool session (e.g. `memory.recall` bumps `access_count`); the per-tool session commit makes this safe under concurrency. The `read_only` flag is a parallelism hint rather than a "no writes" promise - it means "no transaction-shared writes against the runtime session."

---

## Human-in-the-Loop Confirmation (Destructive Tools)

In **streaming mode only**, destructive tools require user approval before execution.

### Flow

1. `_stream_tool_loop` checks `tool_registry.is_destructive(tc.name)` before executing.
2. If destructive: calls `approval_store.register(session_id, tc.id)` (creates `asyncio.Event`).
3. Yields `RuntimeConfirmationRequiredEvent` to the client.
4. Calls `approval_store.wait_for_response(session_id, tc.id, timeout=120.0)`.
5. Frontend shows confirm/deny UI. User clicks approve or reject.
6. Frontend calls `RespondToConfirmation` RPC.
7. Handler calls `approval_store.respond(session_id, tool_call_id, approved)` - sets the `asyncio.Event`.
8. Waiting coroutine unblocks: if approved, execute tool. If rejected or timed out, return "Action was rejected" to the LLM.

The `ApprovalStore` is a **process-level singleton** using `asyncio.Event`. It does not survive restarts or work across multiple processes.

### Destructive Tools

| Tool | Why |
|------|-----|
| `notes.delete_note` | Permanent note deletion |
| `calendar.delete_event` | Permanent event deletion |
| `projects.delete_project` | Permanent project deletion |
| `tasks.delete_task` | Permanent task deletion |

Non-destructive tools (read, search, create, update) execute immediately without confirmation.

---

## Registered Tools (All Built-in)

| Group | Tool Name | Destructive | Calls |
|-------|-----------|-------------|-------|
| Notes | `notes.search_notes` | No | `SearchOperations.search(type_filters=["note"])` |
| Notes | `notes.read_note` | No | `NoteOperations.get_by_id()` |
| Notes | `notes.create_note` | No | `NoteOperations.create()` |
| Notes | `notes.update_note` | No | `NoteOperations.update()` |
| Notes | `notes.delete_note` | Yes | `NoteOperations.delete()` |
| Calendar | `calendar.list_events` | No | `CalendarEventOperations.get_events_in_range()` |
| Calendar | `calendar.create_event` | No | `CalendarEventOperations.create()` |
| Calendar | `calendar.update_event` | No | `CalendarEventOperations.update()` |
| Calendar | `calendar.delete_event` | Yes | `CalendarEventOperations.delete()` |
| Projects | `projects.list_projects` | No | `ProjectOperations.list_projects()` |
| Projects | `projects.create_project` | No | `ProjectOperations.create()` |
| Projects | `projects.update_project` | No | `ProjectOperations.update()` |
| Projects | `projects.delete_project` | Yes | `ProjectOperations.delete()` |
| Tasks | `tasks.list_tasks` | No | `TaskOperations.list_tasks()` |
| Tasks | `tasks.create_task` | No | `TaskOperations.create()` |
| Tasks | `tasks.update_task` | No | `TaskOperations.update()` |
| Tasks | `tasks.delete_task` | Yes | `TaskOperations.delete()` |
| Tasks | `tasks.move_task` | No | `TaskOperations.move()` |
| Search | `search.query` | No | `SearchOperations.search()` (all types) |
| People | `people.list_members` | No | `OrganizationOperations.list_members()` |
| Memory | `memory.save` | No | Upserts `AgentMemory` directly |
| Memory | `memory.recall` | No | ILIKE search on `AgentMemory.key` and `content` |
| Memory | `memory.list` | No | Lists `AgentMemory` filtered by category |
| Memory | `memory.forget` | No | Deletes `AgentMemory` by key |
| System | `system.current_time` | No | Returns the current UTC time (the prompt only carries a start-of-turn date snapshot) |

All tool executors are registered in `tools/builtin/__init__.py:register_all()`.

---

## Adding a New Tool

1. Create executor function in `tools/builtin/{domain}.py`:
   ```python
   async def _execute_my_tool(ctx: ToolContext, args: dict) -> ToolResult:
       from uniffy.domains.{domain}.operations import {Domain}Operations

       ops = {Domain}Operations(ctx.session)
       result = await ops.some_method(ctx.user_id, ctx.organization_id, ...)
       return ToolResult(success=True, data="...")
   ```

2. Create `ToolDefinition` at module level:
   ```python
   my_tool = ToolDefinition(
       name="{domain}.my_tool",
       description="Description shown to the LLM.",
       parameter_schema={...},
       executor=_execute_my_tool,
       destructive=False,  # True if destructive
   )
   ```

3. Export from the module's tool list (e.g. `MY_TOOLS: list[ToolDefinition] = [my_tool]`).

4. Register in `tools/builtin/__init__.py:register_all()`.

5. Update `src/ui/src/features/agents/config/toolCatalog.ts` to add the tool to the frontend agent builder UI.

---

## Skills System

Skills are markdown instruction snippets stored in `agents_skills`.

### Scopes

| Source | `organization_id` | `owner_id` | Who can manage |
|--------|--------------------|------------|----------------|
| `bundled` | NULL | NULL | Nobody (read-only, shipped with the app) |
| `organization` | set | NULL | Org admins |
| `personal` | set | set | The owning user |

### How Skills Are Injected

During prompt assembly, `SkillOperations.get_skills_for_agent()` fetches:
- Skills whose ID is in `agent.enabled_skills`
- Skills where `always_active=True` for the org (or bundled)

Their `content` field (markdown text) is concatenated and injected into the system prompt under "The following skill instructions are active for this session".

---

## Agent Runtime Caching

Domain helpers in `domains/agents/cache.py` cache the read-heavy pieces of the runtime pre-flight phase. All entries flow through the fail-fast Valkey ops client and inherit its 150ms deadline guard.

| Key | Contents | TTL |
|---|---|---|
| `agent:{agent_id}` | Serialised Agent row (every column the runtime reads) | 900s |
| `agent:{agent_id}:skills` | Resolved skill list (id, name, content, description, scope), ordered | 900s |
| `agent:{agent_id}:prompt` | Resolved prompt content (after `_resolve_prompt_content`) | 900s |
| `provider:key:{key_id}` | Non-secret provider routing metadata (provider, credential_type, is_valid, is_enabled, model ids) | 3600s |
| `tag:skill:{skill_id}` | Reverse-index Valkey set of agent ids that reference this skill | -- |
| `tag:prompt:{prompt_id}` | Reverse-index Valkey set of agent ids that reference this prompt | -- |

**Reverse-index discipline**: `Agent.enabled_skills` writes diff old vs new and SREM / SADD against `tag:skill:{sid}` so the set always reflects current dependencies. Same for `agent.prompt_id` against `tag:prompt:{pid}`. Skill or prompt mutations SMEMBERS the tag set, bulk-invalidate the dependent agent skill / prompt caches, and DEL the tag set on delete. The reverse-index sets share the `tag:` namespace with `cache_invalidate_by_tag`-style entries but contain agent ids, not cache keys - helpers do the SMEMBERS + bulk DEL by hand.

**Soft-deleted agents are not seeded** into the cache. The runtime read path filters on `is_deleted=false` and a soft-deleted entry would be served as if present.

**Decrypted credentials MUST NOT enter Valkey.** The in-process `ProviderClientLRU` is the only place a decrypted credential lives; its lifecycle is bounded by the pubsub invalidation channel described under "Active Provider Resolution". This is a security boundary.

---

---

## Provider System

### Provider Key Model

Provider keys are Fernet-encrypted at rest in `agents_provider_keys`. Fields:
- `provider`: "anthropic", "openai", or "google"
- `credential_type`: "api_key" or "setup_token" (Claude Max OAuth)
- `encrypted_credential`: Fernet-encrypted value
- `key_hint`: masked display (e.g. "sk-...abc")
- `is_valid`, `is_enabled`: both must be true to be usable

### Active Provider Resolution

`ProviderOperations.get_provider_for_key(...)` and `get_provider_for_model(...)` consult two cache tiers before touching PG:

1. **In-process LRU** (`domains/agents/providers/client_cache.py::ProviderClientLRU`): process singleton, `OrderedDict`-backed, 1-hour TTL, 256-entry cap. Holds the decrypted credential AND the constructed provider client so the SDK's httpx connection pool is reused across requests.
2. **Valkey metadata cache** (`provider:key:{key_id}`, TTL 3600s): non-secret routing data only - provider, credential_type, is_valid, is_enabled, available model ids. The encrypted credential MUST NOT be written to Valkey.

Cross-pod invalidation: any mutation that changes a provider key publishes `provider_keys:invalidate:{key_id}` and deletes the Valkey metadata entry. A long-lived `PSUBSCRIBE provider_keys:invalidate:*` listener (started in the FastAPI app lifespan and the worker `on_startup`) drops the matching LRU entry on receipt. Cache and pubsub are in lockstep - one signal, both tiers drop.

`get_provider_for_model` iterates active keys and uses the cached model-id list to skip decrypt + construction for any key that doesn't own the requested model. Only the matching key gets decrypted.

### Model Resolution Priority

1. Session `model_override` (if set and available from provider)
2. Agent `primary_model` (default: `claude-sonnet-4-6`)
3. First match from agent `fallback_models`
4. First available model from provider catalog
5. `ValidationError` if nothing resolves

### Thinking Levels

| Level | Budget tokens |
|-------|---------------|
| off | 0 (disabled) |
| minimal | 1,024 |
| low | 4,096 |
| medium | 10,000 |
| high | 32,000 |

Temperature is forced to 1 when thinking is enabled (Anthropic API requirement).

---

## Session Compaction

Compaction runs in the background, never on the request path.

**Trigger** (request thread, sub-millisecond): a `SUM(token_estimate)` probe over non-compacted, non-summary rows. On overage the runtime enqueues `compact_session(session_id)` via the ARQ pool and returns immediately.

**Worker** (`workers/tasks/agent_compaction.py`): acquires a Valkey `SET NX compaction_lock:{session_id}` lock with a 5-min TTL. Lock-loss is a no-op (another worker is handling it). On lock acquisition the worker opens a fresh session, loads the agent + provider, drives `SessionOperations.compact_session_if_needed`:

1. Fetch the oldest non-summary, non-compacted messages until cumulative `token_estimate` reaches a target reduction.
2. Send the slice to the LLM with a summarisation prompt.
3. Create a new `role="summary"` message; populate its `token_estimate`.
4. Mark the originals `is_compacted=True` in a single batched UPDATE.

**Emergency truncation** (`apply_emergency_truncation` in `domains/agents/sessions/operations.py`): if the worker hasn't caught up by the time the next request loads context, the runtime drops the oldest `role="tool"` rows in-memory until the active window fits the budget. Orphaned `tool_use` blocks are reconciled by `_build_llm_messages` injecting synthetic interrupted tool_results.

**Token estimate column**: `agents_messages.token_estimate` is computed by `_estimate_message_tokens` at INSERT time (every writer that adds a row populates it). The read path never re-estimates. `get_session_context` is one window-function query that returns the most recent rows whose cumulative token total fits the budget, with a guaranteed inclusion of the absolute latest row.

**Channel-scoped agent compaction** is a separate path (`domains/agents/chat_integration/context.py::ChatAgentContextOperations.compact`) that writes a `sender_type=AGENT, metadata.kind='summary'` chat message and updates `agent_channel_bindings.compaction_summary_msg_ids`. The runtime's `compact_if_needed` writer is a no-op for chat destinations - the chat-side compaction has its own trigger and worker path.

---

## Database Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `agents_agents` | `Agent` | Agent config (personality, model, tools, skills, `access_mode` + `baseline_role`) |
| `agents_sessions` | `AgentSession` | Conversation containers (kind: direct/group/global) |
| `agents_messages` | `AgentMessage` | Messages (user/assistant/tool/system/summary) |
| `agents_skills` | `AgentSkill` | Markdown instruction snippets |
| `agents_provider_keys` | `ProviderKey` | Encrypted LLM API keys |
| `agents_run_logs` | `AgentRunLog` | Execution analytics (model, tokens, duration, status) |
| `agents_memories` | `AgentMemory` | Per-agent-user key-value facts |

---

## Permission Rules Summary

| Action | Required Permission |
|--------|--------------------|
| Access agent config | `effective_role(user, agent)` must satisfy `role_can_view` (access_mode + baseline_role + ContentMember, with the BLOCKED override; org/domain admins get no bypass) |
| Access session | User owns the session OR session kind is `global` |
| Update/archive session | User must own the session |
| Tool data access | Same permissions as direct UI access (user's `user_id` is passed through) |
| Add/remove provider keys | Org admin |
| List/validate provider keys | Org member |
| Create/update/delete skills | Org admin (for org skills); owner (for personal skills) |
| Bundled skills | Read-only, cannot be modified or deleted |

---

## Security Properties

| Property | Mechanism |
|----------|-----------|
| Agent acts as the user | `ToolContext.user_id` is always the human user's ID from the JWT |
| Same permissions as UI | Tool executors call the same `*Operations` classes the RPC handlers use |
| No privilege escalation | An agent cannot access content the user cannot access |
| Destructive ops gated | `destructive=True` tools require explicit user approval in streaming mode |
| Org-scoped | All operations pass `organization_id` - cross-org access is structurally impossible |
| Tool errors contained | `ToolExecutor` catches all exceptions and returns `ToolResult(success=False)` |
| Iteration limit | Max 10 tool calls per message prevents infinite loops |
| Provider keys encrypted | Fernet-encrypted at rest, decrypted only at call time |
| Approval store is in-memory | `ApprovalStore` uses `asyncio.Event`, does not survive restarts |

---

## Key Files Quick Reference

| File | Purpose |
|------|---------|
| `domains/agents/runtime/operations.py` | Core orchestration: `send_message` + `stream_send_message` |
| `domains/agents/runtime/prompt.py` | System prompt assembly |
| `domains/agents/runtime/approvals.py` | In-memory approval store for destructive tool confirmation |
| `domains/agents/runtime/model_resolver.py` | Model resolution priority chain |
| `domains/agents/tools/registry.py` | Singleton `ToolRegistry` |
| `domains/agents/tools/executor.py` | `ToolExecutor` with error handling |
| `domains/agents/tools/definitions.py` | `ToolContext`, `ToolResult`, `ToolDefinition` dataclasses |
| `domains/agents/tools/builtin/*.py` | Built-in tool executors grouped by domain |
| `domains/agents/agents/operations.py` | Agent CRUD (extends `BaseContentOperations`) |
| `domains/agents/sessions/operations.py` | Session CRUD, message management, compaction |
| `domains/agents/providers/operations.py` | Provider key management, active provider resolution |
| `domains/agents/skills/operations.py` | Skill CRUD, agent skill resolution |
| `core/models/agents/*.py` | All database models |
| `src/ui/src/features/agents/config/toolCatalog.ts` | Frontend tool catalog for agent builder UI |
