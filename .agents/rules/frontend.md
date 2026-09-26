---
paths:
  - "src/ui/**/*.ts"
  - "src/ui/**/*.tsx"
  - "src/ui/**/*.css"
  - "src/proto/gen/typescript/**/*.ts"
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

Routes live in `src/ui/src/App.tsx`. Generated proto code is the `@uniffy/proto` workspace package (`src/proto/gen/typescript/`); import `@uniffy/proto/{service}/v1/{service}_pb` / `_connect`.

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

The linter is oxlint (`.oxlintrc.json` + the shared custom plugin `lint/uniffy-oxlint-plugin.mjs` at the repo root). Its experimental `react/react-compiler` rule carries the React Compiler diagnostics below at warn level - treat those warnings as real findings, not noise.

- **No synchronous setState in useEffect** (the `EffectSetState` diagnostic). One-time reads -> `useState` initializer; derived values -> `useMemo`. The legitimate exception is resetting local state when a prop like an id changes - add an `eslint-disable`-style suppression comment (oxlint honors them) with an explanation.
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
- Modals: always `Modal` + `ModalHeader` / `ModalBody` / `ModalFooter` from `@/components/ui/modal` (see "Dialogs" below); the shell already handles `w-[calc(100vw-2rem)] max-w-{size}` and the slide-up from bottom on mobile. Dropdowns become bottom sheets on mobile.
- Tables hide secondary columns with `hidden md:table-cell`.
- Test at 375px, 768px, 1024px.

## Theme system

Use theme variables, never hardcoded colors - this keeps dark/light parity automatic and respects user accents:

| Purpose | Classes |
|---|---|
| Primary accent | `bg-primary text-primary-foreground` |
| Top header, primary sidebar | `bg-nav` |
| App frame (side panels) | `bg-background text-foreground` |
| Content sheet, dialogs, drawers | `bg-surface` (dialogs, drawers, and menus separate by the float shadow, not by a CSS border; `bg-popover` equals `bg-surface` in dark and is one step lighter in light) |
| Raised blocks on the sheet | `bg-card text-card-foreground` |
| Subtle/muted | `bg-muted text-muted-foreground`; third text tier `text-subtle-foreground` for timestamps, placeholders, helper copy |
| Form controls (`Input`, `Textarea`, `Select`, `MultiSelect`, `TimezoneSelect`, `DatePicker`, `Checkbox`, native `<select>`, pickers) | `bg-input border-border`, hover `border-border-strong`, focus `focus-ring`; the open menu is `bg-popover` |

The surface ladder runs darkest to lightest in dark mode: nav, background, surface, card. The palettes live in `index.css` (`:root` / `.dark`); `ThemeProvider` writes only four inline vars on the root element - the user accent (`--primary`, `--ring`, and the contrast-picked `--primary-foreground`) and the user font (`--font-sans`).

Exception - status colors use explicit pairs: success `bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`, same shape for red/yellow.

**Borders are translucent** (white alpha in dark, black alpha in light) so one token reads correctly on every rung of the ladder. Three tiers: `border-border` for resting edges of blocks inside a surface (cards, inputs, chips, rows), `border-border-strong` for hover, focus, and open states AND for the seams between chrome regions (app header bottom, sidebar rail edge, pane headers such as the channel, calendar, project, and editor headers), `border-border/60` for dividers inside a block. Icon boxes that sit on `bg-nav` (the top header nav, bell, calendar, record, avatar) rest on `border-border-nav`, one notch above strong, since the nav tone is the darkest rung and swallows the other tiers; they hover to `border-primary/30`, the same edge as their open state. Never `border-foreground/N` or `border-muted-foreground/N` for a neutral edge; those are brighter than the token and break the hierarchy.

**Form controls share one shell.** `bg-input` is the single fill for every control (the app-frame tone in dark so fields read as wells, white in light), `border-border` the resting edge, `border-border-strong` on hover and while a menu is open. `controlShellClass` (`@/components/ui/input`) carries exactly that; `Input` and `Textarea` (`@/components/ui/textarea`) are the primitives and take size overrides through `className` (`h-7 px-1.5 text-xs` for inline rename fields, `pl-9` for a search icon). A raw `<input>` or `<textarea>` appears only bare (`bg-transparent`, no border) inside a composer or inside a wrapper box that carries `controlShellClass` + `focus-ring-within`. Placeholders are `text-subtle-foreground`. Never hand-roll `border-input`, `focus:ring-*`, or `focus:border-primary` on a control, and never use `bg-background` / `bg-card` / `bg-muted` as a field fill.

