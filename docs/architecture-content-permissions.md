# Content Permission System

## Overview

UWOS implements a **generic, flexible permission system** that works for all content types (notes, files, calendar events, books, passwords, workflows, etc.). This system provides three levels of access control:

1. **Personal Space** - Private content accessible only to the owner
2. **Group Space** - Content shared with specific group(s)
3. **Organization Space** - Content accessible to all organization members

## Architecture

### Core Components

#### 1. Visibility Scopes (`VisibilityScope` enum)

```python
class VisibilityScope(str, Enum):
    PRIVATE = "private"          # Personal space - only owner
    GROUP = "group"              # Shared with specific group(s)
    ORGANIZATION = "organization" # Shared with entire org
    PUBLIC = "public"            # Public (future feature)
```

#### 2. Content Models

All content types include these common fields:

```python
organization_id: UUID          # Which organization (multi-tenancy boundary)
owner_id: UUID                 # Who owns/created it
visibility: VisibilityScope    # Who can access it
```

Example (Note model):

```python
class Note(SQLModel, table=True):
    id: UUID
    organization_id: UUID
    owner_id: UUID
    visibility: VisibilityScope = VisibilityScope.PRIVATE
    title: str
    content: str
    # ... other note-specific fields
```

#### 3. ContentGroupLink Table

Associates content with groups for shared access:

```python
class ContentGroupLink(SQLModel, table=True):
    id: UUID
    organization_id: UUID
    content_type: ContentType      # "note", "file", "calendar_event", etc.
    content_id: UUID               # ID of the content
    group_id: UUID                 # Group it's shared with
    linked_by_user_id: UUID        # Who shared it
    linked_at: datetime
```

**Features:**
- Polymorphic: works with any content type
- Many-to-many: content can be in multiple groups
- Auditable: tracks who shared and when

#### 4. ContentPermission Table

Provides fine-grained access control:

```python
class ContentPermission(SQLModel, table=True):
    id: UUID
    organization_id: UUID
    content_type: ContentType      # What type of content
    content_id: UUID               # Which content
    subject_type: SubjectType      # "user", "group", "organization"
    subject_id: UUID               # ID of user/group/org
    permission_level: PermissionLevel  # VIEW, EDIT, ADMIN, OWNER
    
    # Fine-grained flags
    can_view: bool
    can_edit: bool
    can_delete: bool
    can_share: bool
    can_move: bool
    
    granted_by_user_id: UUID
    granted_at: datetime
    expires_at: datetime | None    # Optional expiration
```

**Permission Levels:**
- `VIEW` - Read-only access
- `EDIT` - Can view and modify
- `ADMIN` - Can view, edit, delete, share
- `OWNER` - Full control including ownership transfer

## Access Control Logic

### Personal Space (`PRIVATE`)

**Conditions:**
- `visibility = PRIVATE`
- No `ContentGroupLink` entries

**Access:**
- Only `owner_id` can access
- No other users can see or access

**Use Cases:**
- Personal notes/drafts
- Private documents
- User-specific passwords

### Group Space (`GROUP`)

**Conditions:**
- `visibility = GROUP`
- One or more `ContentGroupLink` entries

**Access:**
- All members of linked groups can access
- Check via `GroupMember` table
- Can be shared with multiple groups simultaneously

**Use Cases:**
- Team documents
- Shared project notes
- Group calendars

### Organization Space (`ORGANIZATION`)

**Conditions:**
- `visibility = ORGANIZATION`
- No `ContentGroupLink` entries (shared with everyone)

**Access:**
- All members of the organization can access
- Check via `OrganizationMember` table

**Use Cases:**
- Company-wide policies
- Public announcements
- Shared resources

### Public Space (`PUBLIC`)

**Conditions:**
- `visibility = PUBLIC`

**Access:**
- Accessible externally (future feature)
- For public sharing outside the organization

**Use Cases:**
- Published blog posts
- Public documentation
- Shared portfolios

## Operations

### Creating Content

**Default:** Content is created as `PRIVATE` (personal space)

```python
note = Note(
    organization_id=org_id,
    owner_id=user_id,
    visibility=VisibilityScope.PRIVATE,
    title="My Private Note"
)
```

**With Group Sharing:**

