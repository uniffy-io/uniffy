---
paths:
  - "src/uniffy/**/*.py"
  - "src/proto/**/*.proto"
  - "src/gen/python/**/*.py"
---

## Directory Structure

`src/uniffy/` is the root backend dir:

```
|-- __init__.py
|-- alembic.ini
|-- core            # Core models and utilities
|   |- models/      # Application Database Models (User, Organization, BaseContent, etc.)
|   |- content/     # Content module for base content operations.
|   |- auth/        # Authentication and Permission base models.
|   |- search/      # SearchIndexer class for indexing content to Meilisearch.
|   |- types.py     # Shared enums and types
|   |- errors.py    # Shared error classes
|-- db              # Database session and migrations
|   |-- migrations/ # Alembic migration scripts
|   |-- seed_data/  # Initial seed data files
|   |-- session.py  # AsyncSession factory
|   |-- seed.py     # Seed data runner
|   |-- __init__.py # DB package init
|-- domains         # Domain modules, see below
|-- factory.py      # App factory mounting services
|-- (generated code lives in src/gen/python/ as the uniffy-proto package)
|-- main.py         # App entrypoint
|-- observability   # Logging, tracing, metrics
```

## Domain-Driven Vertical Slices

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

## Adding a New Domain

1. Define proto in `src/proto/{service}/v1/{service}.proto`
2. Run `./run.sh proto`
3. Create model in `core/models/{feature}/` if needed
4. Create domain module in `domains/{feature}/`
5. Mount in `factory.py`:
   ```python
   from uniffy.domains.feature.service import FeatureServiceImpl
   from uniffy_proto.feature.v1.feature_connect import FeatureServiceASGIApplication

   service = FeatureServiceImpl()
   app.mount("/feature.v1.FeatureService", FeatureServiceASGIApplication(service))
   ```
6. Create Alembic migration if model added
7. **If adding searchable content type**: Complete the Search Integration Checklist in the main CLAUDE.md

## Migration Conventions

**Prefer module-level enum variables in migrations over inline definitions inside `sa.Column()`.** Inline forms tend to drift between migrations.

Define each enum as a module-level variable with `create_type=False`, then reference it in column definitions:

```python
from sqlalchemy.dialects import postgresql

_visibility_enum = postgresql.ENUM(
    "PRIVATE",
    "GROUP",
    "ORGANIZATION",
    "PUBLIC",
    name="visibilityscope",
    create_type=False,
)

def upgrade() -> None:
    op.create_table(
        "my_table",
        # CORRECT - reference module-level variable
        sa.Column("visibility", _visibility_enum, nullable=False),
    )
```

**Less ideal - inline enum in column definition:**
```python
def upgrade() -> None:
    op.create_table(
        "my_table",
        sa.Column(
            "visibility",
            postgresql.ENUM(
                "PRIVATE", "GROUP", "ORGANIZATION", "PUBLIC",
                name="visibilityscope", create_type=False,
            ),
            nullable=False,
        ),
    )
```

**Creating new enums:** When a migration introduces a brand new enum type, create it explicitly inside `upgrade()` and define a separate module-level variable (with `create_type=False`) for column references:

```python
_my_status_enum = postgresql.ENUM(
    "PENDING", "ACTIVE", "DONE",
    name="mystatus",
    create_type=False,
)

def upgrade() -> None:
    # Create the enum type in the database
    postgresql.ENUM(
        "PENDING", "ACTIVE", "DONE",
        name="mystatus",
    ).create(op.get_bind(), checkfirst=True)

    op.create_table(
        "my_table",
        sa.Column("status", _my_status_enum, nullable=False),
    )
```

## API Services Architecture

The backend is organized into domain-specific ConnectRPC services. Each service has its own proto definition and handles a specific domain.

**Core Services:**

