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

**Enum references in migrations must use module-level variables, never inline definitions inside `sa.Column()`.**

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

**WRONG - inline enum in column definition:**
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
| `files.v1.FilesService` | `src/proto/files/v1/files.proto` | File storage, chunked uploads, streaming |
| `attachments.v1.AttachmentsService` | `src/proto/attachments/v1/attachments.proto` | Link files to content (notes, events, etc.) |
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

- **Async everywhere**: All database I/O must use `AsyncSession`
- **BaseContentOperations**: Extend this for content with automatic permission checking and search indexing
- **Type annotations required**: All Python functions need type hints + docstrings (PEP 257)
- **File size**: Target 300-400 lines, max 500. Split into sub-modules if larger
- **No inline imports**: All imports at file top

## Multi-Tenancy

- All content scoped to `organization_id`
- Users are global, memberships are org-scoped
- Always verify user has access to organization before accessing resources

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

Every content row carries two columns that describe its baseline access:

| Column | Values | Meaning |
|---|---|---|
| `access_mode` | `OWNER_ONLY` | Only the owner (and admin bypasses) can touch the content. |
| | `EXPLICIT_MEMBERS` | Only users/groups listed in `permissions_content_members` can touch it. |
| | `OPEN_TO_ORG` | Every org member inherits `baseline_role`; explicit members can be elevated above or blocked below it. |
| `baseline_role` | `VIEWER` / `COMMENTER` / `EDITOR` / `ADMIN` (or `None`) | Only meaningful with `OPEN_TO_ORG`. Must be `None` for the other modes. `OWNER` and `BLOCKED` are never valid baselines. |

Explicit grants live in `permissions_content_members` as `ContentMember` rows keyed on `(content_type, content_id, subject_type, subject_id)` with a `role` from the `ContentRole` enum:

```
VIEWER < COMMENTER < EDITOR < ADMIN < OWNER   # plus BLOCKED (explicit deny, overrides everything)
```

The role ordering is exposed as `ROLE_ORDINAL` + `role_can_view / role_can_comment / role_can_edit / role_can_delete / role_can_manage / role_can_transfer` helpers in `core.auth.permissions.roles`. Use these predicates to gate operations.

**Effective role resolution** (`PermissionChecker.effective_role`):

1. If the user is org `OWNER`/`ADMIN` → `OWNER`.
2. If the user is a domain admin for the content type (see Domain Admin System) → `OWNER`.
3. If the user is the content's `owner_id` → `OWNER`.
4. If any `ContentMember` row with `role == BLOCKED` matches the user (directly or via a group they belong to) → `BLOCKED` immediately (overrides ownership-of-content).
5. Otherwise take the highest role of:
   - the user's direct non-blocked `ContentMember` row, if any;
   - the highest non-blocked role from groups the user belongs to;
   - the `baseline_role` when `access_mode == OPEN_TO_ORG`.
6. If nothing matches → `None` (no access).

Expired `ContentMember` rows (`expires_at < now`) are ignored.

**How to use it in domains:**

- Extend `BaseContentOperations` and implement `_build_search_keywords`, `_get_search_title`, `_get_url_path`. You get `get_by_id`, `list_accessible`, `_resolve_role`, `_require_view`, `_require_edit`, `_require_delete`, `_require_manage`, `_require_transfer`, and `_index_for_search` for free.
- `BaseContentOperations` does **not** supply `create / update / delete`; each domain writes its own because the signatures vary. Use the `_require_*` helpers inside them.
- Every `create()` path must resolve defaults via `resolve_content_defaults(session, organization_id, content_type)` from `core.auth.permissions`, which reads the per-org row in `permissions_org_defaults` and falls back to `ORG_PERMISSION_DEFAULTS`.
- List queries use `ContentAccessQuery.build_accessible_filter(user_id, organization_id, content_type, content_id_column, owner_id_column, access_mode_column, baseline_role_column)`. The filter handles ownership, explicit members (direct + group), `OPEN_TO_ORG` baseline, and the `BLOCKED` exclusion. Org/domain admins should bypass the filter entirely.
- Member CRUD, `set_access_mode`, `transfer_ownership`, and audit-log reads go through `ContentMembersOperations` in `core/content/members.py` - never mutate `access_mode` or `ContentMember` rows directly from a domain.

**MembersService (`permissions.v1.MembersService`):**

Seven RPCs, all backed by `ContentMembersOperations`:

