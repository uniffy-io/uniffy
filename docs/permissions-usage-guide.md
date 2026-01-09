# Permission Utilities Usage Guide

## Overview

The UWOS permission system provides three main utilities for implementing content access control:

1. **`PermissionChecker`** - Core permission checking logic
2. **`ContentAccessQuery`** - Query builders for filtering accessible content
3. **`BaseContentService`** - Base class for content services with built-in permission support

## Quick Start

### 1. Using PermissionChecker Directly

Best for: One-off permission checks

```python
from uwos.services.permissions import PermissionChecker
from uwos.models.shared import ContentType

checker = PermissionChecker(session)

# Check if user can access content
can_view = await checker.can_access_content(
    user_id=user_id,
    organization_id=org_id,
    content_type=ContentType.NOTE,
    content_id=note.id,
    content_owner_id=note.owner_id,
    content_visibility=note.visibility,
)

# Check edit permission
can_edit = await checker.can_edit_content(
    user_id=user_id,
    organization_id=org_id,
    content_type=ContentType.NOTE,
    content_id=note.id,
    content_owner_id=note.owner_id,
    content_visibility=note.visibility,
)

# Get permission level
level = await checker.get_user_permission_level(
    user_id=user_id,
    organization_id=org_id,
    content_type=ContentType.NOTE,
    content_id=note.id,
    content_owner_id=note.owner_id,
)
```

### 2. Using ContentAccessQuery for Filtering

Best for: Querying lists of accessible content

```python
from uwos.services.permissions import ContentAccessQuery
from uwos.models.notes.note import Note
from sqlalchemy import select

query_builder = ContentAccessQuery(session)

# Build accessibility filter
access_filter = query_builder.build_accessible_filter(
    user_id=user_id,
    organization_id=org_id,
    content_type=ContentType.NOTE,
    content_id_column=Note.id,
    owner_id_column=Note.owner_id,
    visibility_column=Note.visibility,
)

# Use in query
result = await session.execute(
    select(Note)
    .where(Note.organization_id == org_id)
    .where(access_filter)
)
notes = result.scalars().all()
```

### 3. Using BaseContentService

Best for: Creating full-featured content services

```python
from uwos.services.permissions import BaseContentService
from uwos.models.shared import ContentType
from uwos.models.notes.note import Note

class NoteService(BaseContentService[Note]):
    def __init__(self, session: AsyncSession):
        super().__init__(
            session=session,
            content_type=ContentType.NOTE,
        )
    
    async def get_note(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
    ) -> Note:
        # Get note
        result = await self.session.execute(
            select(Note).where(Note.id == note_id)
        )
        note = result.scalar_one()
        
        # Check permission (raises PermissionError if denied)
        await self.require_access(user_id, organization_id, note)
        
        return note
```

## PermissionChecker API

### Access Checks

#### `can_access_content()`
Check if user can view content.

**Returns:** `bool`

**Use when:** Checking if user can see/read content

#### `can_edit_content()`
Check if user can modify content.

**Returns:** `bool`

**Use when:** Checking if user can update content

#### `can_delete_content()`
Check if user can delete content.

**Returns:** `bool`

**Use when:** Checking if user can remove content

#### `can_share_content()`
Check if user can share content with others.

**Returns:** `bool`

**Use when:** Checking if user can grant access to others

#### `can_move_content()`
Check if user can move content between spaces.

**Returns:** `bool`

**Use when:** Checking if user can change visibility/groups

#### `get_user_permission_level()`
Get the user's permission level (VIEW, EDIT, ADMIN, OWNER).

**Returns:** `PermissionLevel`

**Use when:** Need to know exact permission level

### Helper Methods

#### `get_content_groups()`
Get all groups that have access to content.

**Returns:** `list[UUID]`

#### `get_user_groups()`
Get all groups a user is a member of.

**Returns:** `list[UUID]`

## ContentAccessQuery API

### Filter Builders

#### `build_accessible_filter()`
Build WHERE clause for all accessible content (personal + groups + org).

**Returns:** SQLAlchemy filter expression

**Use when:** Getting all content user can access

```python
# Returns content where:
# - User is owner AND visibility = PRIVATE, OR
# - Visibility = ORGANIZATION, OR
# - Visibility = GROUP AND user is in one of the groups
```

