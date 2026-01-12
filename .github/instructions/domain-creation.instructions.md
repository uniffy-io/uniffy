---
applyTo: ./src/uwos/domains/**
---

# Creating a New Domain / Service

This guide explains how to create a new domain following the **Domain-Driven Vertical Slices** architecture established in UWOS.

## Architecture Overview

UWOS uses a vertical slice architecture where each feature domain is self-contained:

```
src/uwos/
├── core/                      # Shared infrastructure + models
│   ├── auth/permissions/      # Permission checking
│   ├── content/               # BaseContentOperations[T]
│   ├── converters/            # Shared proto converters
│   ├── models/                # Database schemas (moved here)
│   │   ├── login/             # User, Org, Group models
│   │   ├── notes/             # Note model
│   │   ├── permissions/       # ContentPermission, ContentGroupLink
│   │   ├── search/            # SearchIndex
│   │   └── shared.py          # Enums (VisibilityScope, etc.)
│   ├── search/                # Search indexing
│   ├── types.py               # Shared types
│   └── errors.py              # Base exceptions
│
├── db/                        # Database infrastructure
│   ├── migrations/            # Alembic (moved from alembic/)
│   ├── base.py
│   └── session.py
│
├── domains/                   # Feature slices
│   ├── auth/                  # Auth domain + seed.py
│   └── notes/                 # Notes domain
│
├── gen/                       # Generated protobuf
├── observability/             # Logging & telemetry
├── factory.py
└── main.py
```

## When to Create a New Domain

Create a new domain when adding a major feature like:
- Files/attachments
- Calendar/events
- Books/reading
- Passwords/secrets
- Workflows/automation
- Chat/messaging

## Step-by-Step Guide

### 1. Define the Proto Service

First, create the protobuf definition:

**Reference:** `proto/notes/v1/notes.proto`

- Define your service RPCs
- Define request/response messages
- Run `buf generate` to create Python bindings in `gen/`

### 2. Create the Domain Folder Structure

```
src/uwos/domains/{domain_name}/
├── __init__.py           # Public exports
├── converters.py         # Proto <-> domain conversion
├── queries.py            # Complex SQL queries (optional)
├── operations.py         # Business logic (extends BaseContentOperations if content-based)
├── handlers.py           # Thin RPC handlers
└── service.py            # Service class combining handlers
```

### 3. Create the Model (if needed)

**Reference:** `models/notes/note.py`

- Create SQLModel class with `table=True`
- Add to `models/__init__.py` exports
- Create Alembic migration

### 4. Implement Each File

#### `converters.py` - Proto ↔ Domain Mapping

**Reference:** `domains/notes/converters.py`

- Create functions like `{entity}_to_proto()` and `proto_to_{entity}()`
- Use mapping dictionaries for enum conversions
- Keep conversions pure (no DB access)

#### `queries.py` - Complex Database Queries (Optional)

**Reference:** `domains/notes/queries.py`

- Utility functions for complex queries (e.g., recursive deletes, slug generation)
- Keep functions stateless, accept `AsyncSession` as parameter

#### `operations.py` - Business Logic

**Reference:** `domains/notes/operations.py`

For content-based domains (notes, files, etc.), extend `BaseContentOperations[TModel]`:

```
from uwos.core.content import BaseContentOperations
from uwos.models import YourModel

class YourOperations(BaseContentOperations[YourModel]):
    """Business logic for your domain."""
    
    model_class = YourModel
    content_type = ContentType.YOUR_TYPE
    urn_prefix = "your-entity"
```

This provides:
- Built-in permission checking via `PermissionChecker`
- Search indexing via `ContentAccessQuery`
- Standard CRUD with visibility enforcement

For non-content domains (like auth), create standalone operation classes:

**Reference:** `domains/auth/operations.py`, `domains/auth/users/operations.py`

#### `handlers.py` - RPC Handlers

**Reference:** `domains/notes/handlers.py`

- One handler method per RPC
- Handlers should be **thin** - delegate to operations
- Handle request parsing, response building, error mapping
- Use `get_user_id_from_context()` for auth

Pattern:
```
async def rpc_method(self, request, ctx):
    user_id = get_user_id_from_context(ctx)
    async for session in get_async_session():
        ops = YourOperations(session)
        result = await ops.do_something(...)
        return convert_to_proto(result)
```

#### `service.py` - Service Implementation

**Reference:** `domains/notes/service.py`

- Inherit from generated service class
- Compose handler classes
- Keep minimal (just wiring)

#### `__init__.py` - Public Exports

**Reference:** `domains/notes/__init__.py`

- Export only public API
- Use `__all__` for explicit exports

### 5. Wire Up in Factory

**Reference:** `factory.py`

- Import your service implementation
- Import ASGI application from `gen/`
- Mount the service with logging interceptor

### 6. Update Core Types (if needed)

**Reference:** `core/types.py`, `models/shared.py`

- Add new `ContentType` enum value
- Add any shared types

## Best Practices

### File Size Limits

- **Target:** 300-400 lines per file
- **Maximum:** 500 lines
- If exceeding, split into sub-modules (see `domains/auth/users/`, `domains/auth/orgs/`)

### Error Handling

**Reference:** `core/errors.py`, `domains/auth/errors.py`

- Define domain-specific errors extending base classes
- Map to appropriate ConnectRPC error codes in handlers
- Use `Code.PERMISSION_DENIED`, `Code.NOT_FOUND`, `Code.INVALID_ARGUMENT`, etc.

### Permission Checking

**Reference:** `core/auth/permissions/checker.py`

All content access must check permissions:
1. Owner always has access
2. Organization members can access `ORGANIZATION` visibility
3. Group members can access `GROUP` visibility via `ContentGroupLink`
4. `PRIVATE` requires explicit `ContentPermission` grant

Use `BaseContentOperations` which handles this automatically, or use `PermissionChecker` directly.

## Permissions System Deep Dive

### Overview

UWOS uses a layered permission system that combines:
1. **Visibility Scopes** - Broad access levels (private, group, org, public)
2. **Group Links** - Content shared with specific groups
3. **Explicit Permissions** - Fine-grained grants to users/groups

### Core Concepts

#### Visibility Scopes

**Reference:** `core/models/shared.py` - `VisibilityScope` enum

| Scope | Access Rule |
|-------|-------------|
| `PRIVATE` | Only owner (or explicit permission holders) |
| `GROUP` | Owner + members of linked groups |
| `ORGANIZATION` | All organization members |
| `PUBLIC` | Anyone (future feature) |

#### Permission Levels

**Reference:** `core/models/shared.py` - `PermissionLevel` enum

| Level | Can View | Can Edit | Can Delete | Can Share |
|-------|----------|----------|------------|-----------|
| `VIEW` | ✓ | | | |
| `EDIT` | ✓ | ✓ | | |
| `ADMIN` | ✓ | ✓ | ✓ | ✓ |
| `OWNER` | ✓ | ✓ | ✓ | ✓ (+ transfer) |

### Database Models

#### ContentGroupLink

**Reference:** `core/models/permissions/content_group_link.py`

Links content to groups for `GROUP` visibility sharing.

Key fields:
- `content_type` - Type of content (note, file, etc.)
- `content_id` - ID of the content item
- `group_id` - Group this content is shared with
- `linked_by_user_id` - Who shared it

#### ContentPermission

**Reference:** `core/models/permissions/content_permission.py`

Grants explicit permissions to users, groups, or organizations.

Key fields:
- `content_type`, `content_id` - Target content
- `subject_type` - USER, GROUP, or ORGANIZATION
- `subject_id` - ID of the subject
- `permission_level` - VIEW, EDIT, ADMIN, OWNER
- Fine-grained flags: `can_view`, `can_edit`, `can_delete`, `can_share`, `can_move`
- `expires_at` - Optional expiration for temporary access

### Permission Check Flow

```
User requests content
        │
        ▼
┌───────────────────┐
│ Is user the owner?│──Yes──► ALLOW
└───────────────────┘
        │ No
        ▼
┌───────────────────┐
│ Is user in org?   │──No───► DENY
└───────────────────┘
        │ Yes
        ▼
┌───────────────────┐
│ Visibility =      │
│ ORGANIZATION?     │──Yes──► ALLOW
└───────────────────┘
        │ No
        ▼
┌───────────────────┐
│ Visibility =      │       ┌────────────────────┐
│ GROUP?            │──Yes──│ Is user in any     │
└───────────────────┘       │ linked group?      │──Yes──► ALLOW
        │ No                └────────────────────┘
        ▼                           │ No
┌───────────────────┐               ▼
│ Has explicit      │◄──────────────┘
│ ContentPermission?│──Yes──► ALLOW (with level)
└───────────────────┘
        │ No
        ▼
      DENY
```

### Using PermissionChecker

**Reference:** `core/auth/permissions/checker.py`

```python
from uwos.core.auth.permissions import PermissionChecker

checker = PermissionChecker(session)

# Check basic access
can_access = await checker.can_access_content(
    user_id=user_id,
    organization_id=org_id,
    content_type=ContentType.NOTE,
    content_id=note_id,
    content_owner_id=note.owner_id,
    content_visibility=note.visibility,
)

# Check edit permission
can_edit = await checker.can_edit_content(...)

# Check delete permission  
can_delete = await checker.can_delete_content(...)
```

### Using ContentAccessQuery

**Reference:** `core/auth/permissions/queries.py`

For building queries that automatically filter by permissions:

```python
from uwos.core.auth.permissions import ContentAccessQuery

access_query = ContentAccessQuery(session)

# Get base query with permission filters applied
query = await access_query.build_access_query(
    base_query=select(Note),
    user_id=user_id,
    organization_id=org_id,
    content_type=ContentType.NOTE,
    owner_field=Note.owner_id,
    visibility_field=Note.visibility,
    content_id_field=Note.id,
)

results = await session.execute(query)
```

### BaseContentOperations Integration

**Reference:** `core/content/base_operations.py`

When extending `BaseContentOperations`, permissions are handled automatically:

- `get_by_id()` - Checks access permission
- `update()` - Checks edit permission
- `delete()` - Checks delete permission
- `list_accessible()` - Filters by permission using `ContentAccessQuery`

You only need to:
1. Set `model_class`, `content_type`, `urn_prefix` on your operations class
2. Call the inherited methods

### Sharing Content with Groups

To share content with a group (set visibility to GROUP):

```python
from uwos.core.models.permissions import ContentGroupLink

# Create link when sharing
link = ContentGroupLink(
    organization_id=org_id,
    content_type=ContentType.NOTE,
    content_id=note_id,
    group_id=target_group_id,
    linked_by_user_id=user_id,
)
session.add(link)
```

### Granting Explicit Permissions

For fine-grained sharing (e.g., share private note with specific user):

```python
from uwos.core.models.permissions import ContentPermission

permission = ContentPermission(
    organization_id=org_id,
    content_type=ContentType.NOTE,
    content_id=note_id,
    subject_type=SubjectType.USER,
    subject_id=target_user_id,
    permission_level=PermissionLevel.EDIT,
    can_view=True,
    can_edit=True,
    granted_by_user_id=owner_id,
)
session.add(permission)
```

### Multi-Tenancy Rules

- All permission checks include `organization_id`
- Users can only access content in organizations they belong to
- Group membership is organization-scoped
- Content cannot be shared across organizations

### Search Indexing

**Reference:** `core/search/indexer.py`

Content should be indexed for universal search:
- Call `index_content()` on create/update
- Call `remove_from_index()` on delete
- `BaseContentOperations` handles this automatically

### Database Patterns

- Always use `AsyncSession`
- Use `select()` from SQLModel
- Prefer `.scalars().all()` for lists, `.scalar_one_or_none()` for single
- Use `session.flush()` then `session.refresh()` to get generated IDs

### Multi-Tenancy

- All content must have `organization_id`
- Always filter queries by organization
- Verify user membership before access

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Domain folder | lowercase | `domains/calendar/` |
| Operations class | `{Entity}Operations` | `CalendarOperations` |
| Handlers class | `{Entity}Handlers` | `CalendarHandlers` |
| Service class | `{Entity}ServiceImpl` | `CalendarServiceImpl` |
| Converter functions | `{entity}_to_proto` | `event_to_proto` |

## Example: Creating a Calendar Domain

1. Create `proto/calendar/v1/calendar.proto` with Event CRUD RPCs
2. Run `buf generate`
3. Create `models/calendar/event.py` with Event SQLModel
4. Create `domains/calendar/`:
   - `converters.py` - event_to_proto, visibility mappings
   - `operations.py` - EventOperations(BaseContentOperations[Event])
   - `handlers.py` - CalendarHandlers with thin RPC methods
   - `service.py` - CalendarServiceImpl combining handlers
5. Add `ContentType.CALENDAR_EVENT` to `models/shared.py`
6. Mount in `factory.py`
7. Create Alembic migration for events table

## Reference Files

- **Core base class:** `core/content/base_operations.py`
- **Permission checking:** `core/auth/permissions/checker.py`
- **Search indexing:** `core/search/indexer.py`
- **Example domain (simple):** `domains/notes/`
- **Example domain (complex with sub-modules):** `domains/auth/`
- **Service wiring:** `factory.py`
- **Database models:** `models/`
