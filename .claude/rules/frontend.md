---
paths:
  - "src/ui/**/*.ts"
  - "src/ui/**/*.tsx"
  - "src/ui/**/*.css"
  - "src/gen/typescript/**/*.ts"
---

## Directory Structure

```
src/
├── app/           # Redux store, hooks, zen mode state
├── components/    # Shared UI primitives and reusable components
├── config/        # App configuration, API setup, theme system
│   ├── theme/     # Theme engine (dark/light + user accent colors)
│   └── types/     # TypeScript type declarations
├── features/      # Domain modules (auth, notes, files, calendar, etc.)
├── shared/        # Shared utilities across the app
│   ├── hooks/     # Shared React hooks (useDocumentTitle, etc.)
│   ├── utils/     # Utility functions (urn, navigation, cn, etc.)
│   ├── layouts/   # Shared layout components
│   └── assets/    # Static assets
└── workers/       # Service workers (media streaming)
```

**Key directories:**
- `src/app/`: Redux store, hooks, router
- `src/features/`: Domain modules (auth, notes, etc.) with components, hooks, store
- `src/components/ui/`: Shared UI primitives
- `src/config/theme/`: Theme engine (dark/light + user accent colors)
- `src/shared/`: Shared hooks, utils, layouts
**Generated Code** lives in the shared `@uniffy/proto` workspace package at `src/gen/typescript/`. Import as `@uniffy/proto/{service}/v1/{service}_pb` or `_connect`.

**Generated Code Structure** (`src/gen/typescript/`):

```
src/gen/typescript/     # @uniffy/proto workspace package
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

## Responsive Design

**Every page, layout, and component is responsive across three tiers:**

| Tier | Breakpoint | Priority | Expectation |
|------|-----------|----------|-------------|
| Desktop | `lg` and above (1024px+) | First-class | Full experience, all features visible, resizable panels, hover interactions |
| Tablet | `md` (768-1024px) | Critical | Must feel polished and natural. Sidebars as drawers or collapsible, simplified toolbars, touch-friendly targets |
| Mobile | below `md` (<768px) | Functional | Usable but not feature-rich. There is a native mobile app, so web mobile is a fallback. Hide non-essential columns/controls, stack layouts, use bottom sheets instead of dropdowns |

**Breakpoint hook** (`@/shared/hooks/useBreakpoint`):

```typescript
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';

const { isMobile, isTablet, isMobileOrTablet, isDesktop } = useBreakpoint();
```

**Responsive layout patterns:**

| Pattern | Implementation |
|---------|---------------|
| Sidebar on desktop, drawer on mobile | `useBreakpoint()` + `Drawer` component from `@/components/ui/drawer` |
| Sidebar collapse/expand | `CaretDoubleLeft` inside sidebar header (collapse), `CaretDoubleRight` inline column in layout (expand on tablet/desktop), `SidebarSimple` in content header (expand on mobile) |
| Three-panel layouts | `react-resizable-panels` on desktop, detail panel as drawer on tablet, both sidebar and detail as drawers on mobile |
| Tables | Hide less important columns with `hidden md:table-cell` / `hidden lg:table-cell` |
| Modals | `w-[calc(100vw-2rem)] max-w-{size}` for proper mobile sizing, `max-h-[60vh] overflow-y-auto` for content, slide-up from bottom on mobile (`items-end sm:items-center`, `rounded-t-xl sm:rounded-xl`) |
| Dropdowns/panels | Use bottom sheets on mobile (fixed, slide-up) instead of absolute dropdowns that clip off-screen |
| Hover-only actions | Always visible on mobile (`md:opacity-0 md:group-hover:opacity-100`), hover-reveal on desktop |
| Headers | Smaller text on mobile (`text-2xl md:text-3xl`), hide descriptions below `sm`, buttons icon-only on mobile |
| Padding | Tighter on mobile (`px-3 md:px-4 lg:px-6`, `py-2 md:py-3 lg:py-4`) |

**Dynamic viewport height**: Use `h-dvh` / `100dvh` instead of `h-screen` / `100vh` for fixed-height layouts. This handles mobile browser chrome (address bar, virtual keyboard).

**Rules:**

1. New pages and layouts work across all three tiers - desktop-only experiences tend to feel broken on tablet.
2. `useBreakpoint()` carries JS-level responsive logic (drawer vs inline, different component structure).
3. Tailwind responsive classes (`sm:`, `md:`, `lg:`) carry CSS-level responsive styling.
4. Touch targets land at 44x44px or larger on mobile (use `p-2` or larger on interactive elements).
5. Hover-only critical actions tend to break on touch devices - provide tap alternatives.
6. Testing layouts at 768px (tablet portrait), 1024px (tablet landscape), and 375px (mobile) catches most regressions.

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
   import { FeatureService } from '@uniffy/proto/feature/v1/feature_connect';

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

## Import Rules

**Absolute `@/` imports tend to read better and survive file moves; relative imports tend to rot when files move.**

```typescript
// Good - absolute imports
import { cn } from '@/shared/utils/cn';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { filesApi } from '@/features/files/api/filesApi';
import { useAppDispatch } from '@/app/hooks';

