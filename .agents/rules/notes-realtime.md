---
paths:
  - "src/uniffy/core/realtime/**/*.py"
  - "src/uniffy/core/models/realtime/**/*.py"
  - "src/uniffy/domains/notes/**/*.py"
  - "src/uniffy/core/models/notes/**/*.py"
  - "src/proto/schema/notes/**/*.proto"
  - "src/ui/src/features/notes/**/*.ts"
  - "src/ui/src/features/notes/**/*.tsx"
  - "src/ui/src/features/realtime/**/*.ts"
  - "src/ui/src/features/realtime/**/*.tsx"
  - "src/mobile/src/shared/realtime/**/*.ts"
  - "src/mobile/src/features/notes/realtime/**/*.ts"
  - "src/mobile/src/features/notes/realtime/**/*.tsx"
---

# Notes Domain + Realtime Collaboration (Yjs / pycrdt)

Notes is the only live consumer of the generic realtime stack.

## 1. Big picture

```
Browser tab ────► ONE WebSocket  /api/realtime?org_id=<uuid>
                       │   subprotocol = ['uniffy.realtime.v1', 'bearer.<jwt>']
                       │   frame = [VarString docName][y-protocols bytes]
                       │   docName = "NOTE:<uuid>"  (extensible: "TASK:<uuid>" etc.)
                       ▼
         core/realtime/ws_routes.py     (auth once on upgrade)
                       │
                       ▼
         core/realtime/session.py       run_multiplexed_session
                       │  peek_var_string → lazy authorize + acquire on first frame per docname
                       ▼
         core/realtime/ydoc_manager.py  YDocManager (cache + fanout + hydration + idle eviction)
                       │ ◀── RouterCallbacks ──┐
                       ▼                       │
         core/realtime/adapter.py        get_realtime_adapter(NOTE)
                       │                       │
                       ▼                       │
         domains/notes/adapter.py     │
            authorize / hydrate_ydoc /         │
            render_and_persist                 │
                       │                       │
                       ▼                       │
         pycrdt.Doc  (in memory, per replica)  │
                       │                       │
        every 5 s OR on idle eviction          │
                       ▼                       │
         core/realtime/snapshot.py             │
            SnapshotWriter.schedule            │
                       │                       │
                       ▼                       │
         core/realtime/jobs.py                 │
            save_realtime_snapshot (ARQ)       │
            UPSERT realtime_yjs_snapshots      │
            adapter.render_and_persist         │
                       │                       │
                       ▼                       │
         notes_notes.content / canvas_content  │
            version++, outgoing_references,    │
            inline tags, search reindex,       │
            _notify_new_mentions               │
                                               │
         core/realtime/router.py  RealtimeRouter (process-wide)
            PSUBSCRIBE realtime:doc:*
            PSUBSCRIBE realtime:perm:*
            PSUBSCRIBE realtime:defaults:*
            PSUBSCRIBE auth:revoke:*
            origin-replica dedupe lives here
```

`core/realtime/state.py` holds the shared dataclasses (`WSSession`, `ClientHandle`, `YDocSession`, `DocKey`, `doc_name_for`, `parse_doc_name`) so `ydoc_manager.py` / `snapshot.py` / `router.py` can all import them without cycles. Keeping this shared state independent is load-bearing.

---

## 2. Generic core vs domain adapter

**`core/realtime/*` does not import from `domains/*`.** Domain coupling goes through `RealtimeContentAdapter`. Adding tasks / projects / comments realtime later means writing a new adapter rather than touching the core.

```python
class RealtimeContentAdapter(Protocol):
    content_type: ContentType
    async def authorize(session, user_id, organization_id, content_id) -> ContentRole | None: ...
    async def hydrate_ydoc(session, ydoc, content_id, organization_id) -> None: ...
    async def render_and_persist(session, ydoc, content_id, organization_id) -> bool: ...
```

The notes adapter lives at `domains/notes/adapter.py`. `factory.create_app` and the core
worker startup hook call `register_note_realtime_adapter()` explicitly; importing the notes package
does not mutate the registry.

