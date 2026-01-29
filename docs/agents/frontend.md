# Frontend Documentation

> Use this documentation when working on React/TypeScript code in `src/ui/`.

## Directory Structure

- `src/app/`: Redux store, hooks, router
- `src/features/`: Domain modules (auth, notes, etc.) with components, hooks, store
- `src/components/ui/`: Shared UI primitives
- `src/theme/`: Theme engine (dark/light + user accent colors)
- `src/gen/`: Generated ConnectRPC clients (organized by service)

**Generated Code Structure** (`src/gen/`):

```
src/gen/
├── common/v1/          # Shared types (OrganizationRole, GroupRole, PaginationRequest, etc.)
│   ├── common_pb.ts    # Message and enum types
│   └── common_connect.ts
├── auth/v1/            # Authentication (login, register, refresh)
├── users/v1/           # User management
├── organizations/v1/   # Organization management
├── groups/v1/          # Group management
├── permissions/v1/     # Permission management
├── notes/v1/           # Notes domain
├── bookmarks/v1/       # Bookmarks domain
├── search/v1/          # Search domain
└── settings/v1/        # Settings domain
```

## Adding a New Frontend Feature

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

7. **Index exports** (`index.ts`) - Export everything public

**Key patterns:**
- All imports use `@/` path alias
- Thunks handle API calls, slices handle state updates
- Hooks abstract store interactions for components
- Components never call API directly (always through store/hooks)

## Path Aliases

Use `@/` for `src/` directory (e.g., `@/components/ui/button`).

## Theme System

**IMPORTANT: All new components MUST use the theme engine for colors and styling.**

The theme system (`src/theme/`) provides user-customizable accent colors with automatic text contrast calculation.

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

**Status colors (exception - use specific colors, NOT theme):**
- Success: `bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`
- Error: `bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400`
- Warning: `bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400`

**URN Type Colors** (`@/theme/urnColors.ts`):

Each URN type has a consistent color used across the app. **Never define URN colors inline.**

```typescript
import {
  UrnType,
  getUrnTypeHexColor,    // For canvas/SVG (returns hex string)
  getUrnTypeTheme,       // For components (returns Tailwind classes)
  URN_TYPE_LEGEND,       // For legends/filters
} from '@/theme/urnColors';
```

| Type | Hex | Tailwind |
|------|-----|----------|
| NOTE | (user accent) | `bg-primary` |
| FILE | `#3b82f6` | `bg-blue-500` |
| CHAT | `#8b5cf6` | `bg-violet-500` |
| USER | `#10b981` | `bg-emerald-500` |
| BOOK | `#f59e0b` | `bg-amber-500` |
| CALENDAR_EVENT | `#f43f5e` | `bg-rose-500` |
| PASSWORD | `#ef4444` | `bg-red-500` |
| SPACE | `#6366f1` | `bg-indigo-500` |

## Icons

Use `@phosphor-icons/react` for all icons.

## Document Titles

All pages MUST set a proper document title using `useDocumentTitle`. Format: `{Title} | Uniffy`

```typescript
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

// Static page title
useDocumentTitle('Notes');  // "Notes | Uniffy"

// Dynamic content title
useDocumentTitle(currentNote?.title || 'Notes');  // "My Note | Uniffy"

// Home page (brand only)
useDocumentTitle();  // "Uniffy"
```

**Requirements:**
1. Every page component MUST call `useDocumentTitle()`
2. Content pages should show dynamic titles when viewing a specific item
3. List/dashboard views should show the domain name
4. Home page should show just "Uniffy"

## URN Utilities and Components

**URN Utilities** (`@/utils/urn.ts`):
```typescript
import { parseUrn, buildUrn, urnToPath, getUrnIcon, getUrnTypeLabel, isValidUrn } from '@/utils/urn';

const parsed = parseUrn('urn:uniffy:content:NOTE:uuid');
const path = urnToPath(urn); // '/notes/uuid'
```

**Navigation Utilities** (`@/utils/navigation.ts`):
```typescript
import { navigateTo, openInNewTab } from '@/utils/navigation';
navigateTo('/notes/uuid');
```

**Mention Components** (`@/features/notes/components/editor/plugins/mention/`):
- `MentionChip`: Renders a URN as an interactive preview card
- `MentionSearch`: Search popup for `@` mentions
- `mentionPlugins`: Milkdown plugins for mention support

