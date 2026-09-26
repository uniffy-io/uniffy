---
paths:
  - "src/uniffy/**/*.py"
  - "src/proto/schema/**/*.proto"
  - "src/proto/gen/python/**/*.py"
---

# Backend Patterns

Rules and load-bearing conventions for the Python backend. Domain-specific invariants live in their own rule files (`permissions.md`, `files-domain.md`, `chat-domain.md`, `calls-domain.md`, `notes-realtime.md`, `agents.md`) - this file does not duplicate them.

## Vertical slices

Each bounded context is self-contained at `src/uniffy/domains/{feature}/` or, when several cohesive
subdomains share a parent context, `src/uniffy/domains/{context}/{subdomain}/`:

```
domains/{owner}/
├── {usecase}/        # Cohesive operations, queries, projections, or RPC handlers
├── jobs/
│   ├── contracts.py  # Typed producer-facing job contract
│   └── jobs.py       # Canonical owner-defined handlers
├── operations.py     # Optional meaningful public content/use-case façade
├── service.py        # Optional service composition boundary
└── __init__.py       # Lightweight; no registration side effects
```

The shape is illustrative, not a required layer checklist. Small owners stay small; larger owners
split by aggregate or use case. Keep an `operations.py`, `handlers.py`, or `service.py` façade only
when it preserves a real public contract or composes behavior. Do not add a forwarding wrapper merely
to retain an internal import path.

Adding a new domain:

1. Define proto in `src/proto/schema/{service}/v1/{service}.proto`, run `./manage.py proto`
2. Model in `core/models/{feature}/` if needed, plus Alembic migration
3. Domain module in `domains/{feature}/`
4. Mount in `factory.py`: `app.mount("/feature.v1.FeatureService", FeatureServiceASGIApplication(service))`
5. New searchable content type: complete the Search Integration Checklist in `architecture.md`

## Dependency boundaries

- `core` is the shared application kernel and never imports `domains`. `infrastructure` owns generic
  technical adapters and never imports `domains`; domain-specific adapters stay with their owner.
  Core and domains also never import concrete search or storage adapters, or observability lifecycle
  modules; web, worker, and explicit script roots select those implementations. PostgreSQL/SQLAlchemy,
  Valkey, and owner-local Prometheus instrumentation are selected platform dependencies, so application
  owners may consume their public capabilities without speculative wrapper layers. Import Linter
  enforces the live package-graph rules from `pyproject.toml` with no exceptions. Additional
  dependency rules land only when they describe a universal ownership boundary.
- Transport is a generic delivery layer: core, domains, and infrastructure never import it, and it
  never imports product domains. `main.py`, `factory.py`, and `workers/` are process roots; reusable
  core, domain, infrastructure, and transport modules never import them.
- Domain-to-domain imports target a narrow owner-defined capability boundary named for what it
  provides, not a filename allowlist. Current examples include `directory.projection`,
  `scheduling.rooms.events`, and `chat.access`. Another domain's handlers, services, converters,
  caches, queries, and general operations are implementation details.
- Web and worker entry points perform explicit composition. Importing a package solely to trigger
  registration is not a supported integration mechanism.
- Parent namespaces group cohesive bounded contexts without flattening their subdomains. Package
  count is not an architecture quality metric.

## Core patterns

- **Async everywhere.** Database I/O goes through `AsyncSession`; the rest of the stack composes around it.
- **`BaseContentOperations`** (`core/content/base_operations.py`): extending it centralizes content
  permission gates and search-projection hooks. Mutation composition supplies a `SearchIndexer`
  explicitly when it writes a projection; read-only construction must not resolve a writer.