| RPC | Purpose |
|---|---|
| `ListMembers` | List direct + group members on a content item |
| `AddMember` | Add a user or group with a role (records `MEMBER_ADDED`) |
| `UpdateMemberRole` | Change a member's role (records `MEMBER_ROLE_CHANGED`) |
| `RemoveMember` | Remove a member (records `MEMBER_REMOVED`) |
| `SetAccessMode` | Change `access_mode` and/or `baseline_role` (records `ACCESS_MODE_CHANGED` + optional `BASELINE_ROLE_CHANGED`) |
| `TransferOwnership` | Move `owner_id` to another user; previous owner becomes `ADMIN` (records `OWNERSHIP_TRANSFERRED`) |
| `ListMemberEvents` | Read the audit log for a content item |

Each mutating RPC writes a `ContentMemberEvent` row in the same transaction as the mutation. The audit log is append-only.

**Polymorphic content lookup:** `ContentMembersOperations` works on any content type via the `register_content_loader(content_type, loader)` registry. Every domain's `operations.py` must register a loader at module import time, for example:

```python
async def _load_note(session, organization_id, content_id):
    return (await session.execute(
        select(Note).where(Note.id == content_id, Note.organization_id == organization_id)
    )).scalar_one_or_none()

register_content_loader(ContentType.NOTE, _load_note)
```

**Child content (tasks, comments, attachments):** These do not have their own `access_mode` / `baseline_role` columns. They override `_resolve_role` on their `Operations` class to load the parent (project, parent content) and resolve against *its* access policy. Tasks, for example:

```python
async def _resolve_role(self, user_id, organization_id, content):
    project = await self.session.get(Project, content.project_id)
    return await self.permission_checker.effective_role(
        user_id=user_id,
        organization_id=organization_id,
        content_type=ContentType.PROJECT,
        content_id=project.id,
        owner_id=project.owner_id,
        access_mode=project.access_mode,
        baseline_role=project.baseline_role,
    )
```

**Domain overrides (e.g., chat channels):** Chat uses channel membership rather than the role model. `ChatChannelOperations` overrides `_require_view`, `_require_edit`, and `_require_delete` to delegate to `ChatAccessChecker`. Org OWNER/ADMIN and chat domain admin still bypass.

**Organization defaults** (`permissions_org_defaults`): per `(organization_id, content_type)` row with `default_access_mode` + `default_baseline_role`. Created on org creation from `domains/organizations/defaults.py::ORG_PERMISSION_DEFAULTS`. Editable via `organizations.v1.OrganizationsService.UpdatePermissionDefaults`.

## Domain Admin System

The domain admin system provides per-domain elevated access without granting full org admin. A user can be a regular org member but an admin for one or more specific domains.

**Model: `DomainAdmin`** (shared table, used by all domains):

```python
class DomainAdmin(SQLModel, table=True):
    __tablename__ = "domain_admins"

    id: UUID
    organization_id: UUID       # FK -> organizations
    user_id: UUID               # FK -> users
    domain: str                 # "chat", "files", "calendar", "projects", "agents"
    granted_by_user_id: UUID    # FK -> users (audit trail)
    created_at: datetime

    # unique constraint on (organization_id, user_id, domain)
```

**Access check order** (highest priority first):

| Priority | Check | Result |
|----------|-------|--------|
| 1 | User is org ADMIN/OWNER | Full access to everything |
| 2 | User has `DomainAdmin` row for this domain | Elevated access within the domain |
| 3 | Regular member | Standard member permissions |

**What domain admin grants** (varies per domain):

| Domain | Domain admin can | Regular member can |
|--------|------------------|--------------------|
| Chat | Create/delete any channel, manage categories, moderate messages across all channels, add/remove members anywhere | Send messages, react, join public channels, manage own channels where they are OWNER/ADMIN |
| Files | (Future) Manage shared folders, storage quotas | Upload/manage own files |
| Calendar | (Future) Manage shared calendars, org-wide events | Manage own events |
| Projects | (Future) Manage all projects, assign across teams | Manage projects they own or have access to |
| Agents | (Future) Manage all agents, provider keys | Use agents they have access to |

**Checking domain admin in operations:**

```python
from uniffy.core.auth.domain_admin import is_domain_admin

# In a domain's access checker or operations class:
if await is_domain_admin(session, user_id, organization_id, "chat"):
    # grant elevated access
    ...
```

**Key rules:**
- Domain admin is binary: you either are one or you are not. No sub-levels (no moderator, no RBAC)
- Only org ADMIN/OWNER can grant/revoke domain admin status
- Domain admin does NOT grant access to other domains or org-level settings
- The `DomainAdmin` table lives in `src/uniffy/core/models/domain_admin.py` (shared, not inside any domain)
- Domain admin checks should be integrated into each domain's existing access checker, not into `BaseContentOperations`

**Key files:**

| File | Purpose |
|------|---------|
| `src/uniffy/core/models/domain_admin.py` | DomainAdmin model |
| `src/uniffy/core/auth/domain_admin.py` | `is_domain_admin()` helper |
| `src/proto/organizations/v1/organizations.proto` | RPC for granting/revoking domain admin (org admin operations) |
| `src/uniffy/domains/organizations/operations.py` | Domain admin grant/revoke business logic |