| Service | Proto | Purpose |
|---------|-------|---------|
| `auth.v1.AuthService` | `src/proto/auth/v1/auth.proto` | Authentication only (5 methods: Register, Login, RefreshToken, GetCurrentUser, Logout) |
| `users.v1.UsersService` | `src/proto/users/v1/users.proto` | User profile CRUD, user org memberships |
| `organizations.v1.OrganizationsService` | `src/proto/organizations/v1/organizations.proto` | Organization CRUD, member management, permission defaults |
| `groups.v1.GroupsService` | `src/proto/groups/v1/groups.proto` | Group CRUD, group membership |
| `permissions.v1.MembersService` | `src/proto/permissions/v1/permissions.proto` | Content member management (ListMembers, AddMember, UpdateMemberRole, RemoveMember, SetAccessMode, TransferOwnership, ListMemberEvents) |

**Content Services:**

| Service | Proto | Purpose |
|---------|-------|---------|
| `notes.v1.NotesService` | `src/proto/notes/v1/notes.proto` | Notes/documents |
| `files.v1.FilesService` | `src/proto/files/v1/files.proto` | File storage, chunked uploads, streaming, and attachments (link files to content) |
| `bookmarks.v1.BookmarksService` | `src/proto/bookmarks/v1/bookmarks.proto` | User bookmarks |
| `search.v1.SearchService` | `src/proto/search/v1/search.proto` | Full-text search |
| `settings.v1.SettingsService` | `src/proto/settings/v1/settings.proto` | User settings |

**Common Types** (`src/proto/common/v1/common.proto`):

Shared enums and messages used across services:

```protobuf
// Enums
enum OrganizationRole { MEMBER, ADMIN, OWNER }
enum GroupRole { MEMBER, ADMIN }
enum ContentType { NOTE, FILE, CALENDAR_EVENT, PROJECT, TASK, AGENT, ... }
enum AccessMode { OWNER_ONLY, EXPLICIT_MEMBERS, OPEN_TO_ORG }
enum ContentRole { VIEWER, COMMENTER, EDITOR, ADMIN, OWNER, BLOCKED }
enum SubjectType { USER, GROUP, ORGANIZATION }
enum ContentMemberAction { MEMBER_ADDED, MEMBER_ROLE_CHANGED, MEMBER_REMOVED, ACCESS_MODE_CHANGED, BASELINE_ROLE_CHANGED, OWNERSHIP_TRANSFERRED }

// Messages
message UserInfo { id, email, full_name, username, avatar_url, created_at }
message OrganizationInfo { id, name, slug, logo_url, created_at, updated_at }
message GroupInfo { id, organization_id, name, slug, description, ... }
message MemberInfo { user_id, display_name, email, role, joined_at, is_active }
message GroupMemberInfo { user_id, display_name, email, role, joined_at }

// Pagination
message PaginationRequest { page, page_size }
message PaginationResponse { page, page_size, total_count, total_pages }
```

## Key Backend Patterns

- **Async everywhere**: Database I/O goes through `AsyncSession` - the rest of the stack composes around it
- **BaseContentOperations**: Extending this for content gets you automatic permission checking and search indexing for free
- **Type annotations**: Python functions read better with type hints + docstrings (PEP 257)
- **File size**: Target 300-400 lines, soft cap 500. Splitting into sub-modules keeps things navigable
- **Imports at the top**: Inline imports tend to obscure module dependencies

## Logging