// Less ideal - relative imports break on refactor
import { cn } from '../../../shared/utils/cn';
import { filesApi } from '../api/filesApi';
import { useNotesHooks } from './useNotesHooks';
```

**Path alias:** `@/` maps to `src/` directory.

**Common import paths:**
| What | Import from |
|------|-------------|
| Redux hooks | `@/app/hooks` |
| Redux store | `@/app/store` |
| Shared utils | `@/shared/utils/cn`, `@/shared/utils/urn`, `@/shared/utils/navigation` |
| Shared hooks | `@/shared/hooks/useDocumentTitle` |
| Theme system | `@/config/theme/ThemeProvider`, `@/config/theme/urnColors` |
| UI components | `@/components/ui/button`, `@/components/ui/select` |
| Generated types | `@uniffy/proto/common/v1/common_pb`, `@uniffy/proto/files/v1/files_pb` |
| Feature APIs | `@/features/{feature}/api/{feature}Api` |
| Feature store | `@/features/{feature}/store/{feature}Slice` |

## React Hooks Patterns

### Avoid setState synchronously in useEffect

The linter enforces `react-hooks/set-state-in-effect`. Effects are a good fit for syncing with external systems; deriving state from props or one-time reads belongs elsewhere.

**Less ideal - setState in effect:**
```typescript
const [color, setColor] = useState('default');

useEffect(() => {
    const computed = getComputedStyle(document.documentElement);
    setColor(computed.getPropertyValue('--primary')); // LINT ERROR
}, []);
```

**Better - useState initializer for one-time reads:**
```typescript
const [color] = useState(() => {
    const computed = getComputedStyle(document.documentElement);
    return computed.getPropertyValue('--primary') || 'default';
});
```

**Better - useMemo for derived values:**
```typescript
const color = useMemo(() => {
    return someCondition ? 'blue' : 'red';
}, [someCondition]);
```

**Exception - Resetting state when props change:**

When you need to reset local state when a prop (like an ID) changes, add an eslint-disable with explanation:

```typescript
useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when file.id changes is valid
    setLoaded(false);
    setData(null);
}, [file.id]);
```

### Avoid accessing refs during render

Refs read reliably in effects or event handlers; during the render phase the value is unstable.

**Less ideal - ref access during render:**
```typescript
const containerRef = useRef<HTMLDivElement>(null);

// This runs during render - unreliable
const width = containerRef.current?.clientWidth ?? 0;
```

**Better - track dimensions in state with ResizeObserver:**
```typescript
const containerRef = useRef<HTMLDivElement>(null);
const [size, setSize] = useState({ width: 0, height: 0 });

useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
        setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    return () => observer.disconnect();
}, []);

// Now use `size.width` instead of ref access
```

## Theme System

**New components reach for the theme engine for colors and styling - this keeps dark/light parity automatic and respects user-customizable accents.**

The theme system (`src/config/theme/`) provides user-customizable accent colors with automatic text contrast calculation.

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

1. **Reach for theme variables** - hardcoded colors like `bg-zinc-900` or `bg-white` break dark/light parity
2. **Cards and popovers** - `bg-card text-card-foreground border-border` is a good fit
3. **Subtle backgrounds** - `bg-muted text-muted-foreground` reads well
4. **Interactive elements** - `bg-primary text-primary-foreground` for buttons
5. **Borders** - `border-border` keeps theme behavior consistent; `border-gray-200` tends to clash

**Status colors (exception - use specific colors, NOT theme):**
- Success: `bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`
- Error: `bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400`
- Warning: `bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400`

**URN Type Colors** (`@/config/theme/urnColors.ts`):

Each URN type has a consistent color used across the app. **Defining URN colors inline tends to drift; the centralized helpers keep them aligned.**

```typescript
import {
  UrnType,
  getUrnTypeHexColor,    // For canvas/SVG (returns hex string)
  getUrnTypeTheme,       // For components (returns Tailwind classes)
  URN_TYPE_LEGEND,       // For legends/filters
} from '@/config/theme/urnColors';
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

