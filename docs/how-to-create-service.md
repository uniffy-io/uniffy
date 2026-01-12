# How to Create a New Service in UWOS

This guide explains how to add a new domain service (e.g., `Books`, `Files`, `Passwords`) ensuring it integrates correctly with the **Permissions System** and **Unified Search**.

## 1. Define Protocol Buffers

Create a new proto file in `proto/<domain>/v1/<domain>.proto`.

```protobuf
syntax = "proto3";
package books.v1;

import "google/protobuf/timestamp.proto";

// Define Service
service BooksService {
  rpc CreateBook(CreateBookRequest) returns (BookResponse);
  rpc UpdateBook(UpdateBookRequest) returns (BookResponse);
  // ...
}

// ... Messages ...
```

Run `buf generate` to create Python/TS stubs.

## 2. Define Database Model

Create the SQLModel in `src/uwos/models/<domain>/<entity>.py`.

 **CRITICAL:** All content models MUST include:
1. `organization_id` (Multi-tenancy)
2. `owner_id` (Ownership)
3. `visibility` (Access Control)

```python
from uwos.models.shared import VisibilityScope

class Book(SQLModel, table=True):
    id: UUID = Field(primary_key=True)
    organization_id: UUID
    owner_id: UUID
    visibility: VisibilityScope
    
    title: str
    description: str
    # ... domain fields
```

## 3. Implement Service Logic

Create `src/uwos/services/<domain>_service.py`.

### A. Permission Checking
Use `PermissionChecker` for all reads/updates.

```python
from uwos.services.permissions import PermissionChecker

checker = PermissionChecker(session)
can_access = await checker.can_access_content(
    user_id=user_id,
    organization_id=org_id,
    content_type=ContentType.BOOK,
    content_id=book.id,
    content_owner_id=book.owner_id,
    content_visibility=book.visibility
)
if not can_access:
    raise ConnectError(Code.PERMISSION_DENIED, "...")
```

### B. Search Indexing (The "Push" Pattern)
Services are responsible for keeping the Search Index up to date.
Call `upsert_search_index` on `Create` and `Update` operations.

**Import:**
```python
from uwos.services.search_service import upsert_search_index
```

**Implementation in Create/Update:**

```python
# 1. Commit main transaction
await session.commit()
await session.refresh(book)

# 2. Prepare Group IDs (if shared)
shared_group_ids = []
if book.visibility == VisibilityScope.GROUP:
    # Query ContentGroupLink for this book
    stmt = select(ContentGroupLink.group_id).where(
        ContentGroupLink.content_id == book.id,
        ContentGroupLink.content_type == ContentType.BOOK
    )
    result = await session.execute(stmt)
    shared_group_ids = list(result.scalars().all())

# 3. Push to Search Index
await upsert_search_index(
    session=session,
    urn=f"urn:uwos:content:book:{book.id}",  # Unique URN
    organization_id=book.organization_id,
    title=book.title,
    entity_type="book",
    url_path=f"/books/{book.id}",            # Frontend Route
    visibility=book.visibility.value,
    owner_id=book.owner_id,
    description=book.description[:200],
    keywords=f"{book.title} {book.author}",  # Indexable text
    shared_group_ids=shared_group_ids,
    shared_user_ids=None
)
await session.commit()
```

## 4. Updates & Deletes

- **On Delete:**
  You must remove the item from the search index (TODO: Implement `delete_from_index` helper).
- **On Move/Share:**
  If a service method changes permissions (e.g. `ShareBook`), it MUST also update the search index so the item becomes visible to the new users.

## 5. Register Service
Add the service to `src/uwos/factory.py` in the `create_app` function.

```python
# ...
books_app = BooksServiceASGIApplication(BooksServiceImpl())
app.mount("/books.v1.BooksService", books_app)
```