- **Permission checks live inside domain operations.** The full model is in `.agents/rules/permissions.md` - the single source of truth; do not re-explain it.
- **Multi-tenancy:** all content scoped to `organization_id`; users are global, memberships org-scoped. Verifying org access is part of every domain operation's contract.
- **Raise domain errors (`core/errors.py`), never leak exception text to clients.** `transport/rpc.py::DOMAIN_ERROR_CODES` maps every `UNIFFYError` subclass to its Connect code for ALL unary RPCs, so a handler without local mapping still returns the right code. Handlers may map locally for precision, but an `except Exception` block must respond with the literal `"Internal server error"` - `str(e)` in a client-facing message is a leak (the `logger.exception` line keeps the details server-side).
- **Imports at the top.** The one exception is the circular-import case in agent tool executors.
- **Dangerous APIs are lint failures.** Backend code rejects executable code, unsafe
  pickle/marshal/YAML/XML deserialization, weak cryptography, insecure TLS/SSH/network behavior,
  direct `subprocess`, shell execution, logging socket configuration, and unsafe template APIs.
  Backend lint repeats every selected Bandit rule and banned-API check with Ruff's source-level
  suppressions disabled, so inline and file-level `noqa` directives cannot waive these boundaries.
  When an external process is unavoidable, use `asyncio.create_subprocess_exec` with a fixed
  executable and separate arguments; never construct a shell command.
- **Content we ship is a file, not a literal.** Prompts, templates, catalogs and the like go in `src/uniffy/data/` (see "Shipped content"), never in a triple-quoted string or a hand-written python catalog.
- **File size:** target 300-400 lines, soft cap 500; split into sub-modules past that.
- **Type hints** on all functions; docstring discipline per `comment-discipline.md`.
- **Internal and domain vocabularies use enums or typed constants colocated with their owner.** States, actions, event kinds, selectors, and job or queue names must not be passed or compared as raw strings.
- **Raw string comparisons are boundary-only:** external protocol values, parser tokens, MIME/schema metadata, and CLI or environment inputs. Mark an intentional comparison with a narrow `# noqa: PLR2004` and a short reason; never suppress the whole file.

## Read and mutation collaborators

A `Reader` is an explicit read-side façade, not a required layer for every aggregate. Introduce
`{Aggregate}Reader` when one public operations class would otherwise mix database/permission reads
with mutations that need search writing, object-storage cleanup, call lifecycle, queues, or other
external effects. Small domains and focused query modules stay as they are when the split adds no
meaningful contract.

- A reader exposes only observation: get/list/search-candidate hydration, permission resolution, and
  pure presentation or projection metadata derivation. It never changes authoritative rows, commits
  or rolls back, writes search/storage projections, publishes realtime events, enqueues work, or calls
  a mutation lifecycle. Read-through population of a non-authoritative cache is allowed; its matching
  invalidation remains owned by mutations.
- Construct the reader with only capabilities its reads intrinsically use. Ordinary PostgreSQL content
  readers take `AsyncSession`; they do not require `SearchIndexer` or mutation-only storage/lifecycle
  dependencies. A genuine asset read may receive a read capability such as `ObjectStorage`, but that
  does not justify adding mutation methods to the reader.
- Mutation façades may inherit or compose the reader to reuse access gates and query helpers. Their
  constructor or use-case method declares every required mutation capability as a non-optional typed
  argument. Do not use `None` defaults plus a guarded property that raises after the transaction has
  started.
- Split a projection collaborator separately when post-commit search/realtime repair needs a writer
  but not the full storage-backed mutation façade. Callers use the narrowest valid collaborator:
  reader for reads, projection operations for projection work, mutation operations for writes.
- Use `reader.py` only for a meaningful aggregate read façade. Focused owner-internal query modules may
  remain beside their use case. Naming a class `Reader` does not make it a public cross-domain API;
  the narrow owner-defined boundary rule still applies.
- Tests construct readers with their minimal read dependencies and exercise mutations through their
  real required signatures. Backend `ty` lint enforces missing arguments dynamically; never add a
  call-site allowlist or suppression to make invalid mutation composition pass.

## Transaction boundaries

- An externally callable mutation owns its authoritative transaction. Domain rows and every required
  audit row commit together; a failure before that commit leaves neither fact behind.