## Logo / Branding

**Logo files** (in `src/ui/public/`):

| File | Purpose |
|------|---------|
| `/favicon.svg` | Main logo (white, for dark backgrounds) |
| `/favicon.ico` | Browser favicon |
| `/favicon-96x96.png` | PNG favicon |
| `/apple-touch-icon.png` | iOS home screen icon |
| `/web-app-manifest-192x192.png` | PWA icon (small) |
| `/web-app-manifest-512x512.png` | PWA icon (large) |

**Theme-aware logo usage:**

The main logo (`/favicon.svg`) is white/light colored, designed for dark backgrounds. To display it on light backgrounds, use CSS `filter: invert(1)` to make it black.

```typescript
import { useTheme } from '@/config/theme/ThemeProvider';

function MyComponent() {
  const { resolvedTheme } = useTheme();
  const isLightTheme = resolvedTheme !== 'dark';

  return (
    <img
      src="/favicon.svg"
      alt="Uniffy"
      className="w-12 h-12"
      style={isLightTheme ? { filter: 'invert(1)' } : undefined}
    />
  );
}
```

**Rules:**
- `/favicon.svg` is the canonical source (rather than separate dark/light files)
- Apply `filter: invert(1)` on light theme to render the logo black
- On dark theme, display the logo as-is (white)
- Hardcoding a specific logo color variant tends to drift from the theme

## Document Titles

All pages set their document title via `useDocumentTitle`. Format: `{Title} | Uniffy`

```typescript
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';

// Static page title
useDocumentTitle('Notes');  // "Notes | Uniffy"

// Dynamic content title
useDocumentTitle(currentNote?.title || 'Notes');  // "My Note | Uniffy"

// Home page (brand only)
useDocumentTitle();  // "Uniffy"
```

**Requirements:**
1. Every page component calls `useDocumentTitle()` so the tab stays accurate
2. Content pages show dynamic titles when viewing a specific item
3. List/dashboard views show the domain name
4. Home page shows just "Uniffy"

## URN Utilities and Components

**URN Utilities** (`@/shared/utils/urn.ts`):
```typescript
import { parseUrn, buildUrn, urnToPath, getUrnIcon, getUrnTypeLabel, isValidUrn } from '@/shared/utils/urn';

const parsed = parseUrn('urn:uniffy:content:NOTE:uuid');
const path = urnToPath(urn); // '/notes/uuid'
```

**Navigation Utilities** (`@/shared/utils/navigation.ts`):
```typescript
import { navigateTo, openInNewTab } from '@/shared/utils/navigation';
navigateTo('/notes/uuid');
```

**Class Name Utility** (`@/shared/utils/cn.ts`):
```typescript
import { cn } from '@/shared/utils/cn';

// Merge Tailwind classes conditionally
<div className={cn('base-class', isActive && 'active-class', className)} />
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

Reach for shared bookmarks - **adding `is_pinned`/`is_starred` fields to content models tends to duplicate the bookmarks system.**

```typescript
import { useBookmarks, useIsBookmarked, useToggleBookmark } from '@/features/bookmarks';