Adapter rules:
- `authorize` returns `None` (rather than raising) for no access / missing row. Reach for `PermissionChecker.effective_role(...)` directly; `_require_view` raises and is the wrong fit here.
- `hydrate_ydoc` is invoked once per process when the snapshot row is empty. Notes dispatches on `node_type`:
  - `NodeType.NOTE` / `TEMPLATE` -> seed `Y.Text("markdown")` with current `note.content`.
  - `NodeType.CANVAS` -> seed `Y.Map "nodes"` + `Y.Array "order"` + `Y.Map "edges"` + `Y.Map "defaults"`. Per-node text fields (`text.content`, `shape.label`, `mindmap.label`) are wrapped as `pycrdt.Text` at seed time - lazy-upgrading them later races concurrent attaches.
- `render_and_persist` is idempotent. The ARQ job can fire repeatedly with the same state. Return
  `False` when the target row is missing or soft-deleted so a stale queued or idle-eviction flush
  removes its snapshot instead of recreating orphan state. Reach for `NoteOperations.realtime_save(...)`,
  which mirrors `autosave()` minus the permission gate + optimistic-version check. Snapshot has no
  acting user, so mention notifications / inline tags use the note's `owner_id` as the actor.

---

## 3. Wire format (Hocuspocus V2 framing)

```
[VarString docName][y-protocols frame bytes]
```

- `VarString` = lib0 varint length prefix + UTF-8 body. Implementations in `core/realtime/multiplex.py` (Python) and `features/realtime/multiplex.ts` (TS) are byte-compatible. Rolling your own tends to introduce subtle drift.
- `docName = "<CONTENT_TYPE>:<uuid>"`, e.g. `"NOTE:01a3..."`. `doc_name_for(key)` / `parse_doc_name(name)` are the canonical producers / consumers.
- `peek_var_string(buf)` returns `(doc_name, payload_offset)` without consuming the y-protocols payload. The router hands `buf[payload_offset:]` straight to the per-doc handler. Decoding + re-encoding here regresses Hocuspocus issue #724 - it is solved by design.
- The y-protocols payload inside the envelope is unchanged. Reach for `pycrdt`'s helpers (`create_sync_message`, `handle_sync_message`, `Decoder.read_message`, `create_update_message`) via `core/realtime/wire.py`. Edit-gate predicate is `is_sync_write_frame` - VIEWERs sending a write close the whole socket with `4403`. The client multiplexer therefore marks viewer docs read-only (emits no SyncStep2/SyncUpdate writes for them) and suppresses empty `[0,0]` SyncStep2 replies for every doc; viewers get live reads + presence without tripping the gate.

---

## 4. Auth on the WebSocket

Bearer JWT travels in `Sec-WebSocket-Protocol` as `bearer.<urlencoded-token>` alongside the canonical `uniffy.realtime.v1` protocol value. `extract_bearer` parses it; mobile clients can fall back to the `Authorization` header (`extract_bearer_from_auth_header`). On accept, the server echoes ONLY `uniffy.realtime.v1` - the server MUST NOT echo the bearer entry back, since doing so leaks the token via `WebSocket.protocol`. This is a security boundary.

Order of checks at upgrade (all in `ws_routes.py`):
1. Origin allowlist.
2. Subprotocol JWT decode (or `Authorization` header for mobile).
3. `payload["type"] == "access"` - refresh tokens are rejected even though they share the HS256 secret.
4. Token `org_id` claim matches the URL `org_id` query.
5. `min_tkv` watermark AND the per-session `sid` marker. **Both revocation signals, not one:** per-session revoke deliberately does not bump `token_version`, so the watermark alone would let a "logged out" device open a fresh socket.
6. Active org membership.

**A socket outlives the JWT that opened it, so the same signals are re-checked while it runs.** `core/realtime/reauth.py::connection_denial` is the single decision function; `session.py` calls it from a per-socket watchdog every `REAUTH_INTERVAL_SECONDS` and again on every `_attach_doc`. It covers what the revoke fanout structurally cannot: the fanout iterates per-doc handles, so a connected socket with no doc attached is invisible to it, and org-member removal publishes no realtime signal at all. It also makes the token's `exp` a real ceiling (`WSSession.expires_at`, falling back to `MAX_SOCKET_LIFETIME_SECONDS` when a token carries no `exp`) - otherwise a stolen access token converts into an unbounded read/write channel. Closes are counted by reason on `uniffy_realtime_reauth_closes_total`.