- Reusable helpers that join a caller's transaction use a focused `stage_*` operation. A staging
  operation validates its own invariants, adds or changes its owned rows, and may flush for generated
  identifiers, but it never commits. Do not add generic `commit=False` flags.
- Search, cache invalidation, realtime publication, email, and other external effects run only after
  the authoritative commit. A required durable effect uses an owner-defined typed job contract backed
  by a PostgreSQL recovery fact; an in-memory retry or a queue call alone is not durable.
- PostgreSQL authorization facts remain authoritative when a post-commit projection or notification
  fails. Degraded external effects are logged and retried through their owner where a recovery path
  exists; they never cause a second write to weaken or roll back an already committed access fact.
- Transaction correctness is proven with behavior tests for rollback, concurrent mutation, and
  post-commit degradation. Commit-call counts may guide diagnosis but are not an architectural test.

## JSON serialization

Backend JSON goes through `uniffy.core.json_codec`; never import the stdlib `json` module in active backend code. Ruff enforces this with `TID251` (historical migrations and vendored code remain excluded).

- `dumps_bytes(...)` for Valkey, files, HTTP bodies, and any other byte-capable transport.
- `dumps_str(...)` only where the contract requires text: protobuf string fields/maps, OpenAI tool arguments, ARQ string arguments, and SQLAlchemy's JSON serializer.
- `loads(...)` accepts `str`, `bytes`, `bytearray`, and `memoryview`; catch the codec's `JSONDecodeError` alias when malformed input is expected.
- Preserve a boundary's existing shape with the codec's `default` and `option` parameters. `OPTION_INDENT_2` is the shared pretty-print option; compact output is the default.
- Do not import `orjson` directly outside `core/json_codec.py`. The wrapper is the compatibility boundary and keeps byte-versus-string choices explicit at call sites.

## Migrations

Prefer module-level enum variables over inline definitions inside `sa.Column()` - inline forms drift between migrations:

```python
from sqlalchemy.dialects import postgresql

_access_mode_enum = postgresql.ENUM(
    "OWNER_ONLY",
    "EXPLICIT_MEMBERS",
    "OPEN_TO_ORG",
    name="accessmode",
    create_type=False,
)

def upgrade() -> None:
    op.create_table(
        "my_table",
        sa.Column("access_mode", _access_mode_enum, nullable=True),
    )
```

When a migration introduces a brand new enum type, create it explicitly inside `upgrade()` first (`postgresql.ENUM(..., name="mystatus").create(op.get_bind(), checkfirst=True)`), then reference the module-level `create_type=False` variable in columns.

## Logging (loguru)

Configured in `infrastructure/observability/`; console by default, structured JSON when `LOG_FORMAT=json`.

- **Every module binds a `component` once, right after the import:**
  ```python
  from loguru import logger

  logger = logger.bind(component="agents.runtime.operations")
  ```
  The name is the dotted module path minus the top-level package. Do not repeat `component=` on each call; an explicit `component=` on one call overrides the bound value.
- **Never stdlib `exc_info=True`** - loguru silently drops it into `extra` and captures NO traceback. Inside `except` blocks:
  ```python
  logger.exception("upload failed")                  # ERROR + traceback
  logger.opt(exception=True).warning("degraded")     # other level + traceback
  ```
  A runtime patcher rescues stray `exc_info=True`, but it is a safety net - write the correct idiom.

## Settings and configuration

Exactly **two generic settings stores**. Do NOT add per-domain settings/policy/config tables (`{domain}_settings` etc.) - they fragment encryption, DEK rotation, audit, and the admin surface; we consolidated them away.

| Store | Table | Ops class | Scope | Cipher |
|---|---|---|---|---|
| Deployment | `deployment_settings` | `DeploymentSettingsOperations` | whole install | `DeploymentCipher` |
| Per-org | `org_settings` | `OrgSettingsOperations` | one tenant | `OrgCipher` |