const isBookmarked = useIsBookmarked(urn);
const { toggle, isLoading } = useToggleBookmark();
```

## Shared Formatting Utilities

Reach for the centralized formatting utilities rather than defining local helpers - duplicate date, time, file size, or mention parsing functions tend to drift.

**Key Files:**

| File | Purpose |
|------|---------|
| `src/ui/src/shared/utils/dateFormatting.ts` | All date, time, file size, and relative time formatting |
| `src/ui/src/shared/utils/mentionUtils.ts` | Markdown mention extraction (`[[[label\|urn]]]`) |

**Date formatting (`@/shared/utils/dateFormatting`):**

| Function | Output | Use for |
|----------|--------|---------|
| `formatDateShort(dateStr)` | "Jan 22" (+ year if not current) | Task dates, list views |
| `formatDateFull(dateStr)` | "Jan 22, 2026" | Detail panels |
| `formatDateWithWeekday(dateStr)` | "Mon, Jan 22" | Calendar date labels |
| `formatProtoDate(timestamp)` | "Jan 22" | Proto `{ seconds, nanos }` timestamps |
| `formatProtoDateTime(timestamp)` | "Jan 22, 2026, 2:30 PM" | File details, full timestamps |
| `formatRelativeTime(dateStr)` | "Just now", "5m ago", "3d ago" | Comments, notifications, activity |
| `isOverdue(dateStr)` | `boolean` | Task due date styling |
| `formatMediaTime(seconds)` | "1:23" or "1:02:03" | Audio/video playback |
| `formatFileSize(bytes)` | "1.5 MB" | File sizes |

**Mention parsing (`@/shared/utils/mentionUtils`):**

| Function | Purpose |
|----------|---------|
| `extractMentionsFromMarkdown(md)` | Parse `[[[label\|urn]]]` mentions, deduplicated by URN |
| `extractFallbackLabel(urn)` | Short label from URN: "note:abcdef12" |

**Rules:**
- Local `formatDate`, `formatRelativeTime`, `formatFileSize`, `getInitials`, `extractMentions`, or `isOverdue` functions tend to drift from the canonical versions
- Inline `toLocaleDateString()` calls bypass the shared formatters and tend to render inconsistently
- For proto timestamps, `formatProtoDate` / `formatProtoDateTime` is a better fit than manual `new Date(seconds * 1000)`

## Subject Components (Users and Groups)

Reach for the shared subject components (`src/ui/src/components/subject/`) for user/group display and selection. Inline avatar circles, initials helpers, or member search dropdowns tend to drift from the shared ones.

**Key Files:**

| File | Purpose |
|------|---------|
| `src/ui/src/components/subject/types.ts` | Subject interface, type constants, size/mode types |
| `src/ui/src/components/subject/utils.ts` | Canonical `getInitials`, type converters (member/group/shareTarget to Subject) |
| `src/ui/src/components/subject/SubjectAvatar.tsx` | Avatar circle (photo with initials fallback for users, violet initials for groups) |
| `src/ui/src/components/subject/SubjectAvatarStack.tsx` | Overlapping avatar row with +N overflow |
| `src/ui/src/components/subject/SubjectChip.tsx` | Removable pill (avatar + name + X button) |
| `src/ui/src/components/subject/SubjectPicker.tsx` | Search dropdown for selecting users/groups (single/multi, portal/inline) |
| `src/ui/src/components/subject/hooks/useSubjectResolver.ts` | Resolves user/group IDs to Subject objects from Redux store |
| `src/ui/src/components/subject/hooks/useSubjectSearch.ts` | Debounced search wrapping `searchShareTargets` thunk |
| `src/ui/src/components/subject/index.ts` | Public barrel exports |

**Rules:**
- Import `getInitials` from `@/components/subject/utils`; local copies tend to diverge
- `SubjectAvatar` / `SubjectAvatarStack` cover user/group avatars - inline avatar circles tend to drift visually
- `SubjectPicker` covers user/group selection - inline member search dropdowns duplicate behavior
- `SubjectChip` covers removable user/group pills

## Zen Mode

All domain layouts support Zen Mode (`Ctrl+\`).

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

## Error Handling

**Reach for the centralized error system rather than writing custom error handling or toast calls in thunks or components - duplicates tend to drift from canonical copy.**

The app has a global error-toast pipeline that automatically catches rejected async thunks, translates raw API/network errors into user-friendly messages, and displays toast notifications. No per-feature error handling is needed.

**Key Files:**

| File | Purpose |
|------|---------|
| `src/ui/src/config/errorMessages.ts` | Error message mappings (`friendlyErrorMessage()`) |
| `src/ui/src/app/errorToastMiddleware.ts` | Redux middleware that catches rejected thunks and shows toasts |
| `src/ui/src/config/index.ts` | Re-exports `friendlyErrorMessage` |

**How it works:**

```
Async Thunk rejects (API error)
    -> errorToastMiddleware catches rejection
    -> friendlyErrorMessage() translates raw error
    -> toast.error() displays user-friendly message