#### `build_personal_filter()`
Build WHERE clause for user's personal content only.

**Returns:** SQLAlchemy filter expression

**Use when:** Getting only user's private content

```python
# Returns content where:
# - User is owner AND visibility = PRIVATE
```

#### `build_group_filter()`
Build WHERE clause for content in a specific group.

**Returns:** SQLAlchemy filter expression

**Use when:** Getting content shared with a specific group

```python
# Returns content where:
# - Visibility = GROUP AND content is linked to the group
```

#### `build_organization_filter()`
Build WHERE clause for organization-wide content.

**Returns:** SQLAlchemy filter expression

**Use when:** Getting content shared with entire organization

```python
# Returns content where:
# - Visibility = ORGANIZATION
```

### Query Helpers

#### `apply_visibility_filter()`
Apply accessibility filter to an existing query.

```python
query = select(Note).where(Note.title.like('%important%'))
query = query_builder.apply_visibility_filter(
    query=query,
    user_id=user_id,
    organization_id=org_id,
    content_type=ContentType.NOTE,
    content_id_column=Note.id,
    owner_id_column=Note.owner_id,
    visibility_column=Note.visibility,
)
```

## BaseContentService API

### Permission Checks (Async Methods)

#### `can_access()`, `can_edit()`, `can_delete()`, `can_share()`, `can_move()`
Check permissions on content object.

**Parameters:**
- `user_id: UUID`
- `organization_id: UUID`
- `content: T` (the content object)

**Returns:** `bool`

#### `require_access()`, `require_edit()`, `require_delete()`
Assert permission or raise `PermissionError`.

**Parameters:**
- `user_id: UUID`
- `organization_id: UUID`
- `content: T` (the content object)
- `error_message: str` (optional custom error)

**Raises:** `PermissionError` if permission denied

```python
# Use in service methods
await self.require_edit(user_id, org_id, note)
# Raises PermissionError if user can't edit
```

### Filter Getters

#### `get_accessible_filter()`, `get_personal_filter()`, `get_group_filter()`, `get_organization_filter()`
Get SQLAlchemy filter expressions.

**Parameters:**
- Varies by method (see ContentAccessQuery API)
- Plus: `model_class: type[T]` (e.g., `Note`)

**Returns:** SQLAlchemy filter expression

```python
# Get filter
filter_expr = service.get_accessible_filter(
    user_id=user_id,
    organization_id=org_id,
    model_class=Note,
)

# Use in query
notes = await session.execute(
    select(Note).where(filter_expr)
)
```

## Common Patterns

### Pattern 1: RPC Handler with Permission Check

```python
async def get_note_handler(request, context):
    note_service = NoteService(session)
    
    try:
        note = await note_service.get_note_with_permission_check(
            user_id=request.user_id,
            organization_id=request.organization_id,
            note_id=request.note_id,
        )
        return NoteResponse(note=note)
    except PermissionError as e:
        context.abort(grpc.StatusCode.PERMISSION_DENIED, str(e))
```

### Pattern 2: List with Different Filters

```python
async def list_notes_handler(request, context):
    note_service = NoteService(session)
    
    if request.personal_only:
        notes = await note_service.get_personal_notes(
            user_id=request.user_id,
            organization_id=request.organization_id,
        )
    elif request.group_id:
        notes = await note_service.get_group_notes(
            group_id=request.group_id,
            organization_id=request.organization_id,
        )
    else:
        notes = await note_service.get_accessible_notes(
            user_id=request.user_id,
            organization_id=request.organization_id,
        )
    
    return ListNotesResponse(notes=notes)
```

### Pattern 3: Update with Permission Check

```python
async def update_note_handler(request, context):
    # Get existing note
    result = await session.execute(
        select(Note).where(Note.id == request.note_id)
    )
    note = result.scalar_one()
    
    # Check edit permission
    checker = PermissionChecker(session)
    if not await checker.can_edit_content(
        user_id=request.user_id,
        organization_id=request.organization_id,
        content_type=ContentType.NOTE,
        content_id=note.id,
        content_owner_id=note.owner_id,
        content_visibility=note.visibility,
    ):
        context.abort(
            grpc.StatusCode.PERMISSION_DENIED,
            "You don't have permission to edit this note"
        )
    
    # Update note
    note.title = request.title
    note.content = request.content
    await session.commit()
    
    return NoteResponse(note=note)
```