The generic store implementations live in `core/config/settings/deployment.py` and
`core/config/settings/organization.py`.

Both are `(namespace, key) -> value` KV rows: plaintext JSONB `value`, or `value_encrypted` when `is_secret=true` (CHECK constraint enforces exclusivity).

- **Pick by scope.** Operator config (registration policy, VAPID keys, system mail relay) -> `deployment_settings`. Tenant config (per-org mail, security, MFA, call policy, agent runtime knobs) -> `org_settings`. Per-**user** preferences stay in `settings_profiles`, not the KV stores.
- **One namespace per domain** (`namespace='calls'`, `namespace='mail'`, ...), one JSON blob or key-per-setting within it.
- **Wrap the blob in a frozen dataclass with code-level defaults.** Reference: `domains/calls/policy.py::ResolvedCallPolicy`, `domains/agents/runtime/settings/operations.py::ResolvedRuntimeSettings`. The loader never returns a raw dict; a missing row resolves to defaults.
- **Secrets:** `is_secret=True` encrypts through the tenant/deployment cipher; reads are opt-in via `get_secret(...)`. The `ReEncryptingConsumer` registered per table rotates every `is_secret` row automatically. Never plaintext, never a hand-rolled shared-key Fernet path.
- **Resolution chain:** per-org row -> env default -> coded default -> typed error. Canonical: `core/mail/resolver.py`, `core/config/registration.py`.
- **Audit operator-facing writes** in the same transaction (`write_audit_event`).
- **A real table is still right** for high-cardinality, relational, or hot-path-indexed config (`permissions_org_defaults` is the reference counter-example: materialized policy, not operator config).

## Shipped content (`src/uniffy/data/`)

Content we author and ship with the build - prompts, agent templates, bundled skills, the model catalog. It is neither user data nor operator config: nobody edits it at runtime, and a release is the only thing that changes it. **All of it lives in `src/uniffy/data/{kind}/`, never in a python literal and never in a per-domain folder.** One directory means one place to look, one reader, and one packaging path (`COPY src/uniffy` ships it; it works air-gapped and self-hosters get updates on image upgrade).

| Kind | Path | Consumed by |
|---|---|---|
| Agent templates | `data/catalog/*.md` | `domains/agents/templates.py` |
| Bundled agent skills | `data/skills/*.md` | `domains/agents/skills/bundled.py` |
| Platform prompts | `data/prompts/*.md` | `domains/agents/runtime/workspace.py` |
| Model catalog | `data/models/catalog.json` | `domains/agents/providers/catalog/loader.py` |

`core/data_files.py` is the only reader: `DATA_DIR`, `load_documents(dir) -> list[DataDocument]`, and a deliberately tiny frontmatter parser (scalar `key: value` plus `- item` block lists - enough for this content, so no PyYAML dependency). Markdown-with-frontmatter is the default shape: metadata in the frontmatter, prose in the body, so prompt text stays readable and diffable instead of hiding inside a triple-quoted string.

Two consumption shapes. Pick by whether other rows must reference the content:

- **Read at import into a module constant** - the default. `WORKSPACE_PROMPT`, `AGENT_TEMPLATES`, the model catalog. No table, no migration, no seeding, no lifecycle. Editing the file and restarting is the whole update path.
- **Project into rows** only when other tables key on it (bundled skills: agents store skill ids in `enabled_skills`, usages record `skill_id`). Then the file stays the source of truth and the rows are its projection, which carries four obligations:
  - Sync on **every** boot from its own entry point with its own advisory lock, **before** `bootstrap_deployment`. Never inside the "no organizations exist" guard - that block runs once on a virgin DB, so anything seeded there never reaches an existing deployment again.
  - The file declares a **fixed id** (v7 literal, generated once and committed - `generate_id = uuid7`, there is no uuid5 anywhere). Generating ids at install time makes the same content a different entity per deployment and breaks every cross-deployment reference.
  - Upsert by that id so content edits propagate; insert-if-absent silently freezes old text forever.
  - Content removed from the repo is **retired** (a status flag the list/picker paths filter), never deleted - deleting cascades child rows and silently strips the id out of whatever referenced it.