Per-doc authorize runs **lazily** on the first frame for each unseen docname inside `run_multiplexed_session`. Denial closes the whole socket (`4403`) rather than just the doc - otherwise the client waits forever for a SyncStep1.

Close codes (`features/realtime/protocol.ts` mirrors these):
- `1009` oversized frame, `4401` missing/invalid token, `4403` forbidden (org / view / edit / revoked), `4404` not found, `4408` idle eviction, `4409` re-auth required, `4410` token revoked.
- `4409` and `4410` must stay distinct: on `4410` the client stops and lets the app shell redirect, on `4409` it refreshes the token and reconnects (`reconnectAfterRefresh`). Closing an expired-token socket with `4410` would log the user out of realtime for the rest of the tab's life.

Token refresh mid-session: `api.ts::refreshAccessToken` dispatches `uniffy:auth:refreshed`; the multiplexer disconnects + reconnects with the new token. Token revocation (`token_version` bump in `domains/users/operations.py::update_user`) publishes `auth:revoke:{user_id}` and the router closes every stale handle with `4410`.

---

## 5. Multiplexed transport

**One WebSocket per browser tab carries every doc.** Per-doc connections did not scale (1000 orgs × 100 users -> ~70k Valkey subscribers per replica vs `maxclients=10000`).

Backend:
- Single FastAPI route `/api/realtime?org_id=<uuid>`. No content_type / content_id in the URL.
- `WSSession` (per WS) owns the outbound queue + a `doc_handles: dict[DocKey, ClientHandle]`. Outbound frames are wrapped with `encode_doc_frame(doc_name, body)` at enqueue time so the WS pump is a trivial drain loop. The per-WS queue (`OUTBOUND_QUEUE_MAX = 1024`) bounds backpressure for the whole socket.
- One `RealtimeRouter` per process owns 5 `PSUBSCRIBE`s (`realtime:doc:*`, `realtime:perm:*`, `realtime:defaults:*`, `auth:revoke:*`, `auth:revoke_sid:*`). The manager registers per-doc sessions + per-handle attachments with the router on acquire / release; the router dispatches Valkey payloads back into the manager via `RouterCallbacks`. **New per-doc / per-user subscribe tasks regress the scale fix.** Generic channel and pattern subscriptions live in `infrastructure/valkey/pubsub.py`; chat and notifications supply their owner-defined channel names.

Frontend:
- `features/realtime/multiplexer.ts` exports the singleton `realtimeMultiplexer`. `attach({ contentType, contentId, ydoc, awareness, onStatus, onSync, onCloseCode })` returns a `DocSubscription` with `destroy()`. One WS opens on first attach, closes after 30s with no attached docs. Subprotocol auth, exp backoff (500ms -> 15s), 30s periodic resync.
- Trigger events the multiplexer listens for: `online`, `offline`, `visibilitychange`, `uniffy:auth:refreshed`, `uniffy:auth:revoked`. y-protocols awareness keep-alive runs every 15s (the lib GCs peers after ~30s of silence - skipping this makes peer cursors vanish during typing pauses).
- Awareness handoff has three legs, all required because the backend keeps **no** server-side awareness map (it is a blind relay): (1) on attach/reconnect the client sends its own awareness **and** a `MESSAGE_QUERY_AWARENESS` so live peers re-announce - without the query a joiner stays blind to an idle peer's cursor until that peer's next 15s keep-alive; (2) the backend relays `MESSAGE_QUERY_AWARENESS` to peers like any awareness frame (dropping it re-opens the blind-join gap); (3) on detach the client broadcasts a `removeAwarenessStates` frame so peers drop its cursor immediately instead of waiting out the 30s GC. A hard tab close skips leg 3, so the 30s GC stays the floor for that path.
- **`y-websocket` is not installed.** It was removed when the multiplexed transport landed. Editor bindings (`y-prosemirror`, `y-protocols`, our `canvasBinding`) talk to `Y.Doc` / `Awareness` directly. Reintroducing `WebsocketProvider` regresses the design.

