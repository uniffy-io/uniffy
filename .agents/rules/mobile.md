---
paths:
  - "src/mobile/**/*.ts"
  - "src/mobile/**/*.tsx"
---

# Mobile App (Expo / React Native)

Conventions for the mobile client at `src/mobile/`. Expo Router app on React Native 0.86, React 19, ConnectRPC + TanStack Query, the same proto contracts as the web app (`@uniffy/proto`). Domain invariants shared with the backend and web live in their own rule files (`permissions.md`, `mentions.md`, `calls-domain.md`, `chat-domain.md`, `files-domain.md`, `notes-realtime.md`); this file owns structure and mobile-specific conventions only.

The layout mirrors the web app (`src/ui/src/{app,features,shared,config}`) on purpose so a change is easy to port both ways. `core/` here is the counterpart of the web `config/`.

## Source lives under `src/`

All app source is under `src/mobile/src/`. Config files stay at the package root (`app.json`, `metro.config.js`, `babel.config.js`, `tsconfig.json`, `oxlint.config.ts`, `package.json`) and `assets/` stays at the root too, because `app.json` references icons and splash from `./assets`. Expo Router auto-detects `src/app` as the routes root. Do not move config or assets into `src/`.

## Layering

Four layers plus design tokens. Dependencies point one direction only:

```
app  ->  features  ->  shared  ->  core  ->  theme
```

| Layer | Path | Holds | May import |
|---|---|---|---|
| `app` | `src/app/` | Routes only. Thin files, one per URL. The root `_layout` composition. | anything |
| `features` | `src/features/<domain>/` | Everything for one domain: screens, components, api, hooks, serializer. | features, shared, core, theme |
| `shared` | `src/shared/` | Reusable UI, hooks, and cross-cutting sub-domains used by 2+ features. | shared, core, theme |
| `core` | `src/core/` | App infrastructure with no domain logic: transport, query client, session, config, providers, cross-cutting types. | core, theme |
| `theme` | `src/theme/` | Pure design tokens (colors, typography, color math). | nothing |

`shared`, `core`, and `theme` must never import from `features` or `app`. `core` must not import `shared`. `theme` imports from no other layer. These rules are enforced by `no-restricted-imports` in `oxlint.config.ts`; a violation fails `./manage.py lint -s mobile`. If a shared or core file needs something from a feature, the thing is misplaced: move it down a layer, or lift the data fetch up into the route (`app/`) and pass it as a prop. `BottomNav` is the pattern for the second case: it takes an `unreadCount` prop instead of importing the notifications hook, and `_layout` supplies the value.

Feature-to-feature imports are allowed (chat uses agent and file components, projects uses the calendar picker). Keep them shallow and obvious. When two features share a piece with no domain logic of its own, promote it to `shared` rather than deep-importing across domains.

## Path aliases

Every import uses an alias. Relative imports across modules are not used (only static asset `require()` paths are relative, and they resolve to the root `assets/`).

| Alias | Target |
|---|---|
| `@app/*` | `src/app/*` |
| `@features/*` | `src/features/*` |
| `@shared/*` | `src/shared/*` |
| `@core/*` | `src/core/*` |
| `@theme/*` | `src/theme/*` |
| `@uniffy/proto/*` | generated proto (`src/gen/typescript`) |

`@/*` maps to `src/*` and exists only as a fallback. Prefer the layer aliases; they make the dependency direction visible at the import site.

## Routing

`app/` is routing structure, nothing else. A route file is thin and delegates to a screen that lives in the owning feature:

```tsx
// src/app/chat/[id].tsx
export { default } from "@features/chat/screens/ChatScreen";
export * from "@features/chat/screens/ChatScreen";
```

The `export *` forwards any Expo Router route config the screen declares (`unstable_settings`, `ErrorBoundary`, `generateStaticParams`). Route files keep the `default` export that Expo Router requires; this is the one place a default export is expected. Screens and every other module use named exports.

Screen components live in `src/features/<domain>/screens/` and are named `*Screen.tsx` (PascalCase, e.g. `ChatScreen.tsx`, `NotificationPreferencesScreen.tsx`). Do not inline screen logic (state, RPC calls, styles) into a route file under `app/`. The route URL and its file path stay stable when the screen moves; only the delegation target changes. Layout files (`_layout.tsx`), route groups like `(tabs)`, and Expo specials (`+not-found.tsx`, `+native-intent.tsx`) stay in `app/`. Do not put non-route files inside `app/`; Expo Router treats files there as routes.

## Feature module anatomy

A feature is self-contained. Flat files at the feature root for the data layer, with `components/` and `screens/` subfolders:

```
src/features/chat/
  chatApi.ts            RPC client (createClient over the shared transport)
  chatStreamApi.ts      streaming variant when needed
  useChat.ts            TanStack Query read hooks
  useChatMutations.ts   TanStack Query mutation hooks
  chatSerializer.ts     proto -> view-model, and the view-model types
  components/           domain components (ChatComposer, MessageAttachments, ...)
  screens/              *Screen.tsx route targets
```

Not every feature needs every part; small features (bookmarks) are a hook plus an api plus a screen. Keep the query hook file and the mutation hook file split when both are non-trivial; combine them when the feature is small.

### Data layer flow

```
core/api/transport  ->  features/<d>/<d>Api  ->  features/<d>/use<D>  ->  features/<d>/<d>Serializer
   transport             RPC client              TanStack Query           proto to view-model
```

The transport, the streaming transport, and the query client are created once in `core/api/`. Auth token storage and the auth interceptor live in `core/auth/`. Feature API modules call `createClient(Service, transport)` and expose typed pass-through methods. Hooks wrap them in `useQuery`/`useMutation`. Serializers convert proto messages to view-model types and export those types.