```python
note = Note(
    organization_id=org_id,
    owner_id=user_id,
    visibility=VisibilityScope.GROUP,
    title="Team Note"
)
# Create group links
ContentGroupLink(
    content_type=ContentType.NOTE,
    content_id=note.id,
    group_id=team_group_id
)
```

### Moving Content Between Spaces

#### Personal → Group

```python
# Update visibility
note.visibility = VisibilityScope.GROUP

# Add group association
ContentGroupLink.create(
    content_type=ContentType.NOTE,
    content_id=note.id,
    group_id=target_group_id,
    linked_by_user_id=current_user_id
)
```

#### Group → Personal

```python
# Update visibility
note.visibility = VisibilityScope.PRIVATE

# Remove all group associations
ContentGroupLink.delete_all_for_content(
    content_type=ContentType.NOTE,
    content_id=note.id
)
```

#### Personal/Group → Organization

```python
# Update visibility
note.visibility = VisibilityScope.ORGANIZATION

# Remove group associations (optional, not needed for ORG visibility)
ContentGroupLink.delete_all_for_content(
    content_type=ContentType.NOTE,
    content_id=note.id
)
```

### Copying Content

Create a duplicate with different ownership/visibility:

```python
new_note = Note(
    organization_id=note.organization_id,
    owner_id=current_user_id,  # New owner
    visibility=target_visibility,
    title=note.title + " (Copy)",
    content=note.content,
    # ... copy other fields
)

# If copying to group, add group links
if target_visibility == VisibilityScope.GROUP:
    for group_id in target_group_ids:
        ContentGroupLink.create(
            content_type=ContentType.NOTE,
            content_id=new_note.id,
            group_id=group_id
        )
```

### Sharing with Additional Groups

Keep existing visibility, add more groups:

```python
# Note remains GROUP visibility
# Just add another group link
ContentGroupLink.create(
    content_type=ContentType.NOTE,
    content_id=note.id,
    group_id=additional_group_id,
    linked_by_user_id=current_user_id
)
```

### Granting Fine-Grained Permissions

For specific user access outside of normal visibility:

```python
ContentPermission.create(
    content_type=ContentType.NOTE,
    content_id=note.id,
    subject_type=SubjectType.USER,
    subject_id=specific_user_id,
    permission_level=PermissionLevel.EDIT,
    can_view=True,
    can_edit=True,
    can_delete=False,
    granted_by_user_id=note.owner_id
)
```

## Query Patterns

### List User's Personal Notes

```python
notes = await session.execute(
    select(Note)
    .where(Note.organization_id == org_id)
    .where(Note.owner_id == user_id)
    .where(Note.visibility == VisibilityScope.PRIVATE)
)
```

### List Notes in a Group

```python
# Get content IDs for the group
group_links = await session.execute(
    select(ContentGroupLink.content_id)
    .where(ContentGroupLink.group_id == group_id)
    .where(ContentGroupLink.content_type == ContentType.NOTE)
)
content_ids = [link.content_id for link in group_links]

# Get the notes
notes = await session.execute(
    select(Note)
    .where(Note.id.in_(content_ids))
    .where(Note.visibility == VisibilityScope.GROUP)
)
```

### List All Accessible Notes for User

```python
# User's own private notes
private_notes = Note.owner_id == user_id AND Note.visibility == PRIVATE

# Organization-wide notes
org_notes = Note.organization_id == org_id AND Note.visibility == ORGANIZATION

# Group notes (user is member of groups)
user_groups = get_user_groups(user_id, org_id)
group_content_ids = get_content_ids_for_groups(user_groups, ContentType.NOTE)
group_notes = Note.id.in_(group_content_ids) AND Note.visibility == GROUP

# Combine with OR
notes = await session.execute(
    select(Note)
    .where(or_(private_notes, org_notes, group_notes))
)
```

### Check Access Permission

```python
def can_access_note(user_id: UUID, note: Note) -> bool:
    # Owner always has access
    if note.owner_id == user_id:
        return True
    
    # Organization visibility
    if note.visibility == VisibilityScope.ORGANIZATION:
        return is_user_in_org(user_id, note.organization_id)
    
    # Group visibility
    if note.visibility == VisibilityScope.GROUP:
        user_groups = get_user_groups(user_id, note.organization_id)
        note_groups = get_note_groups(note.id)
        return bool(set(user_groups) & set(note_groups))
    
    # Private - only owner
    if note.visibility == VisibilityScope.PRIVATE:
        return False
    
    # Check explicit permissions
    return has_explicit_permission(user_id, ContentType.NOTE, note.id)
```

