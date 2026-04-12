# Agents Domain Documentation

> Use this documentation when working on the AI agents system in `src/uniffy/domains/agents/`, `src/uniffy/core/models/agents/`, `src/proto/agents/`, or `src/ui/src/features/agents/`.

The agents domain provides AI assistants that can converse with users and take actions on their behalf within the Uniffy workspace. Agents are LLM-powered (Anthropic, OpenAI, Google) and interact with other domains (notes, calendar, projects, tasks, search) through a built-in tool system. Agents never have their own identity for data access -- they always act as the human user, inheriting the exact same permissions the user has in the UI.

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

**Agents do NOT have their own identity for accessing data.** When an agent executes a tool, it uses the **human user's** `user_id` and `organization_id`. The agent acts on behalf of the user, with the exact same permissions the user has in the UI.

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

3. **Load agent config**: `AgentOperations.get_by_id(user_id, org_id, agent_id)` -- runs the canonical permission check via `BaseContentOperations._require_view` (admin bypass, ownership, BLOCKED-wins, explicit `ContentMember` rows, and `OPEN_TO_ORG` baseline).

4. **Get LLM provider**: `ProviderOperations.get_active_provider(org_id)` -- finds the first `ProviderKey` where `is_valid=True` and `is_enabled=True`, decrypts the Fernet-encrypted credential, returns an `AnthropicProvider` (or OpenAI/Google) instance.

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

10. **Session compaction**: If `message_count > 40` non-compacted messages, the oldest 30 are summarized by an LLM call into a single `role="summary"` message. The 30 originals are marked `is_compacted=True`.

11. **Load conversation context**: Up to 50 messages -- summaries first, then recent non-compacted. Converted to Anthropic message format, reconstructing `tool_use`/`tool_result` pairs.

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

Everything stays in-process, on the **same `AsyncSession`** (same database transaction). Imports are lazy (inside the executor function) to avoid circular dependencies between the `agents` domain and the target domains -- this is the one permitted exception to the "no inline imports" rule.

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

`NoteOperations.get_by_id()` inherits from `BaseContentOperations`, which runs the canonical permission check via `PermissionChecker.effective_role()`:

1. **Admin bypass**: Org OWNER/ADMIN and per-domain `DomainAdmin` short-circuit to `OWNER`.
2. **Ownership**: If `user_id == note.owner_id`, effective role is `OWNER`.
3. **BLOCKED wins**: If the user has a `ContentMember` row (directly or via a group they belong to) with `role == BLOCKED`, access is denied immediately - even if they own the content.
4. **Access mode + explicit members**:
   - `OWNER_ONLY` - only the owner (above) and admins pass.
   - `EXPLICIT_MEMBERS` - user must have a non-blocked `ContentMember` row (direct or group).
   - `OPEN_TO_ORG` - every org member gets at least `baseline_role`; explicit `ContentMember` rows can elevate above it.
5. The final role is the **highest** of (direct member, group member, baseline), filtered through the `role_can_view` predicate for `get_by_id`.

If the resulting role does not satisfy `role_can_view`, `PermissionDeniedError` is raised. `ToolExecutor.execute()` catches it and returns `ToolResult(success=False, error="Permission denied: ...")`. The LLM sees the error in the tool result and explains it to the user.

### Error Handling in ToolExecutor

`ToolExecutor.execute()` catches all exceptions and converts them to `ToolResult` objects. Errors never crash the tool loop:

| Exception | Result |
|-----------|--------|
| `NotFoundError` | `ToolResult(success=False, error="Not found: ...")` |
| `PermissionDeniedError` | `ToolResult(success=False, error="Permission denied: ...")` |
| `ValidationError` | `ToolResult(success=False, error="Validation error: ...")` |
| Any other `Exception` | `ToolResult(success=False, error="Internal error: ...")` |

### Tool Loop

The tool loop runs up to `MAX_TOOL_ITERATIONS = 10` times per message:

1. LLM returns `stop_reason="tool_use"` with one or more tool calls.
2. Each tool call is executed via `ToolExecutor.execute(tool_call)`.
3. Tool results are stored in `agents_messages` with `role="tool"`.
4. Tool results are appended to `llm_messages` and the LLM is re-invoked.
5. If LLM returns more tool calls, loop continues.
6. If LLM returns `stop_reason != "tool_use"`, loop exits with the final response.
7. If 10 iterations are exceeded, `ValidationError` is raised.

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
7. Handler calls `approval_store.respond(session_id, tool_call_id, approved)` -- sets the `asyncio.Event`.
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

## Provider System

### Provider Key Model

Provider keys are Fernet-encrypted at rest in `agents_provider_keys`. Fields:
- `provider`: "anthropic", "openai", or "google"
- `credential_type`: "api_key" or "setup_token" (Claude Max OAuth)
- `encrypted_credential`: Fernet-encrypted value
- `key_hint`: masked display (e.g. "sk-...abc")
- `is_valid`, `is_enabled`: both must be true to be usable

### Active Provider Resolution

`ProviderOperations.get_active_provider(org_id)` finds the first provider key where `is_valid=True AND is_enabled=True`, decrypts the credential, and creates the appropriate provider instance.

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

When `non_compacted_message_count > 40`:

1. Fetch the oldest 30 non-summary, non-compacted messages.
2. Build conversation text and send to LLM with a summarization prompt.
3. Create a new `role="summary"` message.
4. Mark the 30 original messages as `is_compacted=True`.

`get_session_context()` always returns summaries first, then the most recent non-compacted messages (up to 50 total).

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
| Access agent config | `effective_role(user, agent)` must satisfy `role_can_view` (access_mode + baseline_role + ContentMember, with admin and BLOCKED overrides) |
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
| Org-scoped | All operations pass `organization_id` -- cross-org access is impossible |
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
