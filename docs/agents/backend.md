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
