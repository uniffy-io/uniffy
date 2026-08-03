---
paths:
  - "src/uniffy/**/*.py"
  - "src/proto/**/*.proto"
  - "src/gen/python/**/*.py"
---

# Backend Patterns

Rules and load-bearing conventions for the Python backend. Domain-specific invariants live in their own rule files (`permissions.md`, `files-domain.md`, `chat-domain.md`, `calls-domain.md`, `notes-realtime.md`, `agents.md`) - this file does not duplicate them.

## Vertical slices

Each feature is self-contained in `src/uniffy/domains/{feature}/`:

```
domains/{feature}/
├── converters.py     # Proto <-> domain mapping
├── queries.py        # Complex SQL (optional)
├── operations.py     # Business logic (extend BaseContentOperations for content)
├── handlers.py       # Thin RPC handlers
├── service.py        # Service class
└── __init__.py
```

Adding a new domain:

1. Define proto in `src/proto/{service}/v1/{service}.proto`, run `./manage.py proto`
2. Model in `core/models/{feature}/` if needed, plus Alembic migration
3. Domain module in `domains/{feature}/`
4. Mount in `factory.py`: `app.mount("/feature.v1.FeatureService", FeatureServiceASGIApplication(service))`
5. New searchable content type: complete the Search Integration Checklist in `architecture.md`

## Core patterns

- **Async everywhere.** Database I/O goes through `AsyncSession`; the rest of the stack composes around it.
- **`BaseContentOperations`** (`core/content/base_operations.py`): extending it for content gets permission checking and search indexing for free.
- **Permission checks live inside domain operations.** The full model is in `.claude/rules/permissions.md` - the single source of truth; do not re-explain it.
- **Multi-tenancy:** all content scoped to `organization_id`; users are global, memberships org-scoped. Verifying org access is part of every domain operation's contract.
- **Raise domain errors (`core/errors.py`), never leak exception text to clients.** `observability/crpc.py::DOMAIN_ERROR_CODES` maps every `UNIFFYError` subclass to its Connect code for ALL unary RPCs, so a handler without local mapping still returns the right code. Handlers may map locally for precision, but an `except Exception` block must respond with the literal `"Internal server error"` - `str(e)` in a client-facing message is a leak (the `logger.exception` line keeps the details server-side).
- **Imports at the top.** The one exception is the circular-import case in agent tool executors.
- **Content we ship is a file, not a literal.** Prompts, templates, catalogs and the like go in `src/uniffy/data/` (see "Shipped content"), never in a triple-quoted string or a hand-written python catalog.
- **File size:** target 300-400 lines, soft cap 500; split into sub-modules past that.
- **Type hints** on all functions; docstring discipline per `comment-discipline.md`.

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

Configured in `observability/`; console by default, structured JSON when `LOG_FORMAT=json`.

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

Both are `(namespace, key) -> value` KV rows: plaintext JSONB `value`, or `value_encrypted` when `is_secret=true` (CHECK constraint enforces exclusivity).

- **Pick by scope.** Operator config (registration policy, VAPID keys, system mail relay) -> `deployment_settings`. Tenant config (per-org mail, security, MFA, call policy, agent runtime knobs) -> `org_settings`. Per-**user** preferences stay in `settings_profiles`, not the KV stores.
- **One namespace per domain** (`namespace='calls'`, `namespace='mail'`, ...), one JSON blob or key-per-setting within it.
- **Wrap the blob in a frozen dataclass with code-level defaults.** Reference: `domains/calls/policy.py::ResolvedCallPolicy`, `domains/agents/runtime/settings.py::ResolvedRuntimeSettings`. The loader never returns a raw dict; a missing row resolves to defaults.
- **Secrets:** `is_secret=True` encrypts through the tenant/deployment cipher; reads are opt-in via `get_secret(...)`. The `ReEncryptingConsumer` registered per table rotates every `is_secret` row automatically. Never plaintext, never a hand-rolled shared-key Fernet path.
- **Resolution chain:** per-org row -> env default -> coded default -> typed error. Canonical: `core/mail/resolver.py`, `domains/system_config/operations.py`.
- **Audit operator-facing writes** in the same transaction (`write_audit_event`).
- **A real table is still right** for high-cardinality, relational, or hot-path-indexed config (`permissions_org_defaults` is the reference counter-example: materialized policy, not operator config).

## Shipped content (`src/uniffy/data/`)

Content we author and ship with the build - prompts, agent templates, bundled skills, the model catalog, seed assets. It is neither user data nor operator config: nobody edits it at runtime, and a release is the only thing that changes it. **All of it lives in `src/uniffy/data/{kind}/`, never in a python literal and never in a per-domain folder.** One directory means one place to look, one reader, and one packaging path (`COPY src/uniffy` ships it; it works air-gapped and self-hosters get updates on image upgrade).

| Kind | Path | Consumed by |
|---|---|---|
| Agent templates | `data/catalog/*.md` | `domains/agents/templates.py` |
| Bundled agent skills | `data/skills/*.md` | `db/bundled_skills.py` |
| Platform prompts | `data/prompts/*.md` | `domains/agents/runtime/workspace_prompt.py` |
| Model catalog | `data/models/catalog.json` | `domains/agents/providers/catalog/loader.py` |
| Seed assets | `data/assets/` | `db/seed.py` |

`core/data_files.py` is the only reader: `DATA_DIR`, `load_documents(dir) -> list[DataDocument]`, and a deliberately tiny frontmatter parser (scalar `key: value` plus `- item` block lists - enough for this content, so no PyYAML dependency). Markdown-with-frontmatter is the default shape: metadata in the frontmatter, prose in the body, so prompt text stays readable and diffable instead of hiding inside a triple-quoted string.

