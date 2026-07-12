---
paths:
  - "src/uniffy/domains/agents/**/*.py"
  - "src/uniffy/core/models/agents/**/*.py"
  - "src/proto/agents/**/*.proto"
  - "src/ui/src/features/agents/**/*.ts"
  - "src/ui/src/features/agents/**/*.tsx"
---

# Agents Domain

LLM-powered assistants (Anthropic, OpenAI, Google) that act on other domains through a built-in tool system. Five sub-domains, each its own ConnectRPC service mounted in `factory.py`: `agents/` (CRUD), `providers/`, `runtime/`, `sessions/`, `skills/`, plus `tools/` (registry + builtin executors). Models in `core/models/agents/`, protos in `src/proto/agents/v1/`.

This is one of the two performance-critical domains - the backend rules' "Performance-critical domains" section applies to every change here.

## The identity boundary (security, not preference)

**Agents have no identity of their own for data access.** Every tool executor receives a `ToolContext` whose `user_id` is the HUMAN user from the JWT and acts with exactly that user's permissions:

```python
@dataclass
class ToolContext:
    session: AsyncSession       # shared DB session
    user_id: UUID               # the HUMAN user's ID from the JWT
    organization_id: UUID       # org scope
    agent_id: UUID | None       # used by memory tools
```

Tool executors call domain `*Operations` classes directly in-process (no RPC hop), on the same `AsyncSession`, so the canonical permission checks (`BaseContentOperations` -> `effective_role`, see `permissions.md`) run unchanged. An agent can never reach content its user cannot. Imports inside executor functions are lazy to break circular deps - the one permitted exception to the imports-at-top rule.

## Tool loop invariants

- `ToolExecutor.execute()` converts EVERY exception to `ToolResult(success=False, error=...)` - errors never crash the loop; the LLM sees them and recovers.
- Max `MAX_TOOL_ITERATIONS = 10` per message; exceeding raises `ValidationError`.
- Within one LLM turn, calls are partitioned by `ToolDefinition.read_only`: read-only tools fan out concurrently on fresh per-tool sessions from a small pool (each commits its own session); write tools run sequentially on the runtime session so transaction boundaries hold. New tools default `read_only=False`; flipping to True is a deliberate annotation meaning "no transaction-shared writes on the runtime session" (own-session side-effect writes like `memory.recall` bumping `access_count` are fine).
- Every tool has `timeout_seconds` (default 15s; search/file reads 30s; image gen up to 300s) wrapped in `asyncio.wait_for`; timeout yields a structured error result, never a stuck event loop.
- Tool results are stored in original tool-call order regardless of read-group concurrency.
- Destructive tools (`destructive=True`: the four `*.delete_*` tools) require user approval in streaming mode via `ApprovalStore` - an in-process `asyncio.Event` store with TTL sweep. It does NOT survive restarts or span processes; durability is not part of the contract.

Adding a tool: executor in `tools/builtin/{domain}.py` -> module-level `ToolDefinition` -> export in the module tool list -> register in `tools/builtin/__init__.py:register_all()` -> add to `src/ui/src/features/agents/config/toolCatalog.ts` for the builder UI.

## Runtime performance rules

| Rule | Why |
|---|---|
| LLM calls stay off the request thread. | Compaction / summarisation go to ARQ with a Valkey `SET NX` idempotency lock; the request enqueues and returns. |
| Pre-flight reads go through the agent caches. | `fetch_agent_row` / `fetch_agent_skills` / `fetch_agent_prompt` / `get_provider_for_key` / `SenderResolver`. A new runtime read gets a cache helper alongside. |
| Agent / skill / prompt mutations invalidate dependent caches in the same commit. | Reverse-index sets `tag:skill:{id}` / `tag:prompt:{id}` hold dependent agent ids; mutations SMEMBERS + bulk-wipe, deletes drop the set; `enabled_skills` / `prompt_id` changes diff old vs new and SREM/SADD. |
| Hot-row counters gate on prior value. | `WHERE current < new_value` (or `IS NULL`) so concurrent agents race deterministically. |
| `agents_messages.token_estimate` is populated at INSERT, never at read time. | Every writer computes it via `_estimate_message_tokens`; the window-function context loader assumes it. |
| New runtime metrics get a label. | Without metrics a regression is invisible. |

