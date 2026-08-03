---
paths:
  - "src/ui/**/*.ts"
  - "src/ui/**/*.tsx"
  - "src/ui/**/*.css"
  - "src/gen/typescript/**/*.ts"
---

# Frontend Patterns

Rules and conventions for the React app (`src/ui/`). Domain invariants live in their own rule files (`mentions.md`, `files-domain.md`, `chat-domain.md`, `calls-domain.md`, `notes-realtime.md`) - this file does not duplicate them.

## Layout

```
src/ui/src/
├── app/           # Redux store, hooks, zen mode state
├── components/    # Shared UI primitives (ui/, subject/, mention/, feedback/, ...)
├── config/        # API setup, theme system, error messages
├── features/      # Domain modules (auth, notes, files, chat, calendar, ...)
├── shared/        # Shared hooks, utils, layouts, assets
└── workers/       # Web-worker utilities (media range parsing)
```

Routes live in `src/ui/src/App.tsx`. Generated proto code is the `@uniffy/proto` workspace package (`src/gen/typescript/`); import `@uniffy/proto/{service}/v1/{service}_pb` / `_connect`.

## Feature module shape

Each feature is self-contained in `src/ui/src/features/{feature}/`:

```
features/{feature}/
├── api/{feature}Api.ts      # ConnectRPC client wrapper (createClient(Service, transport))
├── components/              # Grouped in subdirectories
├── hooks/                   # Wrap store interactions for components
├── pages/{Feature}Page.tsx  # Route-level page
├── store/                   # {feature}Slice.ts + {feature}Thunks.ts (register in app/store.ts)
└── index.ts                 # Public exports
```

- Components never call the API directly - always through store/hooks.
- Thunks handle API calls; slices handle state.
- **Named exports only.** `export default` makes refactors and auto-imports unpredictable (also applies to reducers: `export const myFeatureReducer = slice.reducer`).

## Imports

Absolute `@/` imports (maps to `src/`); relative imports rot on file moves. Common paths: `@/app/hooks`, `@/shared/utils/cn`, `@/shared/utils/urn`, `@/components/ui/*`, `@/config/theme/*`, `@uniffy/proto/*`.

## React hooks footguns (lint-enforced)

- **No synchronous setState in useEffect** (`react-hooks/set-state-in-effect`). One-time reads -> `useState` initializer; derived values -> `useMemo`. The legitimate exception is resetting local state when a prop like an id changes - add the eslint-disable with an explanation.
- **No ref reads during render.** Track dimensions in state via `ResizeObserver` in an effect; refs are reliable only in effects and event handlers.

## Responsive design

Three tiers, every page and component:

| Tier | Breakpoint | Expectation |
|---|---|---|
| Desktop | `lg`+ (1024px+) | First-class: full features, resizable panels, hover |
| Tablet | `md` (768-1024px) | Polished: sidebars as drawers/collapsible, touch targets |
| Mobile | <`md` | Functional fallback (native app exists): stacked layouts, bottom sheets |

- `useBreakpoint()` (`@/shared/hooks/useBreakpoint`) for JS-level structure changes; Tailwind `sm:`/`md:`/`lg:` for styling.
- Fixed-height layouts use `h-dvh`/`100dvh`, not `h-screen`/`100vh` (mobile browser chrome).
- Touch targets >= 44x44px; hover-only actions get an always-visible mobile variant (`md:opacity-0 md:group-hover:opacity-100`).
- Modals: `w-[calc(100vw-2rem)] max-w-{size}`, slide-up from bottom on mobile; dropdowns become bottom sheets on mobile.
- Tables hide secondary columns with `hidden md:table-cell`.
- Test at 375px, 768px, 1024px.

## Theme system

Use theme variables, never hardcoded colors - this keeps dark/light parity automatic and respects user accents:

| Purpose | Classes |
|---|---|
| Primary accent | `bg-primary text-primary-foreground` |
| Base surfaces | `bg-background text-foreground` |
| Cards/popovers | `bg-card text-card-foreground border-border` |
| Subtle/muted | `bg-muted text-muted-foreground` |
| Inputs / rings | `bg-input`, `ring-ring` |

Exception - status colors use explicit pairs: success `bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`, same shape for red/yellow.

**URN type colors:** `@/config/theme/urnColors.ts` is the single source (`getUrnTypeHexColor` for canvas/SVG, `getUrnTypeTheme` for components, `URN_TYPE_LEGEND` for legends). New content types get their color there, nowhere else.

**Icons:** `@phosphor-icons/react` for all icons.