Failure isolation: multiplexed transport has head-of-line blocking (slow doc can stall peers on the same WS). Mitigations baked in: 1MB frame cap, bounded outbound queue with drop policy, canvas throttle ~30ms. Acceptable for this app's edit rates - revisit with profiling if needed.

---

## 6. Permission revoke / token revoke fanout

- `domains/permissions/members.py` publishes `realtime:perm:{content_type}:{content_id}` after every commit in `add_member`, `update_member_role`, `remove_member`, `set_access_mode`, `transfer_ownership`. Targeted user_id when the subject is a USER; content-wide (`user_id=None`) for GROUP / access-mode / ownership changes (re-authorizes every active client).
- `domains/users/operations.py::update_user` publishes the realtime token-revoke fanout after every `token_version` bump (deactivation + password change). `core/auth/revocation.py` owns the Valkey-backed token and session revocation facts; `core/realtime/publisher.py` owns realtime channel publication.
- Decision matrix (`_enforce_role_change` in `ydoc_manager.py`):
  - BLOCKED / None / unknown role value -> `4403` close.
  - Otherwise `handle.can_edit = role_can_edit(role)` - the same EDITOR floor as attach-time, so VIEWER and COMMENTER are read-only in place.
- `_close_handle` is idempotent via the `closed` flag - subscribers can call it from outside the session loop.

---

## 7. Snapshot pipeline

- `SnapshotWriter` lives in `core/realtime/snapshot.py`. `schedule(session)` re-arms a 5s per-key debounce, capped by `SNAPSHOT_MAX_DELAY` (30s): once a key's pending window exceeds the cap, the flush runs immediately instead of re-arming, so continuous typing cannot starve persistence. `flush(session)` encodes `ydoc.get_update()` + `ydoc.get_state()` under `session.lock`, base64-wraps, enqueues `save_realtime_snapshot` on the `core` ARQ queue; `flush(session, force=True)` persists in-process via the shared `persist_snapshot()` (UPSERT + render) with no queue dependency. The debounce task must never cancel itself when it is the one flushing (`task is not asyncio.current_task()` guard).
- The `SAVE_REALTIME_SNAPSHOT` contract lives in `core/realtime/job_contracts.py`; its `save_realtime_snapshot(ctx, content_type, content_id, organization_id, update_b64, state_vector_b64)` handler lives in `core/realtime/jobs.py` and `workers/registry.py` binds the pair to the core fleet. The handler UPSERTs `realtime_yjs_snapshots` (composite PK `(content_type, content_id)`), then calls `adapter.render_and_persist`; a missing target removes the snapshot again so a stale job cannot resurrect it.
- `_job_id` is `snapshot:{ct}:{id}:{sha256(update_bytes)[:16]}`. Hashing the payload (rather than just the key) is part of the contract - ARQ caches completed job results for `WORKER_KEEP_RESULT` seconds and a static id silently drops every subsequent enqueue. Reusing `snapshot:NOTE:<id>` froze `notes_notes.content` mid-session in an earlier revision.
- `YDocManager.apply_local_update` AND `_apply_remote_pubsub_update` both call `snapshot_writer.schedule(session)` so the pipeline runs whichever replica receives the edit.
- `YDocManager._evict_after_idle` force-flushes in-process while the session STAYS registered, then re-checks for attached clients under the global lock before removal. A concurrent acquire finds the live session and never hydrates from the pre-flush snapshot row.
- `NoteOperations.update` deletes the `realtime_yjs_snapshots` row when content changes (next cold open re-hydrates from the fresh column) AND publishes a `content_replace` payload on the doc channel. Session-holding replicas graft the new content into their live doc as a CRDT edit (`_apply_content_replace` -> `adapter.apply_external_content`, NOT origin-deduped since the publisher may hold the session) - without the graft, a live session's next flush would clobber the legacy write with stale doc state. The graft is single-session-holder correct; concurrent multi-replica holders of the same doc need the doc-epoch work before they can apply it convergently. Ordinary note writes and realtime saves CAS on `version` with up to 3 attempts. Agent content replacement supplies `expected_content_version` and gets exactly one attempt so a newer human edit is a conflict, never a replacement target. Metadata-only updates do not bump `version`, so title edits cannot starve realtime renders. `realtime_save` warns + counts a metric on non-empty to empty content transitions.