## Caching (domains/agents/cache.py)

| Key | Contents | TTL |
|---|---|---|
| `agent:{id}` / `agent:{id}:skills` / `agent:{id}:prompt` | Serialised row / resolved skills / resolved prompt | 900s |
| `provider:key:{key_id}` | NON-SECRET routing metadata only | 3600s |
| `tag:skill:{id}` / `tag:prompt:{id}` | Reverse-index sets of dependent agent ids | - |

- Soft-deleted agents are never seeded (read path filters `is_deleted=false`).
- **Decrypted credentials MUST NOT enter Valkey.** The in-process `ProviderClientLRU` is the only place a decrypted credential lives. This is a security boundary.

## Providers

Keys are Fernet-encrypted in `agents_provider_keys` (`provider`, `credential_type` api_key|setup_token, `key_hint`, `is_valid` + `is_enabled` both required). Resolution consults two tiers before PG:

1. `ProviderClientLRU` (`providers/client_cache.py`): process singleton, 1h TTL, 256 entries - holds decrypted credential + constructed SDK client (reuses the httpx pool).
2. Valkey `provider:key:{key_id}`: non-secret routing metadata, so `get_provider_for_model` skips decrypt/construction for keys that don't own the model.

Any key mutation publishes `provider_keys:invalidate:{key_id}` and deletes the Valkey entry; a `PSUBSCRIBE` listener in app lifespan + worker startup drops the LRU entry on every pod. One signal, both tiers drop.

Model resolution priority: session `model_override` -> agent `primary_model` -> `fallback_models` -> first catalog model -> `ValidationError`. Thinking levels map to budget tokens in code; temperature is forced to 1 when thinking is on (Anthropic requirement).

## Sessions and compaction

- Compaction never runs on the request path: a sub-millisecond `SUM(token_estimate)` probe enqueues ARQ `compact_session(session_id)` on overage; the worker takes a Valkey `SET NX compaction_lock:{session_id}` (5-min TTL, lock-loss is a no-op), summarises the oldest slice into a `role="summary"` row, marks originals `is_compacted=True` in one batched UPDATE.
- Context loading is ONE window-function query returning the most recent rows whose cumulative `token_estimate` fits the budget (summaries first under a 20% cap, latest row guaranteed). No Python token estimation at read time.
- If the worker hasn't caught up, `apply_emergency_truncation` drops oldest `role="tool"` rows in-memory; `_build_llm_messages` synthesises an "interrupted" tool_result for any orphaned `tool_use` id.
- Channel-scoped (chat) agent compaction is a separate path (`chat_integration/context.py`); the runtime writer is a no-op for chat destinations.

## Skills and memories

- Skills are markdown snippets in `agents_skills`, injected into the system prompt. Scopes: `bundled` (read-only, shipped), `organization` (org admins manage), `personal` (owner manages). Enabled per agent via `enabled_skills` + `always_active`.
- Memories (`agents_memories`) are per-agent-user KV facts; top 10 by `importance DESC, updated_at DESC` auto-load into every prompt; managed by the memory tools during conversation.
- Session access: user owns the session or kind is `global`. Provider key add/remove = org admin; list/validate = org member.

## Key files

| File | Purpose |
|---|---|
| `domains/agents/runtime/operations.py` | Orchestration: `send_message` + `stream_send_message` |
| `domains/agents/runtime/prompt.py` | System prompt assembly (soul, skills, memories, tools, workspace context) |
| `domains/agents/runtime/approvals.py` | In-memory approval store |
| `domains/agents/tools/{registry,executor,definitions}.py` | ToolRegistry / ToolExecutor / dataclasses |
| `domains/agents/tools/builtin/` | Built-in executors grouped by domain |
| `domains/agents/providers/operations.py` + `client_cache.py` | Key management, two-tier resolution |
| `domains/agents/sessions/operations.py` | Session CRUD, context query, compaction |
| `domains/agents/cache.py` | Valkey helpers + reverse-index discipline |
| `src/ui/src/features/agents/config/toolCatalog.ts` | Frontend tool catalog |
