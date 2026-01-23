## Project Overview

UWOS is a unified workspace where notes, files, chat, AI assistants, calendar, and workflows exist in one application. Every piece of information can be referenced from anywhere using universal `@` mentions.

## Commands

All commands are run from the repository root:

```bash
# Setup
make install          # Install Python (uv) + Node (pnpm) dependencies
make proto            # Generate protobuf code (run after editing .proto files)

# Code Quality
make test             # Run pytest
```

Migrations run automatically on startup.

## Architecture

### Stack

- **Backend**: Python 3.13+, FastAPI, SQLModel, asyncpg (async only)
- **Frontend**: React 19, TypeScript, Vite, Redux Toolkit, Tailwind CSS 4
- **API**: ConnectRPC (Protocol Buffers + Connect) - not REST
- **Database**: PostgreSQL 18
- **Search**: Meilisearch (typo-tolerant full-text search)

### BackendTree Structure

`src/uwos/` is the root backend dir:

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
7. **If adding searchable content type**: Complete the Search Integration Checklist below

### Search Integration Checklist

When adding a new content type (e.g., `TASK`, `DOCUMENT`), you MUST update these hardcoded enums/mappings:

**Proto (regenerate after editing):**
| File | What to update |
|------|----------------|
| `src/proto/search/v1/search.proto` | Add `SEARCH_RESULT_TYPE_{TYPE}` to `SearchResultType` enum |

**Backend:**
| File | What to update |
|------|----------------|
| `src/uwos/domains/search/converters.py` | Add mapping in `ENTITY_TYPE_TO_PROTO` dict |
| `src/uwos/core/types.py` | Add to `ContentType` enum (if applicable) |

**Frontend (all files have switch statements or Record mappings):**
| File | What to update |
|------|----------------|
| `src/ui/src/utils/urn.ts` | Add to `UrnType` const, `urnToPath()` route map, `getUrnIcon()`, `getUrnTypeLabel()` |
| `src/ui/src/theme/urnColors.ts` | Add to `URN_TYPE_HEX_COLORS`, `URN_TYPE_THEMES`, and `URN_TYPE_LEGEND` |
| `src/ui/src/features/search/utils/queryParser.ts` | Add to `TYPE_KEYWORD_MAP`, `FILTER_PREFIXES`, `getTypeFilterLabel()`, `getTypeFilterKeyword()` |
| `src/ui/src/features/search/components/SearchResultsList.tsx` | Add to `RESULT_TYPE_ICONS`, `RESULT_TYPE_TO_URN_TYPE`, `getResultTypeLabel()` |

**Example - Adding a TASK type:**

1. **Proto** (`search.proto`):
   ```protobuf
   enum SearchResultType {
     // ... existing types
     SEARCH_RESULT_TYPE_TASK = 10;
   }
   ```

2. **Backend converters** (`converters.py`):
   ```python
   ENTITY_TYPE_TO_PROTO: dict[str, SearchResultType] = {
       # ... existing mappings
       "task": SearchResultType.SEARCH_RESULT_TYPE_TASK,
   }
   ```

3. **Frontend URN utils** (`urn.ts`):
   ```typescript
   export const UrnType = {
     // ... existing types
     TASK: 'task',
   } as const;

   // Add to routeMap in urnToPath()
   [UrnType.TASK]: 'tasks',

   // Add to iconMap in getUrnIcon()
   [UrnType.TASK]: 'ClipboardDocumentListIcon',

   // Add to labelMap in getUrnTypeLabel()
   [UrnType.TASK]: 'Task',
   ```

4. **Frontend theme colors** (`urnColors.ts`):
   ```typescript
   [UrnType.TASK]: '#14b8a6', // teal-500

   [UrnType.TASK]: {
     gradient: 'from-teal-500/10 via-teal-500/5 to-transparent',
     iconBg: 'bg-gradient-to-br from-teal-500 to-teal-600',
     accentText: 'text-teal-600 dark:text-teal-400',
     badgeBg: 'bg-teal-500/10',
     border: 'border-teal-500/20',
     shadow: 'shadow-teal-500/50',
   },
   ```

5. **Frontend query parser** (`queryParser.ts`):
   ```typescript
   const TYPE_KEYWORD_MAP = {
     // ... existing mappings
     'task': SearchResultType.TASK,
     'tasks': SearchResultType.TASK,
   };

   const FILTER_PREFIXES = [
     // ... existing prefixes
     'task', 'tasks',
   ];
   ```

6. **Frontend search results** (`SearchResultsList.tsx`):
   ```typescript
   const RESULT_TYPE_ICONS = {
     [SearchResultType.TASK]: ClipboardDocumentListIcon,
   };

   const RESULT_TYPE_TO_URN_TYPE = {
     [SearchResultType.TASK]: UrnType.TASK,
   };
   ```