---

## 8. Frontend - generic `features/realtime/`

```
features/realtime/
├── multiplexer.ts         (singleton, the only WebSocket owner)
├── multiplex.ts           (peekVarString / encodeDocFrame, byte-compatible with Python)
├── protocol.ts            (close codes + RealtimeStatus type)
├── hooks/useDocSession.ts (per-doc Y.Doc/Awareness/UndoManager lifecycle)
├── hooks/useDocAwareness.ts
├── persistence/encryptedYjsPersistence.ts
└── components/RealtimePresence.tsx
```

`useDocSession({ contentType, contentId, enabled, undoTarget, captureTimeout })` returns `{ ydoc, awareness, undoManager, status, sessionId, whenSynced }`. `whenSynced` resolves after BOTH the first server SyncStep2 for this doc AND encrypted-IDB hydration (a hydrate failure logs a warning and counts as complete; offline it stays pending). Always gate seed-time writes on it - cold-start hydration is a race window otherwise.

Encrypted IDB persistence:
- One DB `uniffy-realtime-yjs`, composite key `[contentType, contentId, seq]` where `seq` is `${epoch}:${counter}` with a random epoch per attach - sessions and concurrent tabs can never overwrite each other's rows, and there is no meta store (Yjs updates are commutative, so replay order across epochs does not matter). Registered in `ENCRYPTED_DB_NAMES` in `storageEncryption.ts` so cache-seed rotation wipes it.
- Writes filter `HYDRATION_ORIGIN`, `REMOTE_ORIGIN`, and `MARKDOWN_MIRROR_ORIGIN` (all Symbols; the multiplexer applies server updates under `REMOTE_ORIGIN`) - only primary local edits get persisted.
- Update bytes are base64-wrapped before `encryptForStorage` (the encrypt helper is JSON-only).
- Compaction every 100 updates + on `beforeunload`. Listens for `uniffy:encryption:rekey` (re-seed) and `uniffy:encryption:teardown` (no-op writes via `isStorageEncryptionReady`).
- Per-row decrypt failure -> skip + continue. Nuking the whole doc tends to lose recoverable rows.

---

## 9. Frontend - notes wiring

```
features/notes/realtime/
├── markdown.ts                  Y.Text / Y.XmlFragment helpers
├── canvasBinding.ts             Y.Map <-> React Flow diff
├── useNoteRealtimeSession.ts    composes useDocSession for markdown
├── useCanvasRealtimeSession.ts  composes useDocSession for canvas (incl. Y.Map "defaults")
├── useMarkdownContent.ts        live Y.Text("markdown") read with debounced fallback
├── CanvasAwarenessOverlay.tsx   peer pointer labels on the canvas
└── RealtimeStatusBadge.tsx
```

