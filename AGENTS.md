# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UWOS is a unified workspace where notes, files, chat, AI assistants, calendar, and workflows exist in one application. Every piece of information can be referenced from anywhere using universal `@` mentions.

## Commands

All commands are run from the repository root (`/home/user/src/uwos`):

```bash
# Setup
make install          # Install Python (uv) + Node (pnpm) dependencies
make proto            # Generate protobuf code (run after editing .proto files)

# Development
make dev              # Run backend + frontend concurrently
make run              # Backend only (localhost:8000)
make ui               # Frontend only (localhost:5173)

# Database
make db-up            # Start PostgreSQL 18 in Docker
make db-down          # Stop PostgreSQL
make db-reset         # Full reset (deletes all data)
make db-shell         # Connect to psql

# Code Quality
make lint             # Run ruff (Python) + ESLint (TypeScript)
make format           # Format Python code
make test             # Run pytest
```

### Creating Migrations

```bash
cd src/uwos
uv run alembic revision --autogenerate -m "description"
```

Migrations run automatically on startup.

## Architecture

### Stack

- **Backend**: Python 3.13+, FastAPI, SQLModel, asyncpg (async only)
- **Frontend**: React 19, TypeScript, Vite, Redux Toolkit, Tailwind CSS 4
- **API**: ConnectRPC (Protocol Buffers + Connect) - not REST
- **Database**: PostgreSQL 18 with pg_trgm extension

### Domain-Driven Vertical Slices

Each feature is self-contained in `src/uwos/domains/{feature}/`:

```
domains/{feature}/
├── converters.py     # Proto <-> domain mapping
├── queries.py        # Complex SQL (optional)
├── operations.py     # Business logic (extend BaseContentOperations for content)
├── handlers.py       # Thin RPC handlers
├── service.py        # Service class
└── __init__.py
```

### Adding a New Domain

1. Define proto in `src/proto/{service}/v1/{service}.proto`
2. Run `make proto`
3. Create model in `core/models/{feature}/` if needed
4. Create domain module in `domains/{feature}/`
5. Mount in `factory.py`:
   ```python
   from uwos.domains.feature.service import FeatureServiceImpl
   from uwos.gen.feature.v1.feature_connect import FeatureServiceASGIApplication

   service = FeatureServiceImpl()
   app.mount("/feature.v1.FeatureService", FeatureServiceASGIApplication(service))
   ```
6. Create Alembic migration if model added

### Key Backend Patterns

- **Async everywhere**: All database I/O must use `AsyncSession`
- **BaseContentOperations**: Extend this for content with automatic permission checking and search indexing
- **Type annotations required**: All Python functions need type hints + docstrings (PEP 257)
- **File size**: Target 300-400 lines, max 500. Split into sub-modules if larger
- **No inline imports**: All imports at file top

### Universal Resource Names (URNs)

UWOS uses URNs to uniquely identify all content across the system. This enables universal `@` mentions where any piece of content can reference any other.

**URN Format:**
```
urn:uwos:content:{TYPE}:{uuid}
```

**Supported Types:** `NOTE`, `FILE`, `CHAT`, `USER`, `BOOK`, `CALENDAR_EVENT`, `PASSWORD`, `SPACE`

**Backend Requirements:**
- All content models MUST have a `urn` property that returns the canonical URN
- All content MUST be indexed in the search service for `@` mention lookup
- Use `BaseContentOperations` which handles URN generation and search indexing automatically

**Example model URN property:**
```python
@property
def urn(self) -> str:
    return f"urn:uwos:content:{self.__class__.__name__.upper()}:{self.id}"
```

### Markdown Content Standard

All user-editable text content in UWOS MUST support Markdown with URN mentions.

**Requirements for all domains:**
1. Store content as Markdown text
2. Support `[[[label|urn]]]` syntax for inline mentions (parsed by the editor)
3. Render mentions as interactive chips that link to the referenced content
4. Use the shared Milkdown editor with mention plugin for editing

**Mention Format in Markdown:**
```markdown
Check out [[[My Note|urn:uwos:content:NOTE:uuid]]] for details.
Contact [[[John Doe|urn:uwos:content:USER:uuid]]] for questions.
```

### Multi-Tenancy