Run `make proto` after updating the proto file to regenerate TypeScript and Python bindings.

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

### Authentication System

JWT-based authentication with access/refresh token pattern. Users authenticate globally, then select an organization context.

**Key Files:**

| Layer | File | Purpose |
|-------|------|---------|
| Proto | `src/proto/auth/v1/auth.proto` | API contract (Login, Register, RefreshToken, etc.) |
| Backend | `src/uwos/domains/auth/operations.py` | Auth business logic (login, refresh, token validation) |
| Backend | `src/uwos/domains/auth/tokens.py` | JWT creation/validation (access + refresh tokens) |
| Backend | `src/uwos/domains/auth/handlers.py` | RPC handlers |
| Backend | `src/uwos/core/models/login/user.py` | User model with `token_version` for revocation |
| Frontend | `src/ui/src/config/api.ts` | Token storage, refresh, rehydration, auth interceptor |
| Frontend | `src/ui/src/features/auth/store/authSlice.ts` | Auth state (user, tokens, org ID) |
| Frontend | `src/ui/src/components/auth/ProtectedRoute.tsx` | Route guard (redirects unauthenticated users) |

**Token Flow:**

1. **Login**: User authenticates → receives `access_token` (short-lived) + `refresh_token` (long-lived)
2. **Access token**: Stored in memory only (security - not in localStorage). Contains `user_id`, `org_id`, `token_version`
3. **Refresh token**: Persisted via redux-persist. Contains `user_id`, `token_version` (no org context)
4. **Organization context**: Stored separately in Redux state (`currentOrganizationId`), persisted to localStorage

**Page Refresh / Rehydration:**

