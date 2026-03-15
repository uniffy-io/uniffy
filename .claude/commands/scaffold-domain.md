---
description: Generate a comprehensive implementation plan for a new Uniffy domain
argument-hint: <domain-name> [description]
---

# Scaffold Domain: Plan a New Uniffy Domain

## Domain: $ARGUMENTS

## Objective

Generate a comprehensive, step-by-step implementation plan for adding a new domain to Uniffy. This command creates a plan document -- it does NOT write implementation code.

## Process

### Phase 1: Domain Understanding

Parse the domain name and description from the arguments.

**Determine domain characteristics:**

- **Is this a content type?** (needs URN, search indexing, permissions, bookmarks)
  - Examples: notes, files, calendar events, tasks, projects
  - If yes: must follow the Search Integration Checklist from CLAUDE.md
- **Is this a utility domain?** (supporting service without its own content)
  - Examples: search, settings, bookmarks, permissions
  - If yes: simpler setup, no URN/search/permissions overhead
- **Required proto methods**: Determine CRUD operations + any custom operations
- **Relationships**: How does this domain relate to existing domains?

### Phase 2: Pattern Analysis

Read an existing similar domain to extract the exact patterns to follow:

**For a content domain, read the notes domain as reference:**
- `src/proto/notes/v1/notes.proto`
- `src/uniffy/core/models/notes/`
- `src/uniffy/domains/notes/` (all files: operations.py, handlers.py, service.py, converters.py)
- `src/ui/src/features/notes/` (api, store, components, pages, hooks, index)

**For a utility domain, read the bookmarks or settings domain:**
- `src/proto/bookmarks/v1/bookmarks.proto` or `src/proto/settings/v1/settings.proto`
- Corresponding backend and frontend directories

**Also read:**
- `src/uniffy/factory.py` -- to understand service mounting pattern
- `src/ui/src/app/router.tsx` -- to understand route registration
- `src/ui/src/app/store.ts` -- to understand reducer registration
- `src/uniffy/core/models/shared.py` -- current ContentType enum
- `CLAUDE.md` -- critical rules and search integration checklist

### Phase 3: Generate Implementation Plan

Create a plan document at `.agents/plans/scaffold-{domain-name}.md` with the following structure:

```markdown
# Scaffold: {Domain Name}

## Overview

{Brief description of the domain, its purpose, and how it fits into Uniffy}

**Domain Type**: [Content Type / Utility Domain]
**Requires URN**: [Yes / No]
**Requires Search Integration**: [Yes / No]
**Requires Permissions**: [Yes / No]

---

## MANDATORY READING

Before implementing, read these files:

- `CLAUDE.md` -- critical rules
- `docs/agents/backend.md` -- backend patterns
- `docs/agents/frontend.md` -- frontend patterns
- {Reference domain files listed above}

---

## IMPLEMENTATION TASKS

Execute in order, top to bottom.

### Task 1: CREATE Proto Definition

**File:** `src/proto/{domain}/v1/{domain}.proto`

- Define service with RPC methods
- Define request/response messages
- Follow naming conventions from reference proto

**If content type, also UPDATE:**
- `src/proto/common/v1/common.proto` -- add `CONTENT_TYPE_{TYPE}`
- `src/proto/search/v1/search.proto` -- add `SEARCH_RESULT_TYPE_{TYPE}`

**VALIDATE:** `./run.sh proto`

### Task 2: CREATE Database Model

**File:** `src/uniffy/core/models/{domain}/`

- `__init__.py`
- `{domain}.py` -- SQLModel model class
- If content type: extend base content patterns, include `urn` property

**If content type, also UPDATE:**
- `src/uniffy/core/models/shared.py` -- add to `ContentType` enum

### Task 3: CREATE Alembic Migration

**VALIDATE:** `./run.sh db-migrate`

### Task 4: CREATE Backend Domain

**Directory:** `src/uniffy/domains/{domain}/`

Files to create:
- `__init__.py`
- `converters.py` -- proto <-> domain mapping
- `operations.py` -- business logic (extend `BaseContentOperations` if content type)
- `handlers.py` -- thin RPC handlers
- `service.py` -- service class

**If content type, also UPDATE:**
- `src/uniffy/core/converters/common_proto.py` -- add to `CONTENT_TYPE_TO_PROTO` and `CONTENT_TYPE_FROM_PROTO`
- `src/uniffy/domains/search/converters.py` -- add to `ENTITY_TYPE_TO_PROTO`
- `src/uniffy/domains/permissions/converters.py` -- add to `DOMAIN_CONTENT_TYPE_TO_PROTO`

### Task 5: UPDATE Backend Factory

**File:** `src/uniffy/factory.py`

- Import service and ASGI application
- Mount the service

**VALIDATE:** `./run.sh lint-backend`

### Task 6: CREATE Frontend API Layer

**File:** `src/ui/src/features/{domain}/api/{domain}Api.ts`

- Create ConnectRPC client wrapper
- Export API functions

### Task 7: CREATE Frontend Store

**Files:**
- `src/ui/src/features/{domain}/store/{domain}Slice.ts` -- state, reducers, selectors
- `src/ui/src/features/{domain}/store/{domain}Thunks.ts` -- async thunks

**UPDATE:** `src/ui/src/app/store.ts` -- register reducer

### Task 8: CREATE Frontend Components

**Directory:** `src/ui/src/features/{domain}/components/`

- Layout component with Zen Mode support
- List/detail components
- Form components

### Task 9: CREATE Frontend Pages

**File:** `src/ui/src/features/{domain}/pages/{Domain}Page.tsx`

- Must call `useDocumentTitle()`
- Must use `@/` absolute imports
- Must use named exports

**UPDATE:** `src/ui/src/app/router.tsx` -- add route

### Task 10: CREATE Frontend Index

**File:** `src/ui/src/features/{domain}/index.ts`

- Export all public APIs

### Task 11: COMPLETE Search Integration (content types only)

**Frontend files to UPDATE:**
- `src/ui/src/shared/utils/urnTypes.ts` -- add to `UrnType`
- `src/ui/src/config/theme/urnColors.ts` -- add hex color and theme
- `src/ui/src/config/theme/contentTypes.ts` -- add to `CONTENT_TYPE_CONFIG`
- `src/ui/src/features/search/utils/queryParser.ts` -- add to `TYPE_KEYWORD_MAP` and `FILTER_PREFIXES`
- `src/ui/src/features/search/components/SearchResultsList.tsx` -- add to `SEARCH_RESULT_TYPE_TO_URN_TYPE`

### Task 12: VALIDATE

```bash
./run.sh proto
./run.sh lint-backend
./run.sh lint-frontend
./run.sh format
./run.sh test
./run.sh test-frontend
```

---

## COMPLETION CHECKLIST

- [ ] Proto defined and generated
- [ ] Database model created with migration
- [ ] Backend domain complete (converters, operations, handlers, service)
- [ ] Backend mounted in factory.py
- [ ] Frontend feature complete (api, store, components, pages, hooks, index)
- [ ] Frontend route registered
- [ ] Frontend reducer registered
- [ ] Search integration complete (if content type)
- [ ] All validation commands pass
- [ ] Code follows CLAUDE.md critical rules
```

### Phase 4: Output

Write the plan to `.agents/plans/scaffold-{domain-name}.md`

Create the `.agents/plans/` directory if it doesn't exist.

Report:
- Plan file path
- Domain type (content vs utility)
- Number of files to create
- Number of files to update
- Key implementation considerations
