# Backend Documentation

> Use this documentation when working on Python backend code in `src/uniffy/`.

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
|-- gen             # Generated ConnectRPC code from .proto files at src/proto/
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
2. Run `make proto`
3. Create model in `core/models/{feature}/` if needed
4. Create domain module in `domains/{feature}/`
5. Mount in `factory.py`:
   ```python
   from uniffy.domains.feature.service import FeatureServiceImpl
   from uniffy.gen.feature.v1.feature_connect import FeatureServiceASGIApplication

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
| `permissions.v1.PermissionsService` | `src/proto/permissions/v1/permissions.proto` | Content permission management |

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
enum ContentType { NOTE, FILE, CALENDAR_EVENT, ... }
enum PermissionLevel { VIEW, EDIT, ADMIN }
enum VisibilityScope { PRIVATE, GROUP, ORGANIZATION }

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

Three-layer system:
1. **VisibilityScope**: PRIVATE, GROUP, ORGANIZATION
2. **ContentGroupLink**: Links content to groups
3. **ContentPermission**: Fine-grained grants (VIEW, EDIT, ADMIN, OWNER)

Use `PermissionChecker` or `BaseContentOperations` (handles it automatically).

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

When checking permissions outside of `BaseContentOperations`, you must fetch the content first to get `owner_id` and `visibility`.

**CORRECT - Fetch content first, then check with full parameters:**
```python
async def _get_content_for_permission_check(
    self,
    content_type: ContentType,
    content_id: UUID,
) -> tuple[UUID, VisibilityScope]:
    """Fetch content to get owner_id and visibility for permission check."""
    if content_type == ContentType.NOTE:
        result = await self.session.execute(
            select(Note).where(Note.id == content_id)
        )
        note = result.scalar_one_or_none()
        if not note:
            raise NotFoundError("Note not found")
        return note.owner_id, note.visibility
    # ... handle other content types
    raise ValueError(f"Unsupported content type: {content_type}")

async def verify_access(self, content_type: ContentType, content_id: UUID) -> None:
    """Verify user can access the content."""
    owner_id, visibility = await self._get_content_for_permission_check(
        content_type, content_id
    )

    checker = PermissionChecker(self.session, self.user_id, self.organization_id)

    if not await checker.can_access_content(
        content_type=content_type,
        content_id=content_id,
        owner_id=owner_id,
        visibility=visibility,
    ):
        raise PermissionDeniedError("Access denied")
```

**PermissionChecker methods require these parameters:**
- `can_access_content(content_type, content_id, owner_id, visibility)` - for VIEW
- `can_edit_content(content_type, content_id, owner_id, visibility)` - for EDIT

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