Do not duplicate shipped content in the frontend. Expose it over an RPC (`ListAgentTemplates` is the reference) - a hand-synced TS mirror drifts the first time someone edits one side.

## Performance-critical domains

`domains/chat/` and `domains/agents/` carry the bulk of user traffic; changes there (and in what they call: `core/auth/`, `core/cache/`, `core/content/`, `core/users/`, `infrastructure/valkey/`) are held to a higher bar:

| Rule | Why |
|---|---|
| Hot non-authoritative reads go through Valkey before PG. | Authorization decisions are the measured exception: use the PostgreSQL scalar/batch permission resolvers and request-local reuse. Other cache helpers live in `domains/{x}/cache.py` / `core/{x}/cache.py`. |
| Mutations invalidate caches in the same commit. | Stale cache beats no cache. |
| Fan-out callers fetch dependencies once and thread them through. | A downstream helper that re-fetches doubles the load. |
| No `LIKE` on text columns for indexed lookups. | e.g. mention counting uses `mentioned_urns @> ARRAY[...]` against a partial GIN index. |
| Pagination caps on every growable list endpoint. | Default page 200, max 500; opaque keyset cursors; no `limit=None` back-doors. Internal full-set callers get a lean ID-only method. |
| LLM / external HTTP / unbounded loops stay off the request thread. | ARQ + Valkey `SET NX` idempotency lock keyed by the natural identifier. |
| Single-query aggregates beat UNION-per-N. | `unnest(...)` joins or batch IN clauses. |
| Batch INSERTs / UPSERTs / DELETEs. | `pg_insert.values([...]).on_conflict_do_nothing().returning(...)`, tuple-IN DELETEs. |
| Optimistic counters on hot rows. | Gate with `WHERE current < new_value` so concurrent writers race deterministically. |
| Per-call deadline on every Valkey call. | The 150ms `ops_call` guard is the contract; on miss, fall through to PG. No retry loops around cache calls. |
| Fix root causes, not symptoms. | Slow query -> missing index or query reshape first; caching covers spikes, not O(N) hot paths. |

Cache adoption + invalidation hooks are part of any change that adds a hot read/write/fan-out path - not follow-up work.

## Valkey cache layer

Four physical clients per process; importing the right tier matters (mismatches cause subtle hangs):

| Tier | Module | Purpose | Resilience |
|---|---|---|---|
| Pubsub | `infrastructure/valkey/pubsub.py` | PUBLISH / SUBSCRIBE / PSUBSCRIBE transport | 5s socket timeout, retries, long-lived connections |
| Ops | `infrastructure/valkey/ops.py` | Fail-fast non-blocking commands | 200ms connect, 100ms read, zero retries, 150ms `ops_call` deadline |
| Streams | `infrastructure/valkey/streams.py` | Blocking XREAD for agent-run replay | 30s socket timeout, zero retries |
| Queue | `infrastructure/valkey/queue.py` | ARQ pools | 10s timeout, 5 retries |

Conventions:

- Key naming `{namespace}:{scope}:{id}[:subkind]`; first segment is the metrics namespace.
- Application cache, presence, mention, tag, realtime-event, rate-limit, and agent-run semantics stay
  with their core or domain owner; infrastructure exposes transport operations only.
- Application owners use the public `get_ops_client` accessor when they need concrete Valkey commands;
  underscore-prefixed adapter state remains private to infrastructure.