### Pattern 4: Complex Query with Multiple Filters

```python
async def search_notes(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    search_query: str,
) -> list[Note]:
    query_builder = ContentAccessQuery(session)
    
    # Start with base query
    query = (
        select(Note)
        .where(Note.organization_id == organization_id)
        .where(Note.title.ilike(f'%{search_query}%'))
        .where(Note.is_deleted == False)
    )
    
    # Apply accessibility filter
    query = query_builder.apply_visibility_filter(
        query=query,
        user_id=user_id,
        organization_id=organization_id,
        content_type=ContentType.NOTE,
        content_id_column=Note.id,
        owner_id_column=Note.owner_id,
        visibility_column=Note.visibility,
    )
    
    result = await session.execute(query)
    return list(result.scalars().all())
```

## Creating Services for New Content Types

When adding a new content type (e.g., File, CalendarEvent):

1. **Add to `ContentType` enum** in `models/shared.py`
2. **Create model** with required fields:
   ```python
   class File(SQLModel, table=True):
       id: UUID
       organization_id: UUID
       owner_id: UUID
       visibility: VisibilityScope
       # ... type-specific fields
   ```

3. **Create service** extending `BaseContentService`:
   ```python
   class FileService(BaseContentService[File]):
       def __init__(self, session: AsyncSession):
           super().__init__(
               session=session,
               content_type=ContentType.FILE,
           )
       
       # Add type-specific methods
       async def upload_file(self, ...):
           ...
   ```

4. **Use in handlers** - all permission utilities work automatically!

## Best Practices

### ✅ Do

- Always check `organization_id` first (multi-tenancy boundary)
- Use `require_*()` methods in services (cleaner error handling)
- Use filters for list queries (more efficient than post-filtering)
- Cache `PermissionChecker` and `ContentAccessQuery` instances per request

### ❌ Don't

- Don't check permissions in models or repositories (keep in services)
- Don't skip organization checks (security risk)
- Don't load all content then filter (inefficient)
- Don't create new permission checking logic (use the utilities)

## Performance Tips

1. **Use filters over individual checks:**
   ```python
   # ✅ Good - single query with filter
   notes = await query_builder.get_accessible_content_ids(...)
   
   # ❌ Bad - check each item individually
   for note in all_notes:
       if await checker.can_access_content(...):
           accessible_notes.append(note)
   ```

2. **Reuse checker instances:**
   ```python
   # ✅ Good - one instance per request
   checker = PermissionChecker(session)
   for note in notes:
       if await checker.can_edit_content(...):
           ...
   
   # ❌ Bad - creates new instance each time
   for note in notes:
       checker = PermissionChecker(session)
       ...
   ```

3. **Use appropriate filter:**
   ```python
   # If you know it's personal only, use personal filter
   personal_filter = query_builder.build_personal_filter(...)  # Simpler query
   
   # Not accessible filter when not needed
   # accessible_filter = query_builder.build_accessible_filter(...)  # More complex
   ```

## Testing

```python
import pytest
from uwos.services.permissions import PermissionChecker
from uwos.models.shared import VisibilityScope

@pytest.mark.asyncio
async def test_owner_can_access(session):
    checker = PermissionChecker(session)
    
    # Owner should always have access
    can_access = await checker.can_access_content(
        user_id=owner_id,
        organization_id=org_id,
        content_type=ContentType.NOTE,
        content_id=note_id,
        content_owner_id=owner_id,  # Same as user_id
        content_visibility=VisibilityScope.PRIVATE,
    )
    
    assert can_access is True

@pytest.mark.asyncio
async def test_non_owner_cannot_access_private(session):
    checker = PermissionChecker(session)
    
    # Non-owner should not access private content
    can_access = await checker.can_access_content(
        user_id=other_user_id,
        organization_id=org_id,
        content_type=ContentType.NOTE,
        content_id=note_id,
        content_owner_id=owner_id,  # Different from user_id
        content_visibility=VisibilityScope.PRIVATE,
    )
    
    assert can_access is False
```

## See Also

- [Content Permission Architecture](architecture-content-permissions.md)
- [Examples](../src/uwos/services/permissions/examples.py)
- API Reference: `PermissionChecker`, `ContentAccessQuery`, `BaseContentService`