**Logo:** `UniffyLogo` component (`@/components/ui/uniffy-logo`) or `/uniffy-symbol.png`. The mark is multi-color and theme-agnostic - never recolor or `invert()` it. Regenerate icon sizes from `docs/brand/uniffy-symbol.png`, do not hand-edit.

## Page contract

- Every page calls `useDocumentTitle()` (`@/shared/hooks/useDocumentTitle`): `{Title} | Uniffy`, dynamic for content pages, bare `useDocumentTitle()` on home.
- Domain layouts respect Zen Mode (`Ctrl+\`): check `state.zenMode.isActive`, hide sidebars, use the staged height transition.
- Route pages are lazy-loaded: `lazyImport(() => import('@/features/x/pages/XPage'), 'XPage')` wrapped in `<LazyRoute>` (Suspense + ErrorBoundary). Import the page FILE, not the feature barrel - barrel imports defeat code splitting. Global chrome (modals, search, toaster, `ProtectedRoute`) stays eagerly imported. `ErrorBoundary` (`@/components/feedback`) also wraps risky sub-trees within pages.

## Shared systems (use these, do not reimplement)

- **Keyboard shortcuts** (`@/features/settings`): `useShortcutHandler(s)`, `useFormattedKeybinding`. New shortcuts are defined in 3 places: backend `domains/settings/defaults.py` (source of truth), `useKeyboardShortcuts.ts` (fallback), `KeyboardShortcutsSection.tsx` (UI).
- **Bookmarks** (`@/features/bookmarks`): `useIsBookmarked`, `useToggleBookmark`. No `is_pinned`/`is_starred` fields on content models.
- **Formatting** (`@/shared/utils/dateFormatting`, `@/shared/utils/mentionUtils`): `formatDateShort/Full/WithWeekday`, `formatProtoDate(Time)`, `formatRelativeTime`, `formatFileSize`, `formatMediaTime`, `isOverdue`, `extractMentionsFromMarkdown`. Local `formatDate`/`getInitials`/`extractMentions` copies and inline `toLocaleDateString()` calls drift - do not add them.
- **Subject components** (`@/components/subject/`): `SubjectAvatar`, `SubjectAvatarStack`, `SubjectChip`, `SubjectPicker`, `getInitials` from `subject/utils`. Covers all user/group display and selection.
- **URN utilities** (`@/shared/utils/urn`): `parseUrn`, `buildUrn`, `urnToPath`, `getUrnIcon`, `getUrnTypeLabel`, `isValidUrn`. Navigation via `@/shared/utils/navigation` (`navigateTo`, `openInNewTab`). Class merging via `cn` (`@/shared/utils/cn`).
- **Attachments** (`@/features/attachments`) for linking files to content; **uploads** go through the unified engine owned by `files-domain.md`.

## Error handling

Global pipeline: rejected thunk -> `errorToastMiddleware` -> `friendlyErrorMessage()` (`@/config/errorMessages.ts`) -> toast. Therefore:

- No manual `toast.error()` in thunks; no custom error copy in thunks - `rejectWithValue(error.message)` is enough.
- New mappings go in `errorMessages.ts` (`STATUS_CODE_MESSAGES`, `HTTP_STATUS_MESSAGES`, `MESSAGE_PATTERNS`); suppression = return `null`.
- Rare manual toasts outside Redux: `friendlyErrorMessage` from `@/config`, toast only when non-null.

## Authentication

- Access tokens are memory-only (`memoryAccessToken` in `config/api.ts`) - **never persisted**; this is a security boundary. The interceptor auto-refreshes before calls; org context is stored separately from tokens.
- Authenticated `<img>`/`<video>`/`<audio>` resources use the asset-read cookie - contract, URL builders (`shared/utils/fileUrls.ts`), and the 401-retry listener are owned by `files-domain.md`. There is no service-worker auth proxy.
- Logout clears ALL user/org-scoped state: memory token plus every feature slice's clear/reset action, then navigate to `/auth`. When you add a slice holding user data, add its reset to the logout path.

## Admin surfaces

Two scoped surfaces - keep them separate (see AGENTS.md "Two Product Targets"):

- `/admin/*` = org admin (one tenant): members, groups, domain admins, permission defaults, org settings. Gate with `useAdminAccess()` (`@/features/admin`).
- `/platform/*` = platform admin (cloud operator, cross-tenant): `@/features/platform` pages behind `PlatformLayout` + permission gates. Platform pages never render tenant content outside a `SupportSession`.

New admin pages belong under the matching surface; domain-admin badges reuse the URN type color associations.