- All content scoped to `organization_id`
- Users are global, memberships are org-scoped
- Always verify user has access to organization before accessing resources

### Permission System

Three-layer system:
1. **VisibilityScope**: PRIVATE, GROUP, ORGANIZATION
2. **ContentGroupLink**: Links content to groups
3. **ContentPermission**: Fine-grained grants (VIEW, EDIT, ADMIN, OWNER)

Use `PermissionChecker` or `BaseContentOperations` (handles it automatically).

## Frontend

### Directory Structure

- `src/app/`: Redux store, hooks, router
- `src/features/`: Domain modules (auth, notes, etc.) with components, hooks, store
- `src/components/ui/`: Shared UI primitives
- `src/theme/`: Theme engine (dark/light + user accent colors)
- `src/gen/`: Generated ConnectRPC clients

### Adding a New Frontend Feature

Each feature is self-contained in `src/ui/src/features/{feature}/`:

```
features/{feature}/
├── api/
│   └── {feature}Api.ts      # ConnectRPC client wrapper
├── components/
│   ├── {Feature}Layout.tsx  # Main layout component
│   └── {subdomain}/         # Grouped components (editor/, sidebar/, etc.)
├── hooks/
│   └── use{Feature}Hooks.ts # Domain-specific React hooks
├── pages/
│   └── {Feature}Page.tsx    # Route-level page component
├── store/
│   ├── {feature}Slice.ts    # Redux slice (state + reducers)
│   └── {feature}Thunks.ts   # Async thunks (API calls)
├── styles/
│   └── {feature}.css        # Feature-specific styles (optional)
├── utils/
│   └── {feature}Utils.ts    # Helper functions (optional)
└── index.ts                 # Public exports (REQUIRED)
```

**Steps to add a new feature:**

1. Create the feature directory: `src/ui/src/features/{feature}/`

2. **API layer** (`api/{feature}Api.ts`):
   ```typescript
   import { createClient } from '@connectrpc/connect';
   import { transport } from '@/config/api';
   import { FeatureService } from '@/gen/feature/v1/feature_connect';

   const client = createClient(FeatureService, transport);

   export const featureApi = {
       getItem: async (request) => client.getItem(request),
       // ... other methods
   };
   ```

3. **Store layer** (`store/`):
   - `{feature}Slice.ts`: State shape, reducers, selectors
   - `{feature}Thunks.ts`: Async actions using `createAsyncThunk`
   - Register reducer in `src/app/store.ts`

4. **Hooks** (`hooks/use{Feature}Hooks.ts`):
   - Use `useAppDispatch` and `useAppSelector` from `@/app/hooks`
   - Wrap store interactions in reusable hooks

5. **Components** (`components/`):
   - Group related components in subdirectories
   - Use shared UI from `@/components/ui/`

6. **Page** (`pages/{Feature}Page.tsx`):
   - Wire up layout, sidebar, main content
   - Handle URL params with `useParams`
   - Add route in `src/app/router.tsx`

7. **Index exports** (`index.ts`) - Export everything public:
   ```typescript
   // API
   export { featureApi } from './api/featureApi';

   // Components
   export { FeatureLayout } from './components/FeatureLayout';

   // Pages
   export { default as FeaturePage } from './pages/FeaturePage';

   // Store - Slices & Actions
   export { default as featureReducer } from './store/featureSlice';
   export { someAction, anotherAction } from './store/featureSlice';

   // Store - Thunks
   export { fetchItems, createItem } from './store/featureThunks';

   // Hooks
   export { useFeatureData, useFeatureActions } from './hooks/useFeatureHooks';

   // Types
   export type { FeatureState } from './store/featureSlice';
   ```

**Key patterns:**
- All imports use `@/` path alias
- Thunks handle API calls, slices handle state updates
- Hooks abstract store interactions for components
- Components never call API directly (always through store/hooks)

### Path Aliases

Use `@/` for `src/` directory (e.g., `@/components/ui/button`).

### Theme System

**IMPORTANT: All new components MUST use the theme engine for colors and styling.**

The theme system (`src/theme/`) provides user-customizable accent colors with automatic text contrast calculation. It uses CSS variables set on `:root` that Tailwind 4 consumes.

**Available theme colors (use these Tailwind classes):**