```

The middleware handles both `rejectWithValue` payloads and thrown error messages. Noisy non-errors (aborted requests, etc.) are automatically suppressed.

**Error translation priority:**

1. ConnectRPC/gRPC status codes (e.g., `[permission_denied]` -> "You do not have permission to perform this action.")
2. HTTP status codes (e.g., `500` -> "Something went wrong on our end. Please try again shortly.")
3. Regex patterns (e.g., network errors, timeouts)
4. Fall-through: raw message displayed as-is

**Rules:**

1. **Skip manual `toast.error()` calls in thunks** - the middleware handles it automatically
2. **Skip custom error messages in thunks** - `rejectWithValue(error.message)` plus `friendlyErrorMessage()` covers translation
3. **To add new error mappings**, update `src/ui/src/config/errorMessages.ts` (add to `STATUS_CODE_MESSAGES`, `HTTP_STATUS_MESSAGES`, or `MESSAGE_PATTERNS`)
4. **To suppress an error**, return `null` from `friendlyErrorMessage()` by adding it to the suppression list
5. **For manual toast calls outside Redux** (rare), import `friendlyErrorMessage` from `@/config` and use it:
   ```typescript
   import { friendlyErrorMessage } from '@/config';
   import { toast } from 'sonner';

   const friendly = friendlyErrorMessage(error.message);
   if (friendly) toast.error(friendly);
   ```

## Lazy Loading and Error Boundaries

Route-level page components are lazy-loaded using `React.lazy` via the `lazyImport` utility, and wrapped with `Suspense` + `ErrorBoundary` via the `<LazyRoute>` wrapper. This keeps the initial bundle small and isolates page-level crashes.

**Key Files:**

| File | Purpose |
|------|---------|
| `src/ui/src/shared/utils/lazyImport.ts` | Type-safe `React.lazy` wrapper for named exports |
| `src/ui/src/components/feedback/ErrorBoundary.tsx` | Reusable class-based error boundary |
| `src/ui/src/components/feedback/PageLoader.tsx` | Suspense fallback spinner for lazy-loaded pages |
| `src/ui/src/components/feedback/PageErrorFallback.tsx` | Route-level error UI (with chunk error detection) |
| `src/ui/src/components/feedback/AppErrorFallback.tsx` | App-level catastrophic error UI |
| `src/ui/src/components/feedback/index.ts` | Barrel exports |

**Architecture - Two-layer error boundaries:**

1. **App-level** (`AppErrorFallback`): Wraps `BrowserRouter`. Catches catastrophic errors that escape route boundaries. Shows "Reload application" prompt.
2. **Route-level** (`PageErrorFallback`): Wraps each lazy-loaded page via `<LazyRoute>`. Isolates page crashes so global chrome (header, spotlight, toaster) keeps working. Auto-detects stale chunk errors from deployments and shows "Update available - Reload" instead of generic error.

**Adding a new lazy-loaded page:**

1. Create the page with a **named export** (`export default` makes refactors less predictable):
   ```typescript
   export function MyPage() { ... }
   ```

2. Add lazy import in `App.tsx` using `lazyImport` (import from the page file directly, NOT from barrel):
   ```typescript
   const MyPage = lazyImport(() => import('@/features/myFeature/pages/MyPage'), 'MyPage');
   ```

3. Wrap in route with `<LazyRoute>`:
   ```typescript
   <Route path="/my-feature" element={
       <ProtectedRoute>
           <LazyRoute><MyPage /></LazyRoute>
       </ProtectedRoute>
   } />
   ```

**Rules:**

1. **Import page files directly** in lazy imports (e.g., `@/features/notes/pages/NotesPage`) rather than from barrel files (`@/features/notes`). Barrel imports defeat code splitting by pulling in the entire feature module.
2. **Global components stay eagerly imported** - modals, search overlays, toasters, and auth guards (`ProtectedRoute`, `AdminRoute`) need to be ready instantly and are not lazy-loaded.
3. **Wrap every lazy-loaded route in `<LazyRoute>`** for both `Suspense` fallback and `ErrorBoundary`.
4. The `ErrorBoundary` component also works around risky sub-trees within pages (e.g., third-party integrations):
   ```typescript
   import { ErrorBoundary } from '@/components/feedback';

   <ErrorBoundary fallback={({ error, reset }) => <MyFallback error={error} onRetry={reset} />}>
       <RiskyThirdPartyWidget />
   </ErrorBoundary>
   ```

**Adding a new Redux slice reducer:**

Named exports for reducers compose well with the store wiring:
```typescript
// Good
export const myFeatureReducer = myFeatureSlice.reducer;