Two consumption shapes. Pick by whether other rows must reference the content:

- **Read at import into a module constant** - the default. `WORKSPACE_PROMPT`, `AGENT_TEMPLATES`, the model catalog. No table, no migration, no seeding, no lifecycle. Editing the file and restarting is the whole update path.
- **Project into rows** only when other tables key on it (bundled skills: agents store skill ids in `enabled_skills`, usages record `skill_id`). Then the file stays the source of truth and the rows are its projection, which carries four obligations:
  - Sync on **every** boot from its own entry point with its own advisory lock, **before** `seed_initial_data`. Never inside the "no organizations exist" guard - that block runs once on a virgin DB, so anything seeded there never reaches an existing deployment again.
  - The file declares a **fixed id** (v7 literal, generated once and committed - `generate_id = uuid7`, there is no uuid5 anywhere). Generating ids at install time makes the same content a different entity per deployment and breaks every cross-deployment reference.
  - Upsert by that id so content edits propagate; insert-if-absent silently freezes old text forever.
  - Content removed from the repo is **retired** (a status flag the list/picker paths filter), never deleted - deleting cascades child rows and silently strips the id out of whatever referenced it.

Do not duplicate shipped content in the frontend. Expose it over an RPC (`ListAgentTemplates` is the reference) - a hand-synced TS mirror drifts the first time someone edits one side.

## Performance-critical domains

`domains/chat/` and `domains/agents/` carry the bulk of user traffic; changes there (and in what they call: `core/auth/`, `core/content/`, `core/valkey/`, `core/users/`) are held to a higher bar:

| Rule | Why |
|---|---|
| Hot reads go through Valkey before PG. | Cache helpers live in `domains/{x}/cache.py` / `core/{x}/cache.py`; reach for the helper, not raw PG. |
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

Three physical clients per process; importing the right tier matters (mismatches cause subtle hangs):

| Tier | Module | Purpose | Resilience |
|---|---|---|---|
| Pubsub | `core/valkey/pubsub.py` | PUBLISH / SUBSCRIBE / PSUBSCRIBE only | 5s socket timeout, retries, long-lived connections |
| Ops | `core/valkey/ops.py` | Cache, presence, rate-limit, mention-state | 200ms connect, 100ms read, zero retries, 150ms `ops_call` deadline |
| Queue | `core/valkey/queue.py` | ARQ pool | 10s timeout, 5 retries |

Conventions:

- Key naming `{namespace}:{scope}:{id}[:subkind]`; first segment is the metrics namespace.
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
- Key files: `domains/auth/operations.py`, `domains/auth/tokens.py`, `core/models/login/user.py`.
- The asset-read cookie (GET asset reads for `<img>`/`<video>`/`<audio>`) is owned by `.claude/rules/files-domain.md` - do not add cookie handling elsewhere.

## HTTP routes vs ConnectRPC

Default is ConnectRPC. Plain FastAPI HTTP routes (`domains/{feature}/http_routes.py`, mounted in `factory.py` under `/api`) exist for GET asset reads that need browser caching or Range requests: files, thumbnails, media, avatars. Identity comes from `get_current_user_id` (`domains/auth/http_deps.py`), which accepts Bearer OR the asset cookie; permission gating stays in the route handler via the domain operations. Media seeking is a native HTTP Range route - do NOT reintroduce a ConnectRPC media stream. Full contract: `.claude/rules/files-domain.md`.

## Attachments (sub-feature of files)

Attachments link a file to content via a generic `(content_type, content_id)` row; RPCs live on `files.v1.FilesService`. `AttachFile` copies the source file into an Attachments folder and writes one `Attachment` row (`file_id` unique - each attachment owns its copy). Folder + file policy follow the PARENT's effective access mode (`OPEN_TO_ORG` parent -> shared org attachments folder; otherwise the attacher's personal `OWNER_ONLY` folder). `DetachFile` deletes the row AND the file copy. Permissions: attach = VIEW on source + edit-equivalent on target (chat delegates to `ChatAccessChecker`); view/list = VIEW on parent; detach = attacher or EDIT on parent. Key files: `core/models/files/attachment.py`, `domains/files/attachments/`.

## Background tasks (ARQ + Valkey)

- Enqueue from domain operations via `get_queue()`; a queue-unavailable `RuntimeError` is non-fatal (item stays PENDING).
- Use `get_jobs_for_mime_type()` (`workers/utils/mime.py`) to pick jobs - hardcoded job names drift from the registry.
- New task: function in `workers/tasks/{feature}.py` (retry with `raise Retry(defer=ctx["job_try"] * 10)`), register in `workers/settings.py::WorkerSettings.functions`, add MIME mapping if applicable.
- Every job is idempotent (Valkey `SET NX` lock keyed by the natural identifier).
- `ExtractionStatus` flow: `PENDING -> PROCESSING -> COMPLETED | FAILED (after 3 retries) | SKIPPED`.

## Shared systems (pointers)

- **Bookmarks** (`domains/bookmarks/`, `bookmarks` table, unique `(user_id, urn)`): no `is_pinned` / `is_starred` / `is_favorite` fields on content models.
- **Keyboard shortcuts**: backend is the source of truth - `domains/settings/defaults.py::DEFAULT_KEYBOARD_SHORTCUTS`.
- **Search indexing**: through `BaseContentOperations._index_for_search`; mention live-state contract in `.claude/rules/mentions.md`.