### Timeouts and network resilience

React Native's Android fetch has no native timeouts, so an RPC without a deadline can hang forever on LTE. Every new domain and every new API call follows these rules:

- **Every RPC rides a shared transport from `core/api/`.** Never create a per-feature transport and never hit the API with raw `fetch` - `no-restricted-globals` in `oxlint.config.ts` enforces this across `features/` and `shared/`; the sanctioned non-RPC exceptions (asset reads, local `file://` URIs) carry an inline disable stating why. The same config bans `EXPO_PUBLIC_*` env vars (`uniffy/no-expo-public-env`) and CDN URL literals (`uniffy/no-cdn-urls`, both from the repo-root `lint/uniffy-oxlint-plugin.mjs`). The unary transports carry `DEFAULT_RPC_TIMEOUT_MS` (10s, `core/api/baseFetch.ts`) as `defaultTimeoutMs`, so a pass-through api method gets a bounded deadline for free. This is the interactive tier: list, get, create, send.
- **RPCs that legitimately run long get `SLOW_RPC_TIMEOUT_MS` (60s) per call, set inside the feature's api module** - not at hook or screen call sites. `filesApi.ts` is the reference: `uploadChunk`, `completeUpload`, `copyItems`, `bulkDelete`, `emptyTrash` pass `{ timeoutMs: SLOW_RPC_TIMEOUT_MS }`. Qualifying means real server-side storage or export work; "might be a big list" does not qualify (paginate instead).
- **Server-streaming RPCs use `streamTransport` and carry NO deadline.** A call timeout would kill the long-lived stream. The consumer owns liveness and reconnection instead: the chat stream (`features/chat/useChatStream.ts`) is the reference - heartbeat watchdog (abort after 2.5 missed 30s server heartbeats), exponential backoff with jitter, restart kick on AppState active and connectivity regained. A new stream consumer copies that shape; a stream without a watchdog silently goes half-open on LTE and never recovers.
- **Cancellable or retried calls accept `options?: { signal?: AbortSignal }`** in the api method and thread it to the client, so hooks can abort in-flight work (see the upload pipeline).
- **Connectivity and focus are already wired** (`core/api/connectivity.ts` feeds TanStack's `focusManager`/`onlineManager`). New query hooks get foreground refetch for free; do not add per-screen AppState refetch listeners.

## Cross-cutting placement

Concerns used across many domains do not belong to any one feature:

- `shared/comments`, `shared/presence`, `shared/permissions`, `shared/directory`: cross-cutting sub-domains (api + hook + serializer + the sheet/badge component).
- `shared/mentions`: the leaf mention primitives (`MentionTextInput`, `ReferenceChip`, `useMentionInput`) that have no feature dependencies.
- `shared/components`, `shared/hooks`, `shared/lib`: generic primitives (`Avatar`, `DomainHeader`, `MarkdownRenderer`, `BottomNav`), generic hooks (`useTheme`), and pure utils.
- `features/mentions`: the `@` overlay (`AtOverlay`) and reference-insertion helper. These orchestrate search, agents, and files, so they are feature-level, not shared.
- `core/providers`: the global providers (`AuthContext`, `ThemeContext`, `UniffyContext`). They depend only on `core`. The call provider lives in `features/calls` since it is calls-domain state.
- `core/types.ts`: cross-cutting types (`Domain`, `CurrentUser`).
- `theme/`: `theme.ts` tokens, `typography.ts`, `colorUtils.ts`. Read tokens through `useTheme()` (returns resolved dark/light colors plus `isDark`), not by importing raw token maps into components.

Calls render as a global overlay mounted from `_layout`, not as a route, but everything calls-related still lives in `features/calls/` (api, hooks, serializer, LiveKit glue, `CallContext`, components).

## Conventions

- Named exports everywhere. The sole default export is a route file's re-export of its screen.
- Filenames are PascalCase for React component modules (`ChatScreen.tsx`, `AuthContext.tsx`, `ChatComposer.tsx`) and camelCase for everything else (`chatApi.ts`, `useChat.ts`, `queryClient.ts`). No kebab-case. `unicorn/filename-case` in `oxlint.config.ts` enforces this across `features/`, `shared/`, `core/`, and `theme/`; `app/` is exempt because Expo Router owns those names (URL segments plus specials like `+not-found`, `[id]`, `(tabs)`).
- Static assets stay at the root `assets/`. Reference them with a relative `require()` from the file's location, or add an `@assets` alias if the depth becomes awkward.
- Platform variants use the `.native.ts` / `.ios.tsx` / `.web.tsx` suffix (for example `features/calls/livekit.ts` + `livekit.native.ts`); import the base specifier and let Metro pick.
- No barrel `index.ts` files today; imports target the concrete module. If barrels are introduced later, they do not change the layering rules.
- Follow `comment-discipline.md`: no plan/phase/PR references in code or identifiers, no decorative dividers, no restate-the-name docstrings.

## Adding a feature

1. Create `src/features/<domain>/` with the api, hook(s), serializer, `components/`, and `screens/` you need.
2. Add route files under `src/app/<domain>/` that re-export the screens.
3. Cross-cutting pieces go in `shared/` or `core/`, never inside another feature.
4. Run `./manage.py lint -s mobile` to confirm no layer boundary is crossed.

## Adding a screen to an existing feature

1. Write `features/<domain>/screens/<Name>Screen.tsx` with a default export.
2. Add `app/<domain>/<route>.tsx` that re-exports it (`export { default } ...; export * ...`).
3. Keep all logic in the screen; the route file stays two lines.