**Focus** has one recipe: the `focus-ring` utility (the element itself, or a visually hidden `peer` input beside it) and `focus-ring-within` (a wrapper whose descendant is focused). Both draw a soft accent outline halo and lift the border to the accent, and they stack on any box-shadow. Buttons, toggles, checkboxes, and every field use them; do not compose `ring-2 ring-ring ring-offset-*` variants by hand.

**Pane headers** (the band at the top of a content pane: projects, notifications, agents, people) are built from `@/components/ui/pane-header`: `PaneHeader` shell, `PaneHeaderBar` (accent icon or avatar, `text-sm md:text-base font-medium` title, `text-xs` subtitle, `eyebrow` for a `PaneBackLink`, actions as children, `divided` when a controls row follows), `PaneHeaderControls` for filters and switchers, `PaneIconButton` for icon-only actions. Search in a header is `SearchField size="sm"` (`@/components/ui/search-field`), exclusive toggles are `SegmentedControl` (`@/components/ui/segmented-control`). No hand-rolled `text-xl font-bold` page titles inside a pane.

**Floating chrome** (menus, popovers, pickers, hover cards, search popups, context menus, floating toolbars) uses `popoverShellClass` from `@/components/ui/popover` (or the `Popover` div): `rounded-lg bg-popover shadow-float`. Dialogs, drawers, and slide-over panels use `dialogShellClass`: `bg-surface shadow-float-lg`. `shadow-float` / `shadow-float-lg` are the elevation tokens, a 1px ring at the strong border tier plus a wide soft drop, so a floating element carries no CSS border and no `shadow-lg` / `shadow-xl` / `shadow-2xl`. Internal dividers inside a popover stay `border-border/60`. An accent-framed floating surface (Spotlight, a focused search box) adds `ring-1 ring-primary/40` on top of the shell rather than a primary border.

**Tables** use `Table` + `TableHeader` / `TableBody` / `TableRow` / `TableHead` / `TableCell` (`@/components/ui/table`), never a hand-rolled `<table>`. The shell is the card shell (`rounded-xl shadow-edge`, `tone="surface"` on an app-frame page, `tone="card"` inside a surface block); the header band is the `table-band` utility (frame tone washed over the table tone, painted opaque), rows divide with `border-border/60` hairlines on the cells, and rows hover with the same `bg-foreground/5` wash as sidebar items. The header is sticky: it pins to the nearest scroller, so a table never sits inside an `overflow-hidden` wrapper, and layouts where the document scrolls under the app header set `[--sticky-top:3rem]` on their root (admin and platform layouts do). `rounded={false}` when a parent draws the frame.

**Scrollbars and selection** are stylesheet-owned: thin neutral thumbs (`foreground` alpha) on every scroller and `::selection` on the accent. Do not restyle either per component.

**Resizable panes** separate with `PaneSeparator` (`@/components/ui/pane-separator`): a 1px seam with a 4px grab area that lifts to the accent on hover and drag. Never hand-roll a `Separator` from `react-resizable-panels` with a `bg-border` bar, and do not add `border-r` / `border-l` on the panels beside one; the separator is the seam. `static` gives the same line between panes that do not resize.

**Raised blocks sit one rung above what they sit on.** Section panes on an app-frame page (`bg-background`: dashboard, settings, admin, platform, project settings) are `bg-surface`; item cards on a content sheet (`bg-surface`: chat, notes, agents builder, people) are `bg-card`. `Card` takes `tone="surface" | "card"` for exactly this. Selectable option tiles use the same edge: resting `shadow-edge`, hover `shadow-edge-strong`, selected `bg-primary/5 shadow-edge-primary`, never a primary border or ring.