## Keyboard Shortcuts Framework

Use the centralized keyboard shortcuts system from `@/features/settings`.

```typescript
import {
  useShortcutHandler,      // Register a single shortcut handler
  useShortcutHandlers,     // Register multiple handlers at once
  useFormattedKeybinding,  // Get platform-formatted string (⌘K on Mac)
} from '@/features/settings';

// Register handlers
useShortcutHandlers({
  'editor.bold': () => applyBold(),
  'nav.search': () => openSearch(),
});

// Display in UI
const shortcut = useFormattedKeybinding('editor.save'); // "⌘S" on Mac
```

**Adding New Shortcuts:** Define in 3 places:
1. Backend `src/uniffy/domains/settings/defaults.py` (source of truth)
2. Frontend `src/ui/src/features/settings/hooks/useKeyboardShortcuts.ts` (fallback)
3. Frontend `src/ui/src/features/settings/components/KeyboardShortcutsSection.tsx` (UI)

## Bookmarks System (Frontend)

Use shared bookmarks - **never add `is_pinned`/`is_starred` fields** to content models.

```typescript
import { useBookmarks, useIsBookmarked, useToggleBookmark } from '@/features/bookmarks';

const isBookmarked = useIsBookmarked(urn);
const { toggle, isLoading } = useToggleBookmark();
```

## Zen Mode

All domain layouts MUST support Zen Mode (`Ctrl+\`).

```typescript
const isZenMode = useAppSelector((state) => state.zenMode.isActive);

// Hide sidebars when zen mode active
showSidebar={!isZenMode && isSidebarOpen}

// Use staged height transition
<div className={cn(
  "transition-[height] duration-300 ease-in-out",
  isZenMode ? "h-screen delay-150" : "h-[calc(100vh-4rem)] delay-0"
)}>
```

## Authentication (Frontend)

**Key Frontend Files:**

| File | Purpose |
|------|---------|
| `src/ui/src/config/api.ts` | Token storage, refresh, rehydration, auth interceptor |
| `src/ui/src/features/auth/store/authSlice.ts` | Auth state (user, tokens, org ID) |
| `src/ui/src/components/auth/ProtectedRoute.tsx` | Route guard (redirects unauthenticated users) |

**Important Patterns:**
- Access tokens are NEVER persisted (memory only via `memoryAccessToken` in `api.ts`)
- Auth interceptor auto-refreshes expiring tokens before API calls
- Organization context must be preserved separately from tokens

**Logout Cleanup:**

On logout, ALL user/org-specific state must be cleared:

```typescript
import { clearMemoryAccessToken } from "@/config";
import { logout } from "@/features/auth/store/authSlice";
import { resetSettings } from "@/features/settings/store/settingsSlice";
import { clearNotes } from "@/features/notes/store/notesSlice";
import { clearTree } from "@/features/notes/store/notesTreeSlice";
import { clearBookmarks } from "@/features/bookmarks";

const handleLogout = () => {
  clearMemoryAccessToken();
  dispatch(logout());
  dispatch(resetSettings());
  dispatch(clearNotes());
  dispatch(clearTree());
  dispatch(clearBookmarks());
  navigate('/auth');
};
```

## Administration System

**Route Structure:**

```
/admin                    # Unified admin panel
├── /admin/members        # Org members (org admin)
├── /admin/groups         # Groups/teams (org admin)
├── /admin/permissions    # Permission defaults (org admin)
├── /admin/org-settings   # Org config (org admin)
├── /admin/organizations  # All orgs (system admin only)
├── /admin/users          # All users (system admin only)
└── /admin/server-settings # Global config (system admin only)

/settings                 # Personal user preferences (all users)
```

**Access Control:**

```typescript
import { useAdminAccess } from '@/features/admin';

const { isOrgAdmin, isSystemAdmin, canAccessAdmin } = useAdminAccess();
```

## Frontend Import Pattern

```typescript
// Service clients
import { UsersService } from '@/gen/users/v1/users_connect';

// Types from service-specific _pb files
import { UserProfile } from '@/gen/users/v1/users_pb';

// Shared types from common
import { OrganizationRole, GroupRole } from '@/gen/common/v1/common_pb';
```