Markdown:
- `CrepeEditor` accepts a `realtime` binding. When present: skip `defaultValue` seeding (avoid seeding race), register `ySyncPlugin / yCursorPlugin / yUndoPlugin` via `$prose`, and mirror the serialized doc into `Y.Text("markdown")` so the snapshot pipeline reads canonical markdown. The mirror is a `$prose` plugin hooking `view.update` (Milkdown's `markdownUpdated` listener filters ySync transactions and must not be used), writes under `MARKDOWN_MIRROR_ORIGIN`, and stays OFF until the seed confirms the PM doc reflects `Y.Text` (`markdownMirrorReady`) - an unseeded empty doc must never overwrite real markdown. Only the ORIGIN tab mirrors: ySync-applied transactions (`isChangeOrigin`) are skipped, since their origin peer already mirrored them and N tabs re-serializing the same doc is discarded work. A pending debounced mirror write flushes on plugin destroy instead of being dropped (unmount inside the window must not leave `Y.Text` stale); the mirror writes minimal deltas via `diffStrings`, not whole-doc replaces.
- Cold-start seed + reconciliation, gated on `whenSynced`: `Y.Text("markdown")` is canonical, the fragment yields. A placeholder-only fragment (ySync writes one empty paragraph on bind; `fragmentHasRealContent` tells it apart from real content) is rebuilt from `Y.Text`; a fragment with real but DIFFERENT content (Markdown mode edited `Y.Text` while the fragment kept old blocks) is also rebuilt - compared serialize-normalized, because markdown dialect drift makes raw string compare useless. The divergence rebuild is a SOLO-CLIENT self-heal only: with a live peer in awareness the fragment is the current CRDT state (their in-flight keystrokes; `Y.Text` trails by the mirror debounce), so rebuilding would broadcast a revert of their edits and the seed skips it. Empty `Y.Text` never wins over fragment content. Rebuilds are one `HYDRATION_ORIGIN` transaction via `replaceProsemirrorFragment`. StrictMode-cancelled Crepe instances must have their ySync binding muted (`muteSyncBinding`) or a zombie view observing the shared fragment throws mid-transact and wedges the mirror gate.
- `RealtimeStatusBadge` derives Live / Syncing / Offline from the multiplexer's outbound-pending state; there is no server ack, so no literal "Saved" claim. The pending flag itself is per-keystroke honest (a send leaves a non-zero `bufferedAmount` that the 250ms drain poll clears), so the badge consumes it through `useOutboundSyncing` -> `createPendingHysteresis`: Syncing appears only after the backlog survives 1.2s and then stays up at least 800ms. Binding a label straight to `isOutboundPending` makes it strobe on every character.
- Markdown + readonly view modes consume `Y.Text` live via `useRealtimeMarkdownContent(ydoc, fallback, {whenSynced, debounceMs})`. Without this, switching modes renders an empty editor while the YDoc holds current content.
- Crepe `Feature.History` is NOT a `CrepeFeature` and currently coexists with `yUndoPlugin` (acceptable v1 known gap; revisit if double-undo is observed).

Canvas:
- Y types: `Y.Map nodes` (id -> Y.Map { id, type, position, width, height, data: Y.Map }), `Y.Array order` (z-order), `Y.Map edges` (id -> flat Y.Map { source, target, sourceHandle, targetHandle, type, data }), `Y.Map defaults`.
- Per-node text fields live as `Y.Text` inside the node's `data` Y.Map. Source of truth: `NODE_TEXT_FIELDS = { text: 'content', shape: 'label', mindmap: 'label' }` in `canvasBinding.ts`; mirror on the Python side in `_NODE_TEXT_FIELDS` (`realtime_adapter.py`). Keep them in lockstep.
- Text edits go through `writeNodeTextDiff` which diffs against a per-`${nodeId}:${field}` local snapshot (`localTextSnapshotsRef`) and applies a minimal delete+insert delta inside `ydoc.transact(sessionId)`. Diffing against the post-merge view destroys concurrent peer inserts - diff against the user's last local string.
- `mutateNodeYMap` skips text fields. A structural write (drag / style / position) overwriting an in-flight `Y.Text` clobbers character edits.
- Drag commit uses the existing 300ms `scheduleChange` debounce -> one `ydoc.transact(sessionId)` at the end so undo pops to pre-drag.
- Pointer awareness throttled at 30ms, flow coords via `useReactFlow().flowToScreenPosition`. Awareness payload also carries `selection: string[]`.

Peer paint:
- The awareness `user` payload carries identity only (`id`, `name`, `avatarUrl`, `hasAvatar`) - **no colors on the wire.** Every client derives paint locally with `identityPaint(name)` / `identityStops(name)` (`config/theme/brandGradients.ts`), the same name hash and the same Unity Violet -> Belonging Pink pairs the avatars use, so a person's caret, canvas pointer, label and avatar are one identity everywhere. Sending a color instead lets two surfaces disagree the moment one of them defaults.
- A viewer's accent color must not feed peer paint: accent themes that viewer's own chrome, while identity has to look the same to everyone in the doc.

---

## 10. Origin tagging discipline

Every local mutation tags with the session id. Three origins, three behaviors:

| Origin | Source | Tracked by UndoManager? | Persisted to IDB? |
|---|---|---|---|
| `sessionId` (uuid per useDocSession mount) | Primary local edits (incl. Markdown-mode Y.Text writes) | yes | yes |
| `REMOTE_ORIGIN` (Symbol) | Server-pushed updates, applied by the multiplexer | no | no |
| `HYDRATION_ORIGIN` (Symbol) | Cold-start seed / IDB replay / fragment rebuilds | no | no |
| `MARKDOWN_MIRROR_ORIGIN` (Symbol) | Editor's PM to Y.Text mirror (regenerated every session) | no | no |

The origins are Symbols exported from `encryptedYjsPersistence.ts`; string literals like `'hydration'` do NOT match the IDB filter and must not be used as transact origins.

`Y.UndoManager` is created with `trackedOrigins: new Set([sessionId])` so users undo only their own edits. The IDB write path filters by these constants - if you add a new origin and forget to filter, peer updates re-enter the local update path on cold start.

Origin-replica dedup (backend): every fanout payload carries `origin_replica_id` (set once per process at boot in `core/realtime/identity.py`). The router drops messages whose origin matches its own replica id. Publishing peer updates back out of the manager creates a loop - `apply_local_update` publishes, `_apply_remote_pubsub_update` does not.

---

## 11. Common pitfalls

- **Importing `core/realtime` from inside `domains/*` is fine; the reverse breaks the layering.** The root Import Linter contract checks every backend module and rejects a direct `core -> domains` import. If core needs domain behavior, extend the adapter contract and wire the implementation explicitly at the web and worker roots.
- **A fresh Valkey `subscribe_*` task for any new realtime fanout regresses the scale collapse** - extend `RealtimeRouter` instead, or the connection count grows from 9 back to thousands.
- **Touching `state.py` shapes means checking `router.py` + `ydoc_manager.py` + `snapshot.py` + `session.py` + `ws_routes.py`** - they all consume the dataclasses directly. The split is intentional to break cycles, not because the data has multiple owners.
- **Adding a y-prosemirror plugin or a Milkdown listener that reads document content?** Verify it fires for `ySync`-driven PM transactions. The default Milkdown `markdownUpdated` listener does not. A `$prose` plugin that hooks `view.update` is a better fit for universal observation.
- **Schema migrations:** the snapshot table key is `(content_type, content_id)`. Other domains plug in without touching the schema - per-domain columns tend to drift. Notes-specific things (version bump, outgoing_references, inline tags, search reindex) live in `NoteOperations.realtime_save` rather than in `core/realtime/*`.
- **Snapshot job IDs hash the payload bytes (not just the key)** - see §7. Static `_job_id`s freeze persistence for `WORKER_KEEP_RESULT` seconds.
- **Vite dev proxy** has `'/api/realtime'` configured with `ws: true` ahead of the generic `'/api'` entry. The order matters.
- **Mobile (Expo) client** ships its own port of the multiplexed transport: generic layer in `src/mobile/src/shared/realtime/` (`multiplex.ts` byte-compatible framing via lib0 string helpers, `multiplexer.ts`, `useDocSession.ts`), notes wiring in `src/mobile/src/features/notes/realtime/`. Deltas from the web: the bearer rides the `Authorization` header (NOT the subprotocol; `extract_bearer_from_auth_header` server-side), org id is passed into `attach()` from the auth context, AppState/NetInfo replace the window listeners, and there is no IDB persistence, no UndoManager, and no caret broadcast (presence identity only). The editor binding (`useNoteCoEditing.ts`) diffs local edits against the user's LAST LOCAL canonical string (never the merged view) and applies remote merges to the `TextInput` only while the user is idle. The legacy `UpdateNote` autosave survives ONLY as the unsynced/offline fallback - once a session syncs, realtime owns content for the rest of the mount, and running both would double-write (server graft + CRDT replay). `lib0/webcrypto` is shimmed in `metro.config.js` (its react-native entry needs isomorphic-webcrypto, whose native deps would force a dev-client rebuild).