Logging is [loguru](https://loguru.readthedocs.io) (`from loguru import logger`), configured in `observability/`. Output is human-readable console by default, or structured JSON when `LOG_FORMAT=json` (self-hosters and log aggregators); in JSON mode structured fields flatten to top-level keys.

- **Every module tags its logs with a `component`.** Rebind the module logger once, right after the import:
  ```python
  from loguru import logger

  logger = logger.bind(component="agents.runtime.operations")
  ```
  Every call in the file then inherits `component` - do NOT repeat `component=` on each call. The name is the dotted module path minus the top-level package (`domains/agents/runtime/operations.py` -> `agents.runtime.operations`). An explicit `component=` on a single call still overrides the bound value when one line needs a different label.

- **Log exceptions the native loguru way - never stdlib `exc_info=True`.** loguru is not stdlib `logging`: it does not recognize `exc_info`, so `logger.error("...", exc_info=True)` silently drops the kwarg into `extra` and captures NO traceback. Inside an `except` block use:
  ```python
  logger.exception("upload failed")                  # ERROR level + full traceback
  logger.opt(exception=True).warning("degraded")     # keep WARNING level + traceback
  ```
  `logger.exception` reads the active exception from `sys.exc_info()`, so it needs no exception argument. A patcher in `configure_loguru` rescues any stray `exc_info=True` at runtime, but it is a safety net - write the correct idiom.

## Multi-Tenancy

- All content scoped to `organization_id`
- Users are global, memberships are org-scoped
- Verify the user has access to the organization before accessing resources - this is part of every domain operation's contract

## Performance-Critical Domains

`domains/chat/` and `domains/agents/` carry the bulk of user traffic. Every change in these two domains is held to a higher bar than the rest of the codebase. The patterns below apply when working anywhere under those trees, and transitively to anything they call into (`core/auth/`, `core/content/`, `core/valkey/`, `core/users/`).

Patterns that work well in chat or agents code:

| Rule | Why |
|---|---|
| Hot reads go through Valkey before PG. | Channel rows, channel members, effective role, user/agent profiles, agent config, agent skills, agent prompt, provider-key metadata, pinned-message ids, DM peer lists, channel-resources head all have cache helpers in `domains/{x}/cache.py` or `core/{x}/cache.py`. Reach for the helper rather than raw PG. |
| Mutations invalidate caches in the same commit. | Every write that changes something a cache mirrors drops the matching key (or tag) before the request returns. Stale cache beats no cache. |
| Fan-out callers fetch dependencies once and thread them through. | The send pipeline fetches member ids once and passes the list into publisher / indexer / notifier. Same shape for reactions, member events. A downstream helper that re-fetches doubles the load. |
| Skip `LIKE` on text columns for indexed lookups. | Mention counting goes through `mentioned_urns @> ARRAY[...]` against the partial GIN index. New search-by-content patterns benefit from an index design discussion before merging. |
| Pagination caps on every list endpoint that can grow unbounded. | Default page size 200, max 500. Opaque base64-url cursor tuples for keyset pagination. Internal callers that legitimately need every row get a separate lean ID-only method (e.g. `list_user_channel_ids`). Avoid `limit=None` back-doors. |
| Keep LLM / external HTTP / unbounded loops off the request thread. | Compaction, summarisation, and slow tool work go to ARQ. The user request returns within milliseconds; background work catches up via the worker fleet. Idempotency on every job (Valkey `SET NX` lock keyed by the natural identifier). |
| Single-query aggregates beat UNION-per-N. | Multi-channel unread counts, sender resolution, profile lookups all use one query with `unnest(...)` joins or batch IN clauses. Per-channel UNION patterns tend to scale poorly. |
| Batch INSERTs / UPSERTs / DELETEs. | Loop-based DB writes scale poorly. Use `pg_insert.values([...]).on_conflict_do_nothing().returning(...)` and tuple-IN DELETEs. |
| Optimistic counters on hot rows. | Counter UPDATEs gate with `WHERE current < new_value` (or equivalent) so concurrent writers race deterministically. Lost updates show up as observable bugs. |
| Per-call deadline on every Valkey call. | The 150ms `ops_call` guard is part of the contract. A slow Valkey returns `CACHE_MISS` / no-op; the caller falls through to PG. Wrapping a cache call in a retry loop tends to backfire. |
| Fix root causes, not symptoms. | If a query is slow, caching alone is rarely the right answer. Add the missing index, reshape the query, or both. Caching covers spikes; structurally O(N) queries on hot paths read as bugs. |

If a change in chat or agents adds a new hot read path, a new write path, or a new fan-out, the cache adoption + invalidation hooks are part of the change rather than follow-up work. Backlog promises tend to rot.

## Valkey Cache Layer

Three physical clients per process, each tuned for its access pattern. Importing the right one matters - mismatched tiers tend to cause subtle hangs.

| Tier | Module | Purpose | Resilience |
|---|---|---|---|
| Pubsub | `core/valkey/pubsub.py` | Long-lived publisher + per-call subscribers. PUBLISH / SUBSCRIBE / PSUBSCRIBE only - pub/sub connections enter a special mode and cannot run regular commands. | 5s socket timeout, retry on transient errors, 30s health check. Connections are long-lived; reconnect is normal. |
| Ops | `core/valkey/ops.py` | Cache, presence, rate-limit, mention-state. Regular commands. | 200ms connect, 100ms read, **zero retries**, no health-check sweeps. A 150ms `ops_call` deadline guard wraps every public entry. |
| Queue | `core/valkey/queue.py` | ARQ pool for background jobs. | 10s timeout, 5 retries, 1s delay. Job dequeue tolerates retries. |

`ValkeyConfig.from_env()` reads only host / port / password / database. Per-tier timeouts are constants in code, surfaced via `to_pubsub_kwargs()` / `to_ops_kwargs()` / `to_arq_redis_settings()`. Per-tier env vars tend to multiply quickly; one dial per tier in code keeps the surface manageable.

**Cache helper conventions:**

- Domain-shaped helpers live in `domains/{domain}/cache.py` (chat, agents). Cross-cutting helpers live in `core/{x}/cache.py` (auth, users).
- Key naming: `{namespace}:{scope}:{id}[:subkind]`. The first segment is the metrics namespace (used by `uniffy_cache_hit_total{namespace}` etc).
- Tag-based bulk invalidation via Valkey sets keyed `tag:{name}` - callers add tags on `cache_set` and call `cache_invalidate_by_tag` on writes whose blast radius isn't enumerable cheaply (BLOCKED grants, group-targeted permissions, skill row mutations).
- Stampede control via `cache_get_or_set_locked` on the hottest helpers (perm, channel metadata, agent config). Lock losers poll the cache key for the lock TTL and fall through to running their own loader if the owner crashed - a Valkey hiccup should not propagate.
- Per-namespace kill-switch via `CACHE_DISABLED_NAMESPACES` env var. Disabled namespaces still bump miss counters so dashboards stay populated.
- Soft-deleted rows are NOT seeded into caches that the read path filters on `is_deleted=false`. Otherwise a brief delete window leaves the cache serving phantom rows.

**The fail-fast contract is load-bearing**, not aspirational. A cache call returns within ~150ms or returns `CACHE_MISS`. Any code path that holds a request thread waiting on Valkey beyond that budget reads as a bug.

## Authentication System

JWT-based authentication with access/refresh token pattern. Users authenticate globally, then select an organization context.

**Important:** `AuthService` handles **authentication only** (5 methods). For user/org/group management, use the dedicated services:
- User management → `users.v1.UsersService`
- Organization management → `organizations.v1.OrganizationsService`
- Group management → `groups.v1.GroupsService`

**Key Backend Files:**

| File | Purpose |
|------|---------|
| `src/proto/auth/v1/auth.proto` | Auth API (Register, Login, RefreshToken, GetCurrentUser, Logout) |
| `src/uniffy/domains/auth/operations.py` | Auth business logic (login, refresh, token validation) |
| `src/uniffy/domains/auth/tokens.py` | JWT creation/validation (access + refresh tokens) |
| `src/uniffy/core/models/login/user.py` | User model with `token_version` for revocation |

**Token Flow:**

1. **Login**: User authenticates → receives `access_token` (short-lived) + `refresh_token` (long-lived)
2. **Access token**: Contains `user_id`, `org_id`, `token_version`
3. **Refresh token**: Contains `user_id`, `token_version` (no org context)

**Token Revocation:**

- `User.token_version` field enables immediate token revocation
- Incrementing `token_version` invalidates all existing tokens for that user
- Backend validates `token_version` on every refresh

## Permission System

Content access control - the full model, `effective_role` resolution, capability gates, enforcement points, `ContentMembersOperations` / `MembersService`, org defaults, caching, search/tag filtering, domain admin, and chat's separate model - lives in **`.claude/rules/permissions.md`**. That file is the single source of truth; do not duplicate or paraphrase the permission model here.

## Bookmarks System (Backend)

**Key Files:**

| File | Purpose |
|------|---------|
| `src/proto/bookmarks/v1/bookmarks.proto` | API contract (Toggle, List, BulkCheck) |
| `src/uniffy/core/models/bookmarks/bookmark.py` | Bookmark model |
| `src/uniffy/domains/bookmarks/operations.py` | Business logic |
| `src/uniffy/domains/bookmarks/handlers.py` | RPC handlers |

**Important Rules:**
- Skip `is_pinned`, `is_starred`, or `is_favorite` fields on content models - the shared bookmarks system covers this UX
- All bookmarks stored in `bookmarks` table with unique constraint on `(user_id, urn)`

## Keyboard Shortcuts (Backend)

Shortcuts are defined in backend as the source of truth:

`src/uniffy/domains/settings/defaults.py`:
```python
DEFAULT_KEYBOARD_SHORTCUTS = {
    # ... existing shortcuts
    "calendar.newEvent": "Ctrl+E",
    "calendar.today": "T",
    "calendar.weekView": "W",
}
```

## Attachments (part of the Files domain)

Attachments link a file to a piece of content (note, chat message, calendar event, task) via a
generic `(content_type, content_id)` row, without the content model duplicating file metadata. The
attachment RPCs (`AttachFile`, `DetachFile`, `ListAttachments`, `BatchListAttachments`,
`GetAttachmentsFolder`) live on `files.v1.FilesService` - attachments is a sub-feature of files,
not a standalone domain.

**Key Files:**

| File | Purpose |
|------|---------|
| `src/proto/files/v1/files.proto` | API contract (attachment RPCs on `FilesService`) |
| `src/uniffy/core/models/files/attachment.py` | `Attachment` model (table `attachments_attachments`, `file_id` unique) |
| `src/uniffy/domains/files/attachments/operations.py` | `AttachmentOperations` - business logic + permission checks |
| `src/uniffy/domains/files/attachments/handlers.py` | `AttachmentsHandlersMixin`, mixed into `FilesServiceImpl` |

**Design Pattern:**
- `AttachFile` copies the source file into an Attachments folder, then writes one `Attachment` row.
  `file_id` is unique, so each attachment owns its own file copy (detaching one never affects another).
- Folder + file policy follow the PARENT's effective access mode: an `OPEN_TO_ORG` parent routes to
  the shared per-org "Organization Attachments" folder (`is_org_attachments`, `OPEN_TO_ORG/EDITOR`);
  any other parent routes to the attacher's personal "Attachments" folder (`OWNER_ONLY`). Both are
  system `Folder` rows - there is no separate `AttachmentsFolder` model.
- `DetachFile` deletes the `Attachment` row AND the underlying file copy (plus its versions/objects).
  `detach_all_for_content` runs this for every attachment on content delete.

**Permission Model:**
- Attaching requires VIEW on the source file and access to the target content (EDIT-equivalent via
  the parent's policy; chat messages delegate to `ChatAccessChecker`).
- Viewing/listing requires VIEW on the parent content; `batch_list_attachments` shares one channel
  check across a page of chat messages.
- Detaching requires being the attacher, or EDIT on the parent (sender-or-elevated for chat).


**Key Pattern:** Reach for `get_jobs_for_mime_type()` from `uniffy.workers.utils.mime` to determine which jobs to enqueue; hardcoded job names tend to drift from the registry.

## HTTP Routes for File Serving

For resources that benefit from HTTP caching (images, thumbnails, PDFs), use standard FastAPI HTTP endpoints instead of ConnectRPC streaming.

**When to use HTTP routes vs ConnectRPC:**

| Use Case | Approach |
|----------|----------|
| Images in `<img>` tags | HTTP route (browser caching, service worker auth) |
| Thumbnails | HTTP route (CDN caching, lazy loading) |
| Video/audio seeking | ConnectRPC streaming (Range header support) |
| File downloads with progress | ConnectRPC streaming (chunk callbacks) |

**HTTP Route Pattern** (`domains/{feature}/http_routes.py`):

```python
from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/files", tags=["files"])

async def get_current_user_id(
    authorization: Annotated[str | None, Header()] = None,
) -> UUID:
    """Extract user ID from Bearer token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization")
    token = authorization[7:]
    payload = decode_access_token(token)
    return UUID(payload["sub"])

@router.get("/{organization_id}/{file_id}")
async def stream_file(
    organization_id: UUID,
    file_id: UUID,
    user_id: Annotated[UUID, Depends(get_current_user_id)],
) -> StreamingResponse:
    async for session in get_async_session():
        ops = FileOperations(session)
        file = await ops.get_by_id(user_id, organization_id, file_id)

        s3 = get_s3_client()

        async def stream_content():
            async for chunk, _, _ in s3.download_stream(key=file.storage_key):
                yield chunk

        return StreamingResponse(
            stream_content(),
            media_type=file.mime_type,
            headers={
                "Cache-Control": "public, max-age=86400, immutable",
                "Content-Disposition": f'inline; filename="{file.filename}"',
            },
        )
```

**Mounting HTTP routes in factory.py:**

```python
from uniffy.domains.files.http_routes import files_router, thumbnails_router

# Mount under /api prefix for service worker interception
http_app.include_router(thumbnails_router)  # /api/thumbnails/{org}/{file}
http_app.include_router(files_router)       # /api/files/{org}/{file}
```

## Background Task Worker (ARQ + Valkey)

The system uses ARQ (Async Redis Queue) with Valkey for background job processing.

**Key Files:**

| File | Purpose |
|------|---------|
| `src/uniffy/core/queue/valkey.py` | Queue pool management |
| `src/uniffy/workers/settings.py` | ARQ worker configuration |
| `src/uniffy/workers/tasks/` | Task implementations |
| `src/uniffy/workers/utils/mime.py` | MIME type to job mapping |

**Enqueuing Jobs from Domain Operations:**

```python
from uniffy.core.queue import get_queue
from uniffy.workers.utils.mime import get_jobs_for_mime_type

async def _enqueue_processing_jobs(self, file: File) -> None:
    """Enqueue background processing jobs for a file."""
    jobs = get_jobs_for_mime_type(file.mime_type or "")
    if not jobs:
        return

    try:
        queue = get_queue()
        for job_name in jobs:
            await queue.enqueue_job(
                job_name,
                str(file.id),
                str(file.organization_id),
            )
    except RuntimeError:
        # Queue not available - non-fatal, file stays PENDING
        pass
```

**Adding a New Task:**

1. Create task function in `src/uniffy/workers/tasks/{feature}.py`:
   ```python
   from typing import Any
   from arq import Retry
   from loguru import logger

   async def my_task(ctx: dict[str, Any], item_id: str, org_id: str) -> dict[str, Any]:
       """Process an item in the background."""
       # ctx contains shared resources from worker startup
       try:
           # Do work...
           return {"status": "success", "item_id": item_id}
       except Exception as e:
           logger.error(f"Task failed: {e}")
           # Retry with backoff (10s, 20s, 30s)
           raise Retry(defer=ctx["job_try"] * 10)
   ```

2. Register in `src/uniffy/workers/settings.py`:
   ```python
   from uniffy.workers.tasks.feature import my_task

   class WorkerSettings:
       functions = [
           # ...existing tasks
           my_task,
       ]
   ```

3. Add MIME mapping if applicable (`src/uniffy/workers/utils/mime.py`):
   ```python
   FEATURE_MIME_TYPES: dict[str, str] = {
       "application/x-custom": "my_task",
   }
   ```

**ExtractionStatus Flow:**

```
PENDING     # Queued, waiting for worker
    |
    v (worker picks up)
PROCESSING  # Currently running
    |
    v
COMPLETED   # Success
    or
FAILED      # After max retries (3)
    or
SKIPPED     # MIME type not supported
```