**Admin UI surfaces:**

| Page | What it shows |
|------|---------------|
| `/admin/members` | Domain admin badges per member, click to edit via dialog |
| `/admin/domain-admins` | All assignments grouped by domain, assign/remove |
| `UserEditDialog` (system admin) | Domain admin assignments per org |

## Bookmarks System (Backend)

**Key Files:**

| File | Purpose |
|------|---------|
| `src/proto/bookmarks/v1/bookmarks.proto` | API contract (Toggle, List, BulkCheck) |
| `src/uniffy/core/models/bookmarks/bookmark.py` | Bookmark model |
| `src/uniffy/domains/bookmarks/operations.py` | Business logic |
| `src/uniffy/domains/bookmarks/handlers.py` | RPC handlers |

**Important Rules:**
- Never add `is_pinned`, `is_starred`, or `is_favorite` fields to content models
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

## Attachments System (Backend)

The attachments system links files to content (notes, events, etc.) without duplicating storage. Files live in a user's Attachments folder; attachment records track which content uses them.

**Key Files:**

| File | Purpose |
|------|---------|
| `src/proto/attachments/v1/attachments.proto` | API contract (AttachFile, DetachFile, ListAttachments, GetAttachmentsFolder) |
| `src/uniffy/core/models/attachments/` | Attachment and AttachmentsFolder models |
| `src/uniffy/domains/attachments/operations.py` | Business logic with permission checks |
| `src/uniffy/domains/attachments/handlers.py` | RPC handlers |

**Design Pattern:**
- Each user has one AttachmentsFolder per organization (created on demand)
- Files uploaded to attachments folder via FilesService
- AttachFile creates a link record (source_file_id, content_type, content_id)
- Same file can be attached to multiple content items
- Deleting attachment record does NOT delete the file

**Permission Model:**
- Attaching requires EDIT permission on the target content
- Viewing attachments requires VIEW permission on the content
- Files inherit visibility from their folder (user's private attachments folder)


**Key Pattern:** Always use `get_jobs_for_mime_type()` from `uniffy.workers.utils.mime` to determine which jobs to enqueue. Never hardcode job names.

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

## Permission Checking with PermissionChecker

When checking permissions outside of `BaseContentOperations` (for example, from child content that delegates to a parent), fetch the parent row first to get `owner_id`, `access_mode`, and `baseline_role`, then call `PermissionChecker.effective_role()` and gate on the `role_can_*` helpers.

The comments and attachments domains are the canonical examples. Both define a `_load_parent_policy` helper plus a thin `_resolve_parent_role` that feeds the columns into the checker. Child content that hangs off a parent (e.g. tasks hanging off a project) should pass the parent's `(content_type, content_id, owner_id, access_mode, baseline_role)` to the checker so that the filter lines up with the parent's row.

**Pattern:**

```python
from uniffy.core.auth.permissions import role_can_edit, role_can_view
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.types import AccessMode, ContentRole, ContentType


async def _load_parent_policy(
    self,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
) -> tuple[UUID, AccessMode, ContentRole | None, ContentType, UUID]:
    """Load (owner_id, access_mode, baseline_role, type, id) for a parent."""
    if content_type == ContentType.NOTE:
        from uniffy.core.models.notes.note import Note

        result = await self._session.execute(
            select(Note.owner_id, Note.access_mode, Note.baseline_role).where(
                Note.id == content_id,
                Note.organization_id == organization_id,
            )
        )
        row = result.one_or_none()
        if not row:
            raise NotFoundError("Note", str(content_id))
        return row[0], row[1], row[2], content_type, content_id
    # ... other content types, tasks delegate to their parent project ...
    raise NotFoundError("Content", str(content_id))


async def verify_edit(
    self,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
) -> None:
    owner_id, access_mode, baseline_role, resolved_type, resolved_id = (
        await self._load_parent_policy(organization_id, content_type, content_id)
    )
    checker = PermissionChecker(self._session)
    role = await checker.effective_role(
        user_id=user_id,
        organization_id=organization_id,
        content_type=resolved_type,
        content_id=resolved_id,
        owner_id=owner_id,
        access_mode=access_mode,
        baseline_role=baseline_role,
    )
    if not role_can_edit(role):
        raise PermissionDeniedError("edit", "content")
```

**`PermissionChecker.effective_role` takes:** `user_id`, `organization_id`, `content_type`, `content_id`, `owner_id`, `access_mode`, `baseline_role`. Returns a `ContentRole | None`. Combine with `role_can_view / role_can_comment / role_can_edit / role_can_delete / role_can_manage / role_can_transfer` to gate the operation.

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