**Cards** use `Card` (`@/components/ui/card`) or, on elements that cannot be a div, the `shadow-edge` / `shadow-edge-strong` / `shadow-edge-primary` utilities with the tone above and no CSS border. The edge is a 1px ring in the shadow layer plus a top highlight, so cards read as raised rather than outlined. Hover and selected states ride through `className`: `transition-shadow duration-150 hover:shadow-edge-strong` for a card that opens something, `bg-primary/5 shadow-edge-primary` for the picked card in a set. Card footers step the tone down (`bg-background/60`) instead of drawing a divider.

**Dialogs:** one shell, `Modal` (`@/components/ui/modal`), composed from `ModalHeader` (title + one-line description, no icon badge, X only when the footer has no Cancel/Close), `ModalBody` (scrolls at 65dvh; `scrollable={false}` for flex-column layouts), `ModalFooter` (ghost Cancel first, primary action last). Field labels are `text-sm text-muted-foreground mb-1`, optional fields say `(optional)` inline. `ConfirmDialog` / `ReasonDialog` are the shared confirm shapes. No hand-rolled `fixed inset-0` overlays and no headlessui `Dialog`.

**URN type colors:** `@/config/theme/urnColors.ts` is the single source (`getUrnTypeHexColor` for canvas/SVG, `getUrnTypeTheme` for components, `URN_TYPE_LEGEND` for legends). New content types get their color there, nowhere else.

**Person colors:** `@/config/theme/brandGradients.ts` is the single source (`identityStops` for raw stops, `identityPaint` for solid/gradient/wash, `brandRampStops` for ordered sets). Everything that paints a person - avatar backdrop, realtime caret, canvas pointer - hashes the display name through it, so the same person reads the same everywhere. Stops stay on the Unity Violet -> Belonging Pink axis; do not add a second palette. Project task statuses default to the same axis by sort order through `statusPaint` (`@/features/projects/utils/statusPaint`): the first status sits at violet, the last at pink. A colour picked in project settings (from `STATUS_SWATCHES`, brand colours only) overrides that slot; every status surface reads `statusPaint`, never `option.color` directly.

**Icons:** `@phosphor-icons/react` for all icons.

**Logo:** `UniffyLogo` component (`@/components/ui/uniffy-logo`) or `/uniffy-symbol.png`. The mark is multi-color and theme-agnostic - never recolor or `invert()` it. Regenerate icon sizes from `assets/uniffy-symbol.png`, do not hand-edit.

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
- Lint-enforced by `uniffy/no-raw-error-display` (shared plugin, web + mobile): `toast.error`/`toast.warning`/`Alert.alert` arguments and JSX may not carry raw `err.message`, `String(err)`, or interpolated `.status`/`.statusCode`. Helper calls are the sanctioned transformation; dev-gated diagnostic surfaces carry an inline disable stating the gate.

## Authentication

- Access tokens are memory-only (`memoryAccessToken` in `config/api.ts`) - **never persisted**; this is a security boundary. The interceptor auto-refreshes before calls; org context is stored separately from tokens.
- Authenticated `<img>`/`<video>`/`<audio>` resources use the asset-read cookie - contract, URL builders (`shared/utils/fileUrls.ts`), and the 401-retry listener are owned by `files-domain.md`. There is no service-worker auth proxy.
- Logout and organization switch clear ALL user/org-scoped state. `withSessionScope` (`app/sessionScope.ts`) resets data slices on `logout` and `resetOrganizationScope`, retaining device preferences and sanitized Projects and Files layout state. Slices that read storage at startup must also clear scoped values in state and storage at these boundaries. `sessionScopeMiddleware` runs before thunk middleware, aborts pending async thunks, and drops dispatches from work started in an ended session, including nested hydration actions. Caches outside Redux (upload engine, blob cache, URN metadata, notes cache) are cleared by `clearSessionCaches`; sign-out goes through `useSignOut`.

## Admin surfaces

Two scoped surfaces - keep them separate (see AGENTS.md "Two Product Targets"):

- `/admin/*` = org admin (one tenant): members, groups, domain admins, permission defaults, org settings. Gate with `useAdminAccess()` (`@/features/admin`).
- `/platform/*` = platform admin (cloud operator, cross-tenant): `@/features/platform` pages behind `PlatformLayout` + permission gates. Platform pages never render tenant content outside a `SupportSession`.

New admin pages belong under the matching surface; domain-admin badges reuse the URN type color associations.
