---
paths:
  - "src/uniffy/domains/files/**/*.py"
  - "src/uniffy/core/storage/**/*.py"
  - "src/uniffy/core/models/files/**/*.py"
  - "src/proto/files/**/*.proto"
  - "src/uniffy/core/auth/cookies.py"
  - "src/uniffy/core/auth/http.py"
  - "src/ui/src/features/files/**/*.ts"
  - "src/ui/src/features/files/**/*.tsx"
  - "src/ui/src/shared/utils/fileUrls.ts"
  - "src/ui/src/shared/utils/assetAuthRetry.ts"
---

# Files Domain: Uploads, Asset Reads, Media

How bytes move in and out of the app. Two subsystems: the unified upload engine (write path) and the
cookie-authenticated asset read path. Other rule files defer here for these.

## 1. Upload engine (write path)

One module-level singleton, `uploadService` (`features/files/upload/uploadService.ts`), owns ALL uploads -
files, chat attachments, editor paste, recording. It is framework-agnostic (no React/Redux import) and lives
outside the component tree, so uploads survive SPA navigation and belong to no page.

Pipeline: `enqueue(inputs)` -> drain loop (concurrency `UPLOAD_MAX_CONCURRENT` = 4) -> per upload
`filesApi.initiateUpload` -> `fileWorkerManager.uploadChunks` (slice + base64 + `UploadChunk` POSTs in a Web
Worker pool, off the main thread, Bearer with 401-refresh) -> `filesApi.completeUpload`. Progress is throttled
(<=200ms) before reaching subscribers; status changes emit immediately. Cancel passes an `operationId` so the
worker loop actually aborts.

Consumption (the engine owns its own state - a `Map` of `UploadRecord` + a blob map; read via
`subscribe(listener)` / `getRecords()`):
- Files/editor: `subscribeUploadMirror(dispatch)` (`reduxMirror.ts`) projects non-chat records into
  `uploadSlice`, a READ-projection (`records` + `trayView` + downloads; it does NOT drive uploads). The global
  `UploadTray` floating bubble (mounted in `App.tsx`) renders from it. `UploadBoot` (also `App.tsx`) starts the
  mirror, the failure-toast subscriber, the `app.showUploads` (Ctrl+U) recall, and `recover()` at boot.
- Chat: consumes `uploadService` DIRECTLY via the returned handle + a scoped `subscribe` - NEVER Redux (see
  `feedback_chat_upload_pattern`). The mirror filters `context === 'chat'` out of the tray.
- Completion -> File row: `enqueueFileUploads(inputs, dispatch)` awaits each handle and dispatches
  `setFile(fileToPlain(file))` + `bulkUpsertTags`. The engine never touches the files store itself.

Persistence + resume (`uploadStore.ts`, one IndexedDB DB `uniffy-uploads` with `records` / `blobs` / `chunks`):
- Metadata always persisted; the blob only when `size <= UPLOAD_PERSIST_MAX_BYTES` (~50 MB) or `persist:true`.
  Chat/editor pass `persist:false` (ephemeral). Oversize is logged, never silently dropped.
- `recover()` at boot re-queues uploads whose bytes survived a reload; for each it calls
  `filesApi.getUploadStatus` (the server is the authority on completed parts) and resumes the worker from the
  first missing part (the worker skips `completedChunks`). No stored blob -> failed "re-select".
- Recording's streaming uploader writes per-part into the same DB's `chunks` store; its recovery
  (`recoverOrphanedRecordings`) stays separate - streaming has a different shape than whole-blob uploads.

## 2. Asset read path (cookie-authenticated)

`<img>`/`<video>`/`<audio>` cannot send `Authorization` headers, so authenticated GET asset reads use a
Secure/HttpOnly/SameSite=Strict cookie named `uniffy_asset` (`__Secure-uniffy_asset` when secure) - it carries a
read-only JWT whose type claim is `asset_read`, a distinct type, NOT the access token (least privilege). There is
NO service-worker auth proxy.

- Cookie: minted by `create_asset_read_token` (`core/auth/tokens.py`); built + configured + attached by
  `core/auth/cookies.py::attach_asset_cookie` (env `ASSET_COOKIE_SECURE` / `SAMESITE` / `TTL_MINUTES`;
  `__Secure-` name prefix when secure; self-host http LAN sets Secure off). Set on every session-issuing RPC -
  Login/Register/RefreshToken/SwitchOrg/AcceptInvitation/VerifyMfa/ConfirmEnrollment - cleared on Logout
  (ConnectRPC CAN set response headers). TTL ~1h, refreshed every RefreshToken; carries `tkv`/`sid` so it
  rides the same revocation watermark. The same `name=value` pair rides in the auth response body
  (`asset_cookie` field) for native clients; browsers ignore it and use the HttpOnly Set-Cookie.
- Routes: `get_current_user_id` (`core/auth/http.py`) accepts Bearer access OR the `uniffy_asset` cookie,
  both through the same revocation checks. One shared dep covers `/api/files`, `/api/thumbnails`, `/api/media`,
  `/api/avatars`, `/api/agents/avatars`. The type-claim decoders keep the paths separate (access-in-cookie and
  asset_read-in-header are both 401). Permission gating stays in the route handler (`FileOperations.get_by_id`) -
  the dep only resolves identity.
- Media: `/api/media/{org}/{file}` (`media_router`, `domains/files/routes.py`) is a native HTTP Range route -
  `_parse_range` -> `ObjectStorage.download_range` -> `206` / `Content-Range`. This is what lets `<video>` seek.
- Frontend: build URLs with `buildFileUrl` / `buildThumbnailUrl` / `buildMediaUrl` / `getMediaUrl` /
  `buildAvatarUrl` (`shared/utils/fileUrls.ts`); same-origin requests carry the cookie automatically. A single
  global capture-phase `error` listener (`shared/utils/assetAuthRetry.ts`, installed in `main.tsx`) refreshes
  the cookie and retries an asset once when it 401s (idle past the cookie TTL).
- Mobile: no cookie jar - the app keeps the body pair in memory (`src/mobile/src/core/auth/auth.ts`) and
  attaches it as an explicit `Cookie` header via `assetAuthHeaders()`
  (`src/mobile/src/core/auth/assetAuth.ts`) on every
  asset request (expo-image, WebView PDFs, downloads, audio). Image error handlers use `assetAuthStale()` +
  `refreshSession()` to recover from an expired pair. Same rule as web: the pair is GET-read-only.

## Hard rules

- The upload engine stays framework-agnostic. Only `reduxMirror` knows Redux, and only for the files/editor
  tray. Chat NEVER uses the Redux upload path.
- Uploads (write) stay on Bearer in the worker pool. The `uniffy_asset` cookie (an `asset_read`-type JWT) is
  GET-read-only, never accepted for mutations; the RPC principal path is never taught the cookie.
- Asset-route permission checks are unchanged by the cookie - it proves the session, never access.
- Media is a plain HTTP Range route. Do NOT reintroduce a ConnectRPC media stream or a service-worker auth proxy.
- `getUploadStatus` is the authority on completed parts during resume - never re-POST a completed part.
- Both products: same-origin cookie, no `Domain`; `Secure` env-gated so self-host http LAN works.

Guard tests: `src/uniffy/tests/unit/core/auth/test_cookie.py`,
`src/uniffy/tests/unit/files/test_media_range.py`;
`features/files/upload/__tests__/uploadService.test.ts`, `shared/utils/__tests__/fileUrls.test.ts`.