## Database Schema

### Indexes for Performance

**ContentGroupLink:**
- `(organization_id)` - Filter by org
- `(content_type, content_id)` - Find groups for content
- `(group_id, content_type)` - Find content in group
- `(group_id)` - All content in group

**ContentPermission:**
- `(organization_id)` - Filter by org
- `(content_type, content_id)` - Find permissions for content
- `(subject_type, subject_id, content_type, content_id)` - Check user permission
- `(subject_id)` - All permissions for user/group

**Note (and other content):**
- `(organization_id)` - Filter by org
- `(owner_id)` - User's content
- `(visibility)` - Filter by access level

## Migration Path

The migration `005_add_content_permission_system.py` includes:

1. Create enum types for visibility, content types, permissions
2. Add `visibility` and `owner_id` to `notes_notes`
3. Migrate existing `created_by` → `owner_id`
4. Create `permissions_content_group_links` table
5. Create `permissions_content_permissions` table
6. Add necessary indexes

**Backward Compatibility:**
- Existing notes default to `PRIVATE` visibility
- `owner_id` is copied from `created_by`
- No breaking changes to existing data

## Future Content Types

This system is designed to scale. When adding new content types:

1. Add enum value to `ContentType`
2. Create model with common fields:
   ```python
   class NewContent(SQLModel, table=True):
       id: UUID
       organization_id: UUID
       owner_id: UUID
       visibility: VisibilityScope
       # ... type-specific fields
   ```
3. No changes needed to permission tables (polymorphic)
4. Update proto definitions with new enum value

**Examples:**
- `ContentType.FILE` for file uploads
- `ContentType.CALENDAR_EVENT` for calendar
- `ContentType.BOOK` for reading library
- `ContentType.PASSWORD` for password manager
- `ContentType.WORKFLOW` for automations

## Best Practices

### Security

- Always check `organization_id` first (multi-tenancy boundary)
- Verify user membership before granting access
- Use `owner_id` for ownership checks, not just `created_by`
- Log permission changes for audit trail

### Performance

- Use indexes for common query patterns
- Cache user group memberships
- Batch permission checks when possible
- Use `ContentGroupLink` for group queries, not direct joins

### UX

- Default to `PRIVATE` for new content (secure by default)
- Provide easy "Move to Group" actions
- Show clear indicators of visibility in UI
- Allow multi-select for batch operations

### Development

- Use the same permission checking logic everywhere
- Create helper functions for common access checks
- Test all visibility transitions
- Document any content-type-specific behavior

## API Examples (Proto)

### Create Private Note

```protobuf
CreateNoteRequest {
  organization_id: "org-123"
  title: "My Private Note"
  content: "Secret content"
  visibility: VISIBILITY_SCOPE_PRIVATE
}
```

### Create Group Note

```protobuf
CreateNoteRequest {
  organization_id: "org-123"
  title: "Team Planning"
  content: "Team content"
  visibility: VISIBILITY_SCOPE_GROUP
  group_ids: ["group-456"]
}
```

### Move to Group

```protobuf
MoveNoteRequest {
  note_id: "note-789"
  organization_id: "org-123"
  target_visibility: VISIBILITY_SCOPE_GROUP
  target_group_ids: ["group-456", "group-789"]
}
```

### Share with Additional Group

```protobuf
ShareNoteWithGroupRequest {
  note_id: "note-789"
  organization_id: "org-123"
  group_id: "group-999"
}
```

### Grant User Permission

```protobuf
GrantPermissionRequest {
  note_id: "note-789"
  organization_id: "org-123"
  subject_type: "user"
  subject_id: "user-555"
  permission_level: PERMISSION_LEVEL_EDIT
  can_view: true
  can_edit: true
  can_delete: false
}
```

## Summary

The UWOS content permission system provides:

✅ **Universal** - Works for all content types  
✅ **Flexible** - Personal, group, and org-wide sharing  
✅ **Scalable** - Polymorphic design for future content  
✅ **Performant** - Indexed for common queries  
✅ **Auditable** - Tracks who shared what and when  
✅ **Secure** - Multi-tenant with proper access control  

Users can seamlessly move content between personal space and group spaces, share with multiple groups, and collaborate effectively while maintaining privacy and security.
