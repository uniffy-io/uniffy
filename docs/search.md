# Unified Search & Tagging Implementation Plan

## 1. Overview
This document outlines the architecture for the **Universal Search** (Spotlight-like experience) and **Unified Tagging/Referencing** system (using `@` mentions).

**The Vision:** "Everything is Referenceable." Users must be able to find and reference any entity (Note, File, external Book, etc.) instantly from anywhere in the platform.

## 2. Core Concepts

### 2.1 Universal Resource Names (URNs)
To reference distinct entities uniformly, we use a URN schema. This is the **Primary Key** for the search system.

**Format:** `urn:uwos:<domain>:<entity_type>:<uuid>`

**Examples:**
- Note: `urn:uwos:content:note:a1b2-c3d4...`
- File: `urn:uwos:storage:file:e5f6...`
- User: `urn:uwos:system:user:1234...`

### 2.2 The Search Projection (Performance)
Instead of federated queries (joining multiple tables at query time), we maintain a **single optimized `search_index` table**.
- **Write Path:** When a Note/File is saved, a background task/trigger updates the `search_index`.
- **Read Path:** Search queries hit *only* this table.
- **Fuzziness:** We use Postgres `pg_trgm` (Trigrams) for typo-tolerant matching.

## 3. Architecture Layers

### 3.1 Database Layer (Postgres)

**Extension:**
- Enable `pg_trgm` extension for fuzzy matching.

**Table: `search_index`**
This table acts as a global phonebook.

```sql
CREATE TABLE search_index (
    urn TEXT PRIMARY KEY,               -- The Global ID
    organization_id UUID NOT NULL,      -- Multi-tenant isolation
    
    title TEXT NOT NULL,                -- Main matching target
    description TEXT,                   -- Snippet / Subtitle
    keywords TEXT,                      -- Combined text (Title + Tags + Filename) for heavy indexing
    
    entity_type TEXT NOT NULL,          -- 'note', 'file', 'book', 'chat'
    url_path TEXT NOT NULL,             -- Where the UI should route to (e.g., "/notes/123")
    
    -- Permissions (Denormalized)
    -- Simplified approach aligned with `architecture-content-permissions.md`
    -- 1. visibility: 'private', 'group', 'organization'
    -- 2. owner_id: UUID
    -- 3. shared_group_ids: UUID[] (List of Group IDs this is shared with)
    -- 4. shared_user_ids: UUID[] (List of User IDs granted explicit permission)
    
    visibility TEXT NOT NULL,
    owner_id UUID NOT NULL,
    shared_group_ids UUID[],
    shared_user_ids UUID[],

    updated_at TIMESTAMPTZ,
    rank_score FLOAT DEFAULT 1.0        -- Boost recently updated items
);

-- Indexes
CREATE INDEX ix_search_trgm ON search_index USING GIN (keywords gin_trgm_ops);
CREATE INDEX ix_search_visibility ON search_index (visibility);
CREATE INDEX ix_search_perm ON search_index USING GIN (shared_group_ids, shared_user_ids);
```

### 3.2 Backend Layer (Python/FastAPI/ConnectRPC)

**Service: `SearchService`**
- **RPC `Search(query)`**:
  - Accepts text query.
  - Generates SQL with Trigram similarity (`%`) on `keywords`.
  - **Permission Filter Logic:**
    ```sql
    WHERE organization_id = :org_id
      AND (
        -- 1. Optimization: Public Organization Content
        visibility = 'organization'
        OR
        -- 2. Optimization: Owner Access
        owner_id = :user_id
        OR
        -- 3. Group Access (If user is in these groups)
        (visibility = 'group' AND shared_group_ids && :user_group_ids)
        OR
        -- 4. Direct Sharing
        (shared_user_ids @> ARRAY[:user_id])
      )
    ```
  - Returns `SearchResponse` (list of results).
- **RPC `IndexItem` / Background Events**:
  - Listen for "Note Created/Updated" events.
  - UPSERT into `search_index`.

**Referencing Logic (Tagging):**
- When content (like a Note) is saved, we parse strict references.
- **Note Model Update:** Add `outgoing_references` column (`JSONB`).
- Store URNs: `['urn:uwos:note:123', 'urn:uwos:file:456']`.
- This allows generic "Backlink" queries: `SELECT * FROM notes WHERE outgoing_references @> '["urn:..."]'`.

### 3.3 Frontend Layer (React/TypeScript)

**Command Palette (`Cmd+K`) & Mentions (`@`)**
- **State Machine:**
  - `Idle` -> `Debounce (150ms)` -> `Fetching` -> `Results`.
- **Debouncing:**
  - Prevents network flood. Only fire request after user pauses typing.
- **Optimistic UI:**
  - Show "Recent Items" instantly before search results arrive.
- **Result Handling:**
  - Clicking a result inserts a "Smart Chip" into the editor: `@[Title](urn:...)`.

---

## 4. Implementation Tasks (Agent Split)

### 🤖 Task 1: Database & Models Agent
**Objective:** Set up the foundation data structures.
1.  **Migration:** Create migration for `pg_trgm` extension.
2.  **Schema:** Create `search_index` table (SQLModel) in `src/uwos/models/search.py`.
    - Align fields with Permission System: `visibility`, `owner_id`, `shared_group_ids`, `shared_user_ids`.
3.  **Update Content Models:** Add `outgoing_references` (JSONB) to `Note` model (and future File model).
4.  **Triggers (Optional but recommended):** Or prepared SQL statements for efficient UPSERT into index.

### 🤖 Task 2: Backend Services Agent
**Objective:** Implement the Search Logic and Ingestion.
1.  **Service Skeleton:** Implement `SearchService` in `src/uwos/services/search_service.py`.
2.  **Query Logic:** Write the complex SQLAlchemy select statement:
    - Trigram similarity on `title`/`keywords`.
    - **Permission Logic:** Replicate the OR condition (Org vs Owner vs Group vs Explicit).
    - Ranking/Sorting.
3.  **Ingestion/Sync:**
    - Create a utility function `index_entity(entity, type)`.
    - Hook into `NotesService.CreateNote` and `UpdateNote` to call `index_entity`.
    - *Constraint:* Ensure this happens asynchronously or after commit to not block the UI.

### 🤖 Task 3: Frontend Interface Agent
**Objective:** The user experience.
1.  **Client Generation:** Run `buf generate` to get the new Search client.
2.  **Hook:** Create `useUnifiedSearch(query)` hook with internal debouncing (use `useDebounce` from a library or custom).
3.  **UI Component (`CommandPalette`):**
    - A modal dialog (like helper kit or cmdk).
    - Input field with auto-focus.
    - List rendering of `SearchResultItem`.
    - Keyboard navigation (Arrow keys).
4.  **Editor Integration:**
    - Detect `@` keypress.
    - Anchor the palette to the cursor.
    - On select, insert Markdown link: `[Title](urn:...)`.

### 🤖 Task 4: Content Linkage Agent (Data Integrity)
**Objective:** Ensure references are robust.
1.  **Reference Parsing:** Create a Backend utility that scans Note content for `(urn:...)` patterns on save.
2.  **Storage:** Populate the `outgoing_references` column automatically based on parsed URNs.
3.  **Resolution Endpoint:** Implement `ResolveReferences` RPC that takes a list of URNs and returns current Titles/Metadata (so old links update their display text).

---

## 5. Security & Multi-Tenancy
- **Strict Rule:** Every query to `search_index` MUST include `organization_id`.
- **ACLs:** `acl` logic relies on accurate `shared_group_ids` replication from `ContentGroupLink` table.
