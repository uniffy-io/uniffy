---
paths:
  - "src/uniffy/domains/files/**/*.py"
  - "src/uniffy/core/storage/**/*.py"
  - "src/uniffy/core/models/files/**/*.py"
  - "src/proto/schema/files/**/*.proto"
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
`filesApi.initiateUpload` -> `fileWorkerManager.uploadChunks` (slice + binary protobuf through a generated
Connect client in a dedicated upload worker, off the main thread, Bearer with auth-refresh) -> `filesApi.completeUpload`.
All files share that worker's chunk budget. HTTP/1.1 or unknown protocol permits two chunks per file and
three across uploads; observed HTTP/2 or HTTP/3 permits four per file and eight across uploads. Raw chunk
buffers share a 128 MiB budget, acquired before reading a slice. Serialization can allocate additional copies.
ZIP and concatenation use the remaining workers. Cancellation aborts active requests and queued slices;
part failures settle sibling requests before reporting failure. Simultaneous auth failures share one refresh
per upload. Resumed and out-of-order parts advance progress by completed count, not part number.
Progress is throttled (<=200ms) before reaching subscribers; status changes emit immediately. Cancel passes
an `operationId` so the worker loop actually aborts.

Scope (tabs of one browser can sit in different organizations):
- Memory holds this tab's uploads only. The `uniffy-uploads` database is shared by every tab of the origin, so
  every stored row (record, blob, recording chunk) carries `userId` + `organizationId`, and a record also
  carries `ownerTabId` (a per-tab id kept in `sessionStorage`, so it survives a reload of that tab).
  `uploadScope.ts` holds the tab's current scope and its id; `recover` sets the scope, scope boundaries clear it.
- The tab running an upload holds the Web Lock `uniffy:upload:<id>` from enqueue (or adoption on recovery)
  until the stored row is deleted, so no other tab resumes it twice.
- `resetForScope()` (organization switch in this tab): cancel this tab's active uploads, delete only this tab's
  rows, publish an empty snapshot. It never clears the shared stores. `reset()` is a deprecated alias.
- `purgeUser(userId)` (sign-out, session death): `resetForScope()` plus every stored row of that account and
  every row without an owner stamp.
- `purgeOrganization(organizationId, userId?)` (a confirmed lost grant): cancel and drop this tab's uploads in
  that organization and delete its stored rows for every tab, narrowed to one account when `userId` is given.
  The server refuses those uploads once membership ends, and the stored bytes copy files the user still
  holds. Unlike pending realtime edits, upload rows are never kept for a reactivation.
- `hasActiveUploads()` tells a switch to confirm before `resetForScope()` cancels this tab's uploads.
- Late responses and recovery reads cannot restore retired uploads.

Consumption (the engine owns its own state - a `Map` of `UploadRecord` + a blob map; read via
`subscribe(listener)` / `getRecords()`):
- Files/editor: `subscribeUploadMirror(dispatch)` (`reduxMirror.ts`) projects non-chat records into
  `uploadSlice`, a READ-projection (`records` + `trayView` + downloads; it does NOT drive uploads). The global
  `UploadTray` floating bubble (mounted in `App.tsx`) renders from it. `UploadBoot` (also `App.tsx`) starts the
  mirror, the failure-toast subscriber, the `app.showUploads` (Ctrl+U) recall, and `recover()` for each scope.
- Chat: consumes `uploadService` DIRECTLY via the returned handle + a scoped `subscribe` - NEVER Redux (see
  `feedback_chat_upload_pattern`). The mirror filters `context === 'chat'` out of the tray.
- Completion -> File row: `enqueueFileUploads(inputs, dispatch)` awaits each handle and dispatches
  `setFile(fileToPlain(file))` + `bulkUpsertTags`. The engine never touches the files store itself.

Persistence + resume (`uploadStore.ts`, one IndexedDB DB `uniffy-uploads` with `records` / `blobs` / `chunks`):
- Metadata persisted once the tab knows its account; the blob only when `size <= UPLOAD_PERSIST_MAX_BYTES`
  (~50 MB) or `persist:true`, and only while storage encryption is ready. Chat/editor pass `persist:false`
  (ephemeral). Oversize is logged, never silently dropped.
- Blobs rest only as AES-GCM ciphertext under the per-user device key (`shared/crypto/storageEncryption.ts`)
  with additional data `uniffy-upload-v1|<userId>|<organizationId>|<record id>`. A blob that fails
  authentication (another scope, a rotated key) reads as missing. Uploads started without a key store
  no bytes, so recovery asks to re-select once the key is available.
- `recover({ userId, organizationId })` runs whenever the tab's account or organization changes (`UploadBoot`)
  and when storage encryption becomes ready. It stamps the scope immediately but waits for the key before
  reading stored bytes. Losing the key during recovery releases the lock and preserves the stored row.
  It lists only that scope's incomplete records, skips any whose lock another tab holds, re-reads the row
  under the lock, then calls `filesApi.getUploadStatus` (the server is the authority on completed parts) and
  resumes the worker from the first missing part (the worker skips `completedChunks`). Other scopes' records
  wait for a tab in that scope. No stored blob -> failed "re-select". Without Web Locks (plain HTTP origins) a
  tab resumes only records whose `ownerTabId` is its own.
- Recording's streaming uploader writes per-part into the same DB's `chunks` store, stamped with the tab's
  scope; its recovery (`recoverOrphanedRecordings`) stays separate - streaming has a different shape than
  whole-blob uploads - and resumes only chunks of the tab's scope after encryption is ready. Chunks use
  AES-GCM with additional data `uniffy-recording-v1|<userId>|<organizationId>|<uploadId>|<partNumber>`.
  No key or scope means memory-only buffering. Writes and deletion serialize per upload so encryption
  cannot restore an already-uploaded or cancelled part. Recovery authenticates every buffered part before
  completing an upload; failed reads and transient upload failures preserve ciphertext for retry.
  The upload database closes pending chunk writes and participates in device encryption-cache clearing.
- Server gate: `UploadChunk`, `UploadChunks`, `GetUploadStatus` and `CompleteUpload` require the uploader to be
  an active member of the upload's organization, not just `upload.user_id`. A removed or deactivated member
  gets the same NOT_FOUND as a missing upload, so no File lands in an organization they left. `remove_member`
  and directory-sync deprovision also expire that member's ACTIVE uploads in the organization in their transaction
  (`files.cleanup.stage_member_upload_expiry`), so a re-add does not revive them; every write path treats an
  ACTIVE row past `expires_at` as EXPIRED, and the multipart reaper aborts the parts.

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
- Upload rows are scoped by account, organization and owning tab. Never clear the shared stores at a scope
  boundary, and never resume a record of another scope or one whose lock another tab holds.
- Both products: same-origin cookie, no `Domain`; `Secure` env-gated so self-host http LAN works.

Guard tests: `src/uniffy/tests/unit/core/auth/test_cookie.py`,
`src/uniffy/tests/unit/files/test_media_range.py`;
`features/files/upload/__tests__/uploadService.test.ts`, `features/files/upload/__tests__/uploadStoreScope.test.ts`,
`features/recording/__tests__/recoverOrphanedRecordings.test.ts`, `shared/utils/__tests__/fileUrls.test.ts`.