On page load, `rehydrateAuth()` in `api.ts`:
1. Reads `refreshToken` and `currentOrganizationId` from localStorage (via `getAuthState()`)
2. Calls backend `RefreshToken` RPC to get new access token
3. Restores org context from localStorage (backend doesn't return org ID on refresh)
4. Updates Redux state via `rehydrateComplete` action

**Route Protection:**

`ProtectedRoute` component checks:
1. `isRehydrating` - shows loading while refreshing token
2. `isAuthenticated` - redirects to `/auth` if not logged in
3. `currentOrganizationId` - redirects to `/select-org` if no org selected

**Token Revocation:**

- `User.token_version` field enables immediate token revocation
- Incrementing `token_version` invalidates all existing tokens for that user
- Backend validates `token_version` on every refresh

**Important Patterns:**

- Access tokens are NEVER persisted (memory only via `memoryAccessToken` in `api.ts`)
- Auth interceptor in `api.ts` auto-refreshes expiring tokens before API calls
- Organization context must be preserved separately from tokens (tokens don't carry org on refresh)

**Logout Cleanup:**

On logout, ALL user/org-specific state must be cleared. See `UserMenu.tsx` and `OrganizationPicker.tsx` for reference:

```typescript
import { clearMemoryAccessToken } from "@/config";
import { logout } from "@/features/auth/store/authSlice";
import { resetSettings } from "@/features/settings/store/settingsSlice";
import { clearNotes } from "@/features/notes/store/notesSlice";
import { clearTree } from "@/features/notes/store/notesTreeSlice";
import { clearBookmarks } from "@/features/bookmarks";

const handleLogout = () => {
  clearMemoryAccessToken();  // Security: clear JWT from memory
  dispatch(logout());        // Clear auth state (user, tokens, org ID)
  dispatch(resetSettings()); // Clear user settings
  dispatch(clearNotes());    // Clear org-specific notes
  dispatch(clearTree());     // Clear org-specific note tree
  dispatch(clearBookmarks()); // Clear user bookmarks
  navigate('/auth');
};
```

When adding new features with user/org-specific state, add a reset action and include it in logout handlers.

### Permission System

Three-layer system:
1. **VisibilityScope**: PRIVATE, GROUP, ORGANIZATION
2. **ContentGroupLink**: Links content to groups
3. **ContentPermission**: Fine-grained grants (VIEW, EDIT, ADMIN, OWNER)

Use `PermissionChecker` or `BaseContentOperations` (handles it automatically).

### Bookmarks System

UWOS provides a unified bookmarks system for users to save and quick-access any content. **Do NOT implement domain-specific favorites, pinned, or starred functionality** - use the shared bookmarks feature instead.

**Key Characteristics:**
- **User-scoped**: Each user has their own personal bookmarks (not shared)
- **URN-based**: Can bookmark any content type via its URN
- **Unified UI**: Single "Bookmark" action with `BookmarkIcon` across all domains
- **Centralized storage**: All bookmarks stored in `bookmarks` table with unique constraint on `(user_id, urn)`

**Key Files:**

| Layer | File | Purpose |
|-------|------|---------|
| Proto | `src/proto/bookmarks/v1/bookmarks.proto` | API contract (Toggle, List, BulkCheck) |
| Backend | `src/uwos/core/models/bookmarks/bookmark.py` | Bookmark model |
| Backend | `src/uwos/domains/bookmarks/operations.py` | Business logic |
| Backend | `src/uwos/domains/bookmarks/handlers.py` | RPC handlers |
| Frontend | `src/ui/src/features/bookmarks/` | Complete bookmarks feature |

**Frontend Integration:**

```typescript
import { useBookmarks, useIsBookmarked, useToggleBookmark } from '@/features/bookmarks';

// Check if a specific URN is bookmarked
const isBookmarked = useIsBookmarked(urn);

// Toggle bookmark for a URN
const { toggle, isLoading } = useToggleBookmark();
const handleClick = () => toggle(urn);

// Get all bookmarks and actions
const { bookmarks, bookmarkedUrns, toggle, refresh } = useBookmarks();
```

**Adding Bookmark Button to a Domain:**

```typescript
import { BookmarkIcon } from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkIconSolid } from '@heroicons/react/24/solid';
import { useIsBookmarked, useToggleBookmark } from '@/features/bookmarks';

function ContentHeader({ urn }: { urn: string }) {
    const isBookmarked = useIsBookmarked(urn);
    const { toggle, isLoading } = useToggleBookmark();

    return (
        <button
            onClick={() => toggle(urn)}
            disabled={isLoading}
            className="p-2 rounded-md hover:bg-muted"
            title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
        >
            {isBookmarked ? (
                <BookmarkIconSolid className="h-5 w-5 text-primary" />
            ) : (
                <BookmarkIcon className="h-5 w-5 text-muted-foreground" />
            )}
        </button>
    );
}
```

**Displaying Bookmarked Items:**

```typescript
import { useBookmarks } from '@/features/bookmarks';
import { parseUrn } from '@/utils/urn';

function BookmarksList() {
    const { bookmarks, isLoading } = useBookmarks();

    // Filter bookmarks by type if needed
    const noteBookmarks = bookmarks.filter(b => parseUrn(b.urn).type === 'note');

    return (
        <ul>
            {noteBookmarks.map(bookmark => (
                <li key={bookmark.urn}>{bookmark.urn}</li>
            ))}
        </ul>
    );
}
```

**Important Rules:**
1. **Never add `is_pinned`, `is_starred`, or `is_favorite` fields** to content models
2. **Always use `BookmarkIcon`** from heroicons (not StarIcon, HeartIcon, etc.)
3. **Use the shared hooks** - don't create domain-specific bookmark state
4. **Clear bookmarks on logout** - include `clearBookmarks()` in logout handlers
5. **Auto-fetch on mount** - `useBookmarks()` automatically fetches when organization changes

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

**URN Type Colors** (`@/theme/urnColors.ts`):

Each URN type has a consistent color used across the app for badges, icons, graphs, and highlights. These are centralized in the theme engine - **never define URN colors inline**.

```typescript
import {
  UrnType,
  getUrnTypeHexColor,    // For canvas/SVG (returns hex string)
  getUrnTypeTheme,       // For components (returns Tailwind classes)
  URN_TYPE_LEGEND,       // For legends/filters
} from '@/theme/urnColors';

// Get hex color for canvas rendering
const color = getUrnTypeHexColor(UrnType.USER); // '#10b981'

// Get Tailwind theme for component styling
const theme = getUrnTypeTheme(UrnType.FILE);
// { gradient, iconBg, accentText, badgeBg, border, shadow }
```

**URN Type Color Assignments:**
| Type | Color | Hex | Tailwind |
|------|-------|-----|----------|
| NOTE | Primary | (user accent) | `bg-primary` |
| FILE | Blue | `#3b82f6` | `bg-blue-500` |
| CHAT | Violet | `#8b5cf6` | `bg-violet-500` |
| USER | Emerald | `#10b981` | `bg-emerald-500` |
| BOOK | Amber | `#f59e0b` | `bg-amber-500` |
| CALENDAR_EVENT | Rose | `#f43f5e` | `bg-rose-500` |
| PASSWORD | Red | `#ef4444` | `bg-red-500` |
| SPACE | Indigo | `#6366f1` | `bg-indigo-500` |

**When to use which:**
- `getUrnTypeHexColor()`: Canvas rendering, SVG, force-directed graphs
- `getUrnTypeTheme()`: React components with Tailwind (provides gradient, iconBg, accentText, etc.)
- `URN_TYPE_LEGEND`: Building filter lists or graph legends

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

### Keyboard Shortcuts Framework

UWOS provides a centralized keyboard shortcuts system that all domains should use for consistent, user-customizable keybindings.

**Available Hooks** (`@/features/settings`):

```typescript
import {
  useShortcutHandler,      // Register a single shortcut handler
  useShortcutHandlers,     // Register multiple handlers at once
  useKeybinding,           // Get the shortcut string for an action
  useFormattedKeybinding,  // Get platform-formatted string (⌘K on Mac)
  useKeyboardBindings,     // Get all bindings
  formatShortcut,          // Format any shortcut for display
} from '@/features/settings';
```

**Registering Shortcut Handlers:**

```typescript
// Single handler
useShortcutHandler('editor.save', () => {
  saveDocument();
});

// Multiple handlers
useShortcutHandlers({
  'editor.bold': () => applyBold(),
  'editor.italic': () => applyItalic(),
  'nav.search': () => openSearch(),
});

// With options
useShortcutHandler('editor.save', handleSave, {
  enabled: isEditing,        // Conditionally enable
  preventDefault: true,      // Prevent browser default (default: true)
});
```

**Displaying Shortcuts in UI:**

```typescript
// In a button or tooltip
const shortcut = useFormattedKeybinding('editor.save');
// Returns "⌘S" on Mac, "Ctrl+S" on Windows

<button>
  Save <span className="text-muted-foreground">{shortcut}</span>
</button>
```

**Adding New Shortcuts (Developer Checklist):**

Shortcuts must be defined in **3 places** to work correctly:

| Location | Purpose |
|----------|---------|
| Backend `defaults.py` | Source of truth, sent to frontend via API |
| Frontend `useKeyboardShortcuts.ts` | Fallback before settings load |
| Frontend `KeyboardShortcutsSection.tsx` | Settings UI for user customization |

**Step 1: Backend defaults** (source of truth)

`src/uwos/domains/settings/defaults.py`:
```python
DEFAULT_KEYBOARD_SHORTCUTS = {
    # ... existing shortcuts

    # Calendar
    "calendar.newEvent": "Ctrl+E",
    "calendar.today": "T",
    "calendar.weekView": "W",
}
```

**Step 2: Frontend fallback** (used before API loads)

`src/ui/src/features/settings/hooks/useKeyboardShortcuts.ts`:
```typescript
const DEFAULT_SHORTCUTS: Record<string, string> = {
    // ... existing shortcuts

    // Calendar
    'calendar.newEvent': 'Ctrl+E',
    'calendar.today': 'T',
    'calendar.weekView': 'W',
};
```

> **Note:** Keep frontend defaults in sync with backend. The frontend defaults are only used as fallback before settings API responds.

**Step 3: Settings UI** (for user customization)

`src/ui/src/features/settings/components/KeyboardShortcutsSection.tsx`:
```typescript
const SHORTCUT_CATEGORIES = [
    // ... existing categories
    {
        id: 'calendar',
        label: 'Calendar',
        shortcuts: [
            { action: 'calendar.newEvent', label: 'New Event' },
            { action: 'calendar.today', label: 'Go to Today' },
            { action: 'calendar.weekView', label: 'Week View' },
        ],
    },
];
```

**Step 4: Use in your domain**

```typescript
// In CalendarPage.tsx or a layout component
import { useShortcutHandlers } from '@/features/settings';

function CalendarPage() {
    const navigate = useNavigate();

    useShortcutHandlers({
        'calendar.newEvent': () => setShowNewEventModal(true),
        'calendar.today': () => goToToday(),
        'calendar.weekView': () => setView('week'),
    });

    // ... rest of component
}
```

**Step 5: Display in UI** (optional, for tooltips/buttons)

```typescript
import { useFormattedKeybinding } from '@/features/settings';

function NewEventButton() {
    const shortcut = useFormattedKeybinding('calendar.newEvent');

    return (
        <button title={`New Event (${shortcut})`}>
            New Event <kbd className="text-xs text-muted-foreground ml-2">{shortcut}</kbd>
        </button>
    );
}
```

**Action Naming Convention:**
- Use `{domain}.{action}` format (e.g., `editor.save`, `nav.search`, `calendar.newEvent`)
- Domains: `editor`, `nav`, `app`, `calendar`, `chat`, `files`, etc.

**Platform Handling:**
- The framework automatically converts `Ctrl` to `⌘` (Cmd) on Mac
- Users see platform-appropriate symbols in the UI
- Shortcuts work correctly on both platforms

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
10. Use centralized URN type colors from `@/theme/urnColors.ts` - never define URN colors inline
11. Use the keyboard shortcuts framework from `@/features/settings` - never hardcode keyboard handlers
12. Use the shared bookmarks system (`@/features/bookmarks`) - never add `is_pinned`/`is_starred`/`is_favorite` fields to content models
