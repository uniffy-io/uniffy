# Unified Search Architecture

## Overview

UWOS provides a unified search experience powered by [Meilisearch](https://www.meilisearch.com/), a fast, typo-tolerant full-text search engine. Users can find any content across their workspace instantly using the Spotlight-style search (`Ctrl+K` / `Cmd+K`).

**The Vision:** "Everything is Referenceable." Users can find and reference any entity (Note, File, User, etc.) from anywhere in the platform.

## Core Concepts

### Universal Resource Names (URNs)

Every piece of content has a unique URN that serves as its global identifier:

**Format:** `urn:uwos:content:{TYPE}:{uuid}`

**Examples:**
- Note: `urn:uwos:content:NOTE:a1b2c3d4...`
- File: `urn:uwos:content:FILE:e5f6...`
- User: `urn:uwos:content:USER:1234...`

### Search Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Frontend  │────▶│   Backend    │────▶│   Meilisearch   │
│  (React)    │     │  (FastAPI)   │     │   (Search DB)   │
└─────────────┘     └──────────────┘     └─────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  PostgreSQL  │
                    │ (Source of   │
                    │   Truth)     │
                    └──────────────┘
```

- **PostgreSQL**: Source of truth for all content
- **Meilisearch**: Optimized search index with real-time sync
- **Backend**: Handles permission filtering and index management

## Meilisearch Configuration

### Index Settings

The search index (`search_index`) is configured with:

```python
{
    "searchableAttributes": ["title", "keywords", "description"],
    "filterableAttributes": [
        "organization_id",
        "entity_type",
        "visibility",
        "owner_id",
        "tags"
    ],
    "sortableAttributes": ["updated_at"],
    "rankingRules": [
        "words",
        "typo",
        "proximity",
        "attribute",
        "sort",
        "exactness"
    ]
}
```

### Document Structure

Each indexed document contains:

| Field | Type | Purpose |
|-------|------|---------|
| `id` | string | Document ID (URN with hyphens instead of colons) |
| `urn` | string | Original URN for the content |
| `organization_id` | string | Multi-tenant isolation |
| `title` | string | Primary search target |
| `description` | string | Snippet/subtitle |
| `keywords` | string | Combined searchable text |
| `entity_type` | string | Content type (note, file, user, etc.) |
| `url_path` | string | Frontend route for navigation |
| `visibility` | string | Permission scope |
| `owner_id` | string | Content owner |
| `tags` | array | Content tags for filtering |
| `updated_at` | timestamp | For recency ranking |

## Search Features

### Basic Search

Fuzzy, typo-tolerant search across all content:

```
meeting notes
docker setup
project plan
```

### Exact Phrase Search

Wrap phrases in double quotes for exact matching:

```
"docker --platform"
"npm install"
"connection refused"
```

### Type Filters

Filter by content type using prefix syntax:

| Filter | Description |
|--------|-------------|
| `note:` | Search only notes |
| `file:` | Search only files |
| `user:` | Search users |
| `calendar:` | Search calendar events |
| `chat:` | Search chat messages |
| `book:` | Search library books |
| `password:` | Search vault entries |
| `space:` | Search spaces |

### Tag Filters

Filter by tags:

```
tag:work
tag:urgent
tag:"project alpha"
```

### Ownership Filters

```
my:              # Only your content
owner:username   # Content by specific user
```

### Combined Filters

Mix and match for precise searches:

```
note: "kubernetes deploy" tag:production my:
```

## Backend Implementation

### Key Files

| File | Purpose |
|------|---------|
| `src/uwos/core/search/meilisearch.py` | Meilisearch client wrapper |
| `src/uwos/core/search/indexer.py` | SearchIndexer for CRUD operations |
| `src/uwos/domains/search/operations.py` | Search business logic |
| `src/uwos/domains/search/handlers.py` | RPC handlers |
| `src/uwos/domains/search/parser.py` | Query parser for keyword filters |

### SearchIndexer API

```python
from uwos.core.search.indexer import SearchIndexer, build_content_urn
from uwos.core.types import ContentType

# Index content
indexer = SearchIndexer(session)
await indexer.index(
    urn=build_content_urn(ContentType.NOTE, note.id),
    organization_id=org_id,
    title=note.title,
    entity_type=ContentType.NOTE.value,
    url_path=f"/notes/{note.id}",
    visibility=note.visibility.value,
    owner_id=note.owner_id,
    keywords=" ".join([note.title] + note.tags),
    description=note.content[:200],
    tags=note.tags,
)

# Remove from index
await indexer.remove(urn)
```

### Permission Filtering

Meilisearch queries include permission filters:

```python
filter_parts = [f'organization_id = "{org_id}"']

# Apply visibility and ownership filters
filter_parts.append(
    f'(visibility = "organization" OR owner_id = "{user_id}")'
)

# Apply type filters if specified
if type_filters:
    types = " OR ".join(f'entity_type = "{t}"' for t in type_filters)
    filter_parts.append(f"({types})")

# Apply tag filters
for tag in tag_filters:
    filter_parts.append(f'tags = "{tag}"')
```

## Frontend Implementation

### Key Files

| File | Purpose |
|------|---------|
| `src/ui/src/features/search/hooks/useSearch.ts` | Search hook with debouncing |
| `src/ui/src/features/search/utils/queryParser.ts` | Client-side query parser |
| `src/ui/src/features/search/components/SpotlightSearch.tsx` | Spotlight UI |
| `src/ui/src/features/search/components/SearchResultsList.tsx` | Results rendering |
| `src/ui/src/features/search/components/FilterChip.tsx` | Active filter chips |

### useSearch Hook

```typescript
import { useSearch } from '@/features/search';

const {
    query,
    setQuery,
    results,
    isLoading,
    parsedQuery,
    hasFilters
} = useSearch();
```

### Query Parser

The frontend parses queries to:
1. Extract filter keywords (`note:`, `tag:`, `my:`, etc.)
2. Detect exact phrases in quotes
3. Display active filters as chips
4. Send structured query to backend

## Adding New Content Types

When adding a new searchable content type:

1. **Index on create/update**: Call `SearchIndexer.index()` in your domain's operations
2. **Remove on delete**: Call `SearchIndexer.remove()`
3. **Update enums**: See CLAUDE.md "Search Integration Checklist"

## Docker Configuration

Meilisearch runs as a service in Docker Compose:

```yaml
meilisearch:
  image: getmeili/meilisearch:v1.12
  ports:
    - "7700:7700"
  environment:
    - MEILI_ENV=development
    - MEILI_MASTER_KEY=${MEILISEARCH_MASTER_KEY:-meilisearch-dev-key}
  volumes:
    - meilisearch_data:/meili_data
```

Environment variables:
- `MEILISEARCH_URL`: Meilisearch server URL (default: `http://localhost:7700`)
- `MEILISEARCH_MASTER_KEY`: API key for authentication

## Performance Characteristics

- **Instant search**: Results typically in <50ms
- **Typo tolerance**: Handles misspellings automatically
- **Real-time indexing**: Changes reflected immediately
- **Scalable**: Handles millions of documents efficiently