- Tag-based bulk invalidation via `tag:{name}` sets (`cache_invalidate_by_tag`) when the blast radius isn't cheaply enumerable.
- Stampede control via `cache_get_or_set_locked` on the hottest helpers.
- Per-namespace kill-switch: `CACHE_DISABLED_NAMESPACES` env var (misses still counted).
- Soft-deleted rows are NOT seeded into caches whose read path filters `is_deleted=false`.
- **The fail-fast contract is load-bearing:** a cache call returns within ~150ms or returns `CACHE_MISS`. Holding a request thread on Valkey beyond that budget is a bug.

## Authentication

JWT access/refresh pattern; users authenticate globally, then select an org context.

- `auth.v1.AuthService` is **authentication only** (Register, Login, RefreshToken, GetCurrentUser, Logout). User / org / group management live on their own services.
- Access token carries `user_id`, `org_id`, `token_version`; refresh token has no org context.
- `User.token_version` revokes: incrementing it invalidates all existing tokens; validated on every refresh.
- The ConnectRPC interceptor decodes a protected request once and publishes an immutable
  `AuthenticatedPrincipal` through `core/auth/principal.py`; handlers consume that request-scoped identity.
- Key files: `domains/auth/operations.py`, `domains/auth/interceptors.py`, `core/auth/principal.py`,
  `core/auth/tokens.py`, `core/models/login/user.py`.
- The asset-read cookie (GET asset reads for `<img>`/`<video>`/`<audio>`) is owned by `.agents/rules/files-domain.md` - do not add cookie handling elsewhere.

## HTTP routes vs ConnectRPC

Default is ConnectRPC. Plain FastAPI HTTP routes (`domains/{feature}/routes.py`, mounted in `factory.py` under `/api`) exist for GET asset reads that need browser caching or Range requests: files, thumbnails, media, avatars. Identity comes from `get_current_user_id` (`core/auth/http.py`), which accepts Bearer OR the asset cookie; permission gating stays in the route handler via the domain operations. Media seeking is a native HTTP Range route - do NOT reintroduce a ConnectRPC media stream. Full contract: `.agents/rules/files-domain.md`.

## Attachments (sub-feature of files)

Attachments link a file to content via a generic `(content_type, content_id)` row; RPCs live on `files.v1.FilesService`. `AttachFile` copies the source file into an Attachments folder and writes one `Attachment` row (`file_id` unique - each attachment owns its copy). Folder placement follows the parent's effective access mode (`OPEN_TO_ORG` parent -> shared org attachments folder; otherwise the attacher's personal folder). Attachment copies stay `OWNER_ONLY` with no baseline. Live parent authorization grants read access, so an independent organization baseline cannot bypass a parent denial. Intentional independent file grants remain valid. `DetachFile` deletes the row AND the file copy. Permissions: attach = VIEW on source + edit-equivalent on target (chat delegates to `ChatAccessChecker`); view/list = VIEW on parent; detach = attacher or EDIT on parent. Key files: `core/models/files/attachment.py`, `domains/files/attachments/`.

## Background jobs (ARQ + Valkey)

Job behavior and producer-facing contracts belong to the domain or core subsystem whose state and
invariants they operate on. Every domain owner uses its `jobs/contracts.py` and `jobs/jobs.py`; a
parent-context child such as `scheduling/calendar` keeps the same shape below that child. A large
surface may keep additional focused, one-word collaborators beside those files rather than breaching
the 500-line soft cap. `core/jobs/` owns only the generic contract types and dispatch helpers;
`workers/` is the composition root that validates registrations, builds the core, egress and media fleets,
manages their resources, and renders the executable inventory.

### Creating a job

1. **Put the contract and handler beside their owner.** The contract exports `JobRef` constants and
   imports neither handlers nor `workers/*`. Add every enqueueable ref to the owner's `*_JOB_REFS`
   tuple and every scheduled ref to its `*_SCHEDULED_JOB_REFS` tuple so registry drift validation can
   prove that both catalogs and their bindings agree. Export both tuples even when one is empty.
   Core-owned subsystems follow the same owner-local split; never create a domain handler under
   `workers/`.