| Purpose | Background | Text |
|---------|------------|------|
| Primary accent | `bg-primary` | `text-primary-foreground` |
| Base surfaces | `bg-background` | `text-foreground` |
| Cards/Popovers | `bg-card` | `text-card-foreground` |
| Subtle/muted | `bg-muted` | `text-muted-foreground` |
| Borders | `border-border` | - |
| Inputs | `bg-input` | - |
| Focus rings | `ring-ring` | - |

**Component styling rules:**

1. **Always use theme variables** - Never hardcode colors like `bg-zinc-900` or `bg-white`
2. **Cards and popovers** - Use `bg-card text-card-foreground border-border`
3. **Subtle backgrounds** - Use `bg-muted text-muted-foreground`
4. **Interactive elements** - Use `bg-primary text-primary-foreground` for buttons
5. **Borders** - Always use `border-border`, never `border-gray-200`

**Example - Correct popover styling:**
```tsx
<div className="bg-card text-card-foreground border border-border rounded-lg shadow-xl">
  <div className="bg-muted text-muted-foreground">Subtle section</div>
</div>
```

**Status colors (exception - use specific colors, NOT theme):**
- Success: `bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`
- Error: `bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400`
- Warning: `bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400`

**Type-specific accent colors (for URN types, badges, etc.):**
These are allowed as they represent semantic meaning:
- Notes: `bg-primary` (uses user's accent)
- Files: `border-blue-500`, `bg-blue-50 dark:bg-blue-950/30`
- Chat: `border-violet-500`, `bg-violet-50 dark:bg-violet-950/30`
- Users: `border-emerald-500`, `bg-emerald-50 dark:bg-emerald-950/30`

### Icons

Use `@heroicons/react/24/outline` for all icons.

### URN Utilities and Components

Use the shared URN utilities and components for consistent content referencing across all features.

**URN Utilities** (`@/utils/urn.ts`):
```typescript
import { parseUrn, buildUrn, urnToPath, getUrnIcon, getUrnTypeLabel, isValidUrn } from '@/utils/urn';

// Parse a URN to get type and ID
const parsed = parseUrn('urn:uwos:content:NOTE:uuid');
// { type: 'note', id: 'uuid', isValid: true, urn: '...' }

// Convert URN to navigation path
const path = urnToPath(urn); // '/notes/uuid'

// Get display info
const icon = getUrnIcon(urn);     // 'DocumentTextIcon'
const label = getUrnTypeLabel(urn); // 'Note'
```

**Navigation Utilities** (`@/utils/navigation.ts`):
```typescript
import { navigateTo, openInNewTab } from '@/utils/navigation';

// Navigate within the app (works from non-React code like ProseMirror plugins)
navigateTo('/notes/uuid');

// Open in new tab
openInNewTab('/notes/uuid');
```

**Mention Components** (`@/features/notes/components/editor/plugins/mention/`):
- `MentionChip`: Renders a URN as an interactive preview card with type icon and hover preview
- `MentionChipCompact`: Compact variant for space-constrained contexts
- `MentionPreview`: Hover preview popover showing content details
- `MentionSearch`: Search popup for `@` mentions using the search service
- `mentionPlugins`: Milkdown plugins for mention support (node, input rule, view, remark parser)
- `useUrnPreview`: Hook for fetching and caching URN preview data

**Using the Editor with Mentions:**
```typescript
import { mentionPlugins } from '@/features/notes/components/editor/plugins/mention';

// Register plugins with Milkdown/Crepe editor
editor.use(mentionPlugins);
```

**Search Integration** (`@/features/search`):
```typescript
import { useSearch, SearchResultsList } from '@/features/search';

// useSearch hook for @mention search
const { setQuery, results, isLoading } = useSearch();
```

## Critical Rules

1. Run `make proto` after editing `.proto` files
2. Always use async patterns in backend
3. Always check permissions in domain operations
4. Never hardcode colors in frontend
5. Use `@/` path alias in frontend imports
6. All content MUST have a URN and be searchable via the search service
7. All user-editable text MUST be stored as Markdown with `[[[label|urn]]]` mention support
8. Use shared URN utilities (`@/utils/urn.ts`) for parsing and displaying URNs
9. Use shared mention components for any feature that displays or edits content with mentions