// Less ideal - export default for reducers
export default myFeatureSlice.reducer;
```

## Authentication (Frontend)

**Key Frontend Files:**

| File | Purpose |
|------|---------|
| `src/ui/src/config/api.ts` | Token storage, refresh, rehydration, auth interceptor |
| `src/ui/src/features/auth/store/authSlice.ts` | Auth state (user, tokens, org ID) |
| `src/ui/src/components/auth/ProtectedRoute.tsx` | Route guard (redirects unauthenticated users) |

**Important Patterns:**
- Access tokens MUST NOT be persisted (memory only via `memoryAccessToken` in `api.ts`) - this is a security boundary
- Auth interceptor auto-refreshes expiring tokens before API calls
- Organization context is preserved separately from tokens

**Logout Cleanup:**

On logout, all user/org-specific state is cleared:

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
├── /admin/domain-admins  # Domain admin assignments (org admin)
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

## Domain Admin UI

Users can be granted admin status for specific domains (chat, files, etc.) without being full org admins. This is managed from two places in the admin panel.

**Members page (`/admin/members`)** - Enhanced member table:
- New "Domain Roles" column shows colored badges for each domain admin assignment (e.g., "Chat Admin")
- Clicking the badges or a `+` button opens a **Domain Roles Dialog** for that user
- The dialog lists all domains with a toggle or simple on/off control per domain
- Org ADMIN/OWNER users show a muted note: "Org admins have full access to all domains"

**Domain Admins page (`/admin/domain-admins`)** - Dedicated management page:
- Horizontal domain tabs: All | Chat | Files | Calendar | Projects | Agents
- "All" tab groups assignments by domain, each domain as a card with a table of assigned users
- Domain-specific tabs show a filtered table with search and assign/remove actions
- Assign dialog: SubjectPicker (single user) + domain selector (pre-filled if opened from a tab)
- Remove confirmation via `ConfirmDialog`

**UserEditDialog (system admin)** - Domain roles section:
- Below the Organizations section in the right column
- Lists all domains with toggle per domain, scoped to the selected org

**Badge colors per domain** (use URN type color associations):
- Chat: `bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400`
- Files: `bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400`
- Calendar: `bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400`
- Projects: `bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400`
- Agents: `bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400`

**Key files:**

| File | Purpose |
|------|---------|
| `src/ui/src/features/admin/pages/DomainAdminsPage.tsx` | Domain admins management page |
| `src/ui/src/features/admin/components/members/MembersSection.tsx` | Enhanced with domain roles column |
| `src/ui/src/features/admin/components/domain-admins/` | Domain admin components (table, assign dialog, badges) |
| `src/ui/src/features/admin/store/adminSlice.ts` | State for domain admin assignments |
| `src/ui/src/features/admin/store/adminThunks.ts` | Thunks for grant/revoke/list domain admins |

## Frontend Import Pattern

```typescript
// Service clients
import { UsersService } from '@uniffy/proto/users/v1/users_connect';

// Types from service-specific _pb files
import { UserProfile } from '@uniffy/proto/users/v1/users_pb';

// Shared types from common
import { OrganizationRole, GroupRole } from '@uniffy/proto/common/v1/common_pb';
```

## Service Worker for Auth-Proxied Requests

The media stream service worker (`src/workers/mediaStreamWorker.ts`) intercepts requests to specific URL patterns and adds Authorization headers. This enables `<img>`, `<video>`, and `<audio>` tags to load authenticated resources.

**When to use service worker proxying:**

| Use Case | URL Pattern | Why |
|----------|-------------|-----|
| Images in notes | `/api/files/{orgId}/{fileId}` | `<img src>` cannot send auth headers |
| Thumbnails | `/api/thumbnails/{orgId}/{fileId}` | Browser caching + lazy loading |
| Video/audio | `/media-stream/{orgId}/{fileId}` | Range-based seeking support |

**Token Synchronization:**

The service worker receives auth tokens via BroadcastChannel (real-time) and postMessage (fallback):