2. **Classify the ref explicitly.** Give it a stable ARQ `name`, a `JobWorkload`, its matching
   `QueueName`, and a `JobReliability`. `CONTROL` and `DELIVERY` run on `CORE`; `MEDIA` runs on `MEDIA`; `AGENT` and
   `INTEGRATION` run on `EGRESS`. Scheduled refs use the `cron:` name prefix and a `_SCHEDULE`
   constant; changing an existing name or queue is a compatibility migration, not a refactor.
3. **Make durability concrete.** A `DURABLE` ref declares `JobRecovery` with the exact PostgreSQL
   pending/outbox fact and the automatic sweep or schedule that retries it. Commit that fact before
   enqueueing. Use `BEST_EFFORT` only when losing the job cannot leave authoritative state incomplete
   or incorrect.
4. **Keep the handler domain-shaped.** Handlers are async, accept ARQ `ctx` first, and receive only
   primitive values or JSON strings. Reload authoritative rows inside the job, carry
   `organization_id` for tenant work unless a single canonical payload row supplies it, enforce the
   actor identity when work runs on a user's behalf, never invent an admin/content bypass, and make
   repeated execution safe. Use `raise Retry(defer=ctx["job_try"] * 10)` only when replaying the same
   fact is safe.
5. **Dispatch through the typed boundary.** Business producers call
   `core.jobs.enqueue_job(ref, *payload)`; use `enqueue_job_reconnecting` only when an unavailable
   queue is deliberately non-fatal and the caller handles its `JobEnqueueResult.outcome`.
   Worker-internal batch fan-out may reuse its existing queue connection, but still takes the name
   from a `JobRef`, never a string literal. The owning operation decides whether enqueue failure is
   returned, recovered from PostgreSQL, or safely dropped.
6. **Bind once in `workers/registry.py`.** Import the ref and handler, then add `_bind(...)` to the
   matching `*_JOB_REGISTRATIONS` tuple or `_bind_schedule(...)` to the matching
   `*_SCHEDULED_REGISTRATIONS` tuple. Do not add domain jobs directly to `WorkerSettings.functions` or
   `cron_jobs`; fleet settings consume the validated registry output. If the handler needs a process
   resource its fleet does not already own, add it to the typed resource profile and lifecycle hooks
   instead of initializing an undeclared global inside the handler.
7. **Test behavior at the owner.** Cover the real effect, idempotent replay, retry/recovery path,
   tenant scope, and the typed ref passed through the dispatch boundary. Keep only registry,
   lifecycle, resource-topology, and queue mechanics under `tests/unit/workers/`; never snapshot job
   names, cron strings, tuple lengths, or settings attributes. Render `uniffy.workers.inventory` from
   the active backend or worker environment to inspect the live name/owner/workload/reliability/queue/
   schedule/retry picture.

Use `core.jobs.locks` only for ordinary token-owned `SET NX` leases with identical semantics. Domain
claim/version algorithms stay with their owner; idempotency does not imply that every job needs a
Valkey lock.

File processing routes through `domains/files/jobs/mime.py::get_jobs_for_mime_type`; queue failure
leaves PostgreSQL state recoverable by the bounded file-processing sweep. Thumbnail, extraction, and
transcode handlers each own a separate persisted status, and the producer plus recovery sweep use one
versioned `file-processing:` job id so queued work deduplicates across both paths. Thumbnail and
extraction flows are `PENDING -> PROCESSING -> COMPLETED | FAILED (after 3 retries) | SKIPPED`.

## Shared systems (pointers)

- **Bookmarks** (`domains/bookmarks/`, `bookmarks` table, unique `(user_id, organization_id, urn)`): no `is_pinned` / `is_starred` / `is_favorite` fields on content models.
- **Keyboard shortcuts**: backend is the source of truth - `domains/settings/defaults.py::DEFAULT_KEYBOARD_SHORTCUTS`.
- **Search indexing**: through `BaseContentOperations._index_for_search`; mention live-state contract in `.agents/rules/mentions.md`.
