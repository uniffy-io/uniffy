# Notes Autosave Architecture

## Overview

Notes in UWOS implement Notion-style autosave functionality that saves content automatically every second as users type, providing a seamless editing experience.

## How It Works

### 1. **Frontend Debouncing Strategy**

The frontend implements a debounced autosave mechanism:

```typescript
// Pseudocode
let autosaveTimer: NodeJS.Timeout | null = null;

function onContentChange(content: string) {
  // Clear existing timer
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
  }
  
  // Update local state immediately (optimistic UI)
  updateLocalContent(content);
  
  // Schedule autosave after 1 second of inactivity
  autosaveTimer = setTimeout(() => {
    autosaveNote(noteId, content);
  }, 1000);
}
```

**Key behaviors:**
- User types → timer resets
- User stops typing for 1 second → autosave triggers
- UI updates immediately (optimistic)
- Network request happens in background

### 2. **Autosave RPC Endpoint**

The `AutosaveNote` RPC is optimized for frequent, lightweight updates:

```protobuf
rpc AutosaveNote(AutosaveNoteRequest) returns (AutosaveNoteResponse) {}

message AutosaveNoteRequest {
  string note_id = 1;
  string organization_id = 2;
  string content = 3;                    // Main payload
  optional string title = 4;              // Also can update title
  int64 client_timestamp = 5;             // For conflict detection
}

message AutosaveNoteResponse {
  bool success = 1;
  google.protobuf.Timestamp saved_at = 2; // Server timestamp
  int64 version = 3;                      // Note version number
}
```

**Why separate from UpdateNote?**
- Lighter payload (no metadata, tags, etc.)
- Faster processing (skip unnecessary validations)
- Optimized database queries (update only content + version)
- Better for high-frequency calls

### 3. **Database Optimistic Locking**

The `Note` model includes a `version` field for conflict resolution:

```python
class Note(SQLModel, table=True):
    version: int = Field(default=1, nullable=False)
    # ... other fields
```

**Backend logic:**
```python
async def autosave_note(
    session: AsyncSession,
    note_id: UUID,
    content: str,
    expected_version: Optional[int] = None
) -> Note:
    # Fetch current note
    note = await session.get(Note, note_id)
    
    # Conflict detection (optional)
    if expected_version and note.version != expected_version:
        raise ConflictError("Note was modified by another user")
    
    # Update content and increment version
    note.content = content
    note.version += 1
    note.updated_at = datetime.utcnow()
    
    session.add(note)
    await session.commit()
    await session.refresh(note)
    
    return note
```

### 4. **Conflict Resolution**

When multiple users edit the same note:

**Option A: Last Write Wins (Simple)**
- Server always accepts the latest save
- Fast, but can lose data in rare race conditions

**Option B: Version-Based Conflict Detection (Recommended)**
- Client sends `client_timestamp` or last known `version`
- Server checks if note was modified since
- If conflict detected, returns error with current content
- Frontend shows conflict resolution UI (merge changes or pick one)

### 5. **Full-Text Search Updates**

The `content_search` TSVECTOR field is updated via database trigger:

```sql
CREATE TRIGGER notes_content_search_update
BEFORE INSERT OR UPDATE ON notes_notes
FOR EACH ROW
EXECUTE FUNCTION tsvector_update_trigger(
  content_search, 'pg_catalog.english', title, content
);
```

This happens automatically on every autosave without extra backend logic.

## Performance Optimizations

### Database Level
1. **Index on (organization_id, id)** - Fast note lookups
2. **Partial index on is_deleted = false** - Faster active note queries
3. **GIN index on content_search** - Fast full-text search
4. **Connection pooling** - Reuse database connections

### Backend Level
1. **Async I/O** - Non-blocking database operations
2. **Minimal validation** - Skip heavy checks for autosave
3. **Skip triggers if possible** - Update only necessary fields
4. **Batch operations** - Group multiple autosaves if needed

### Frontend Level
1. **Debouncing** - Limit network requests (1 sec idle)
2. **Optimistic updates** - UI feels instant
3. **Request cancellation** - Cancel pending autosave if new one triggered
4. **Background sync** - Non-blocking save operations

## Autosave Flow Example

```
User types: "Hello world"
  ↓
[Frontend]
  ├─ Update UI immediately (optimistic)
  ├─ Clear existing autosave timer
  └─ Start 1-second timer
  
User stops typing (1 sec passes)
  ↓
[Frontend]
  └─ Trigger autosaveNote() RPC call
  
[Backend]
  ├─ Validate user has write access
  ├─ UPDATE notes_notes SET 
  │    content = 'Hello world',
  │    version = version + 1,
  │    updated_at = NOW()
  │  WHERE id = ? AND organization_id = ?
  └─ Return AutosaveNoteResponse(success=true, version=2)
  
[Database Trigger]
  └─ Update content_search TSVECTOR automatically
  
[Frontend]
  ├─ Receive response
  ├─ Store new version (for conflict detection)
  └─ Show "Saved" indicator
```

## Edge Cases

### Network Failure
- Frontend shows "Saving..." indicator
- Retry with exponential backoff (3 attempts)
- If all fail, show "Not saved" warning
- Queue for next attempt when connection restored

### Multiple Tabs/Users
- Use version field for conflict detection
- When conflict detected:
  - Show notification to user
  - Offer merge UI or "overwrite" option
  - Preserve both versions in conflict log (future feature)

### Rapid Typing
- Debouncing ensures max 1 request per second
- Even if user types 100 chars/sec, only 1 save triggered
- Previous pending request cancelled if new one starts

### Very Large Notes
- Consider chunking for notes > 1MB
- Compress content for transmission (gzip)
- Stream large payloads instead of single request

## Future Enhancements

1. **Operational Transform (OT)** or **CRDT** for true real-time collaboration
2. **WebSocket** for live presence indicators
3. **Change history** with version snapshots for undo/redo
4. **Conflict merge UI** with diff visualization
5. **Offline mode** with IndexedDB cache and sync queue
