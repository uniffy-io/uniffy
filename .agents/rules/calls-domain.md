---
paths:
  - "src/uniffy/domains/calls/**/*.py"
  - "src/uniffy/core/models/calls/**/*.py"
  - "src/uniffy/domains/calls/jobs/**/*.py"
  - "src/proto/calls/**/*.proto"
  - "src/ui/src/features/calls/**/*.ts"
  - "src/ui/src/features/calls/**/*.tsx"
---

# Calls Domain: Voice/Video in Chat Channels

Real-time audio/video sessions attached to a chat channel, powered by a self-hosted LiveKit SFU. A
call is a property of its channel, not standalone content - it has no URN and no `access_mode`.

## Access rides chat membership

Calls authorize through `ChatAccessChecker` (`domains/chat/access.py`), never the content permission
system. PUBLIC channels are open to the org; other channel types require membership. A user can be an
active participant WITHOUT a `ChatChannelMember` row (an org member joining a PUBLIC channel, or an
admin moderating), so the `CallParticipant` rows - not channel-member rows - are the truth for "who is
in the call." Any recipient/visibility set that keys off channel members must also union active
participants, or those users go blind to their own call.

## Media transport

Signaling rides a WebSocket to LiveKit (`ws_url`: an edge path the client resolves against
`window.location`, or an absolute `ws(s)://` override for split-origin). Media and TURN go over UDP.
In direct-media deployments (VM/compose, embedded TURN) they are negotiated by LiveKit and the
join-shaped responses carry no ICE config. In relayed deployments (k8s/STUNner, `TURN_SERVER_URLS`
set) join-shaped responses also carry `ice_servers` (per-user ephemeral TURN credentials, TURN REST
spec: `username = "{expiry}:{user_id}"`, `credential = base64(HMAC-SHA1(shared_secret, username))`,
minted in `domains/calls/turn.py`) plus `ice_transport_policy = RELAY`. Credentials cannot rotate
mid-connection, so the TTL (default 8h) must outlive the longest call; every reconnect issues a
fresh JoinCall and therefore fresh credentials - `RefreshCallToken` stays token-only. Join-shaped
RPCs return `ws_url` + a single-room-scoped `livekit_token` (short-lived user token; admin actions
mint a separate tiny-TTL room-scoped token with no admin grants). The org id prefixes the room name
as a cross-org isolation defense inside the shared SFU.

## Durability model (load-bearing)

Postgres is the source of truth. LiveKit webhooks are hints - at-least-once and out of order. The
reconciler cron (`domains/calls/jobs/jobs.py`) is the guarantee that DB state converges to SFU truth. So:
every webhook handler re-reads DB state and is idempotent; terminal lifecycle writes are compare-and-set
guarded (the domain session runs `expire_on_commit=False`, so an in-memory `ended_at`/`left_at` check is
stale across concurrent handlers); tab-close sends a keepalive leave beacon with the `participant_left`
webhook as the fallback. Never treat a single webhook or stream event as authoritative on its own.

## Webhooks are server-to-server, not from the browser

LiveKit POSTs events to the backend at `/internal/webhooks/livekit` (`core/webhooks/router.py`,
processor in `domains/calls/webhook.py`), authenticated by a LiveKit-signed JWT carrying a body-hash
claim. The signature is the gate; network placement is defense-in-depth (the route is not proxied by the
edge). Self-hosters MUST make the backend reachable from their LiveKit instance and keep the shared
`api_key`/secret matched on both sides, or presence silently breaks.

## Media state (mic/camera/screen) is client-reported

LiveKit emits NO mute webhook and a muted mic stays published, so roster media flags cannot be inferred
server-side. The client is the source of truth: it reports its own mic/camera/screen via a dedicated RPC
that fans the change out to the channel. In-call tiles read live SDK state; snapshot surfaces
(`GetActiveCall`/`ListActiveCalls`, sidebar roster, a late joiner's first paint) read the DB flags the
client last reported. Do not reintroduce webhook-driven mute inference.

## Frontend shape

`CallProvider` (`features/calls/components/CallProvider.tsx`) mounts once near the app root and wraps
every route including `/auth`, so it never unmounts. It owns the LiveKit `Room`, the bounded rejoin
loop, token refresh, and continuity across refresh/reconnect. Because it never unmounts, teardown on
identity change (logout) and org switch is EXPLICIT via effects - not unmount-driven; a room left
connected keeps transmitting the mic behind stale UI. `CallDock` renders the global chrome (bottom
strip, pre-join, ringing toasts, room audio). `CALL_*` events arrive over the chat user-stream
(`ChatStreamProvider`); a stream reconnect resyncs indicator state via `ListActiveCalls`, so that
snapshot must include every call the user can actually see.

## Mobile background audio

Backgrounding a call disables the camera and keeps the room connected and the microphone publishing.
Android enforces that with a foreground service: a backgrounded app loses microphone capture unless a
service of type `microphone` is running, and the failure is silent - inbound audio keeps playing and
the UI shows no error while the remote side hears nothing. The local `call-foreground-service` Expo
module (`src/mobile/modules/`) owns that service and the `FOREGROUND_SERVICE_MICROPHONE` permission.

`RECORD_AUDIO` is a while-in-use permission, so the service can only START while the app is still
foregrounded. It is therefore driven from `startCallAudio`/`stopCallAudio` in
`features/calls/livekit.native.ts`, which sit on the connect and teardown paths - never from the
`AppState` background handler, which runs too late. iOS needs no equivalent: `UIBackgroundModes:
["audio"]` plus the active audio session already keep the microphone alive.

Neither LiveKit's Expo plugin nor `@config-plugins/react-native-webrtc` supplies a service, and
`expo-audio`'s `mediaPlayback` service does not cover microphone capture. Ringing while the app is
killed is out of scope on both platforms - it needs push infrastructure the repo does not have.

## Two product targets

Self-hosted customers run their own LiveKit (embedded TURN), point its `webhook.urls` at their backend,
and share the `api_key`/secret. Cloud runs the same code against a shared LiveKit deployment. Keep
cloud-only assumptions out; every call path must work on a single-org self-hosted deploy with LiveKit
configured, and degrade cleanly (no crash, features gated off) when LiveKit is NOT configured.

## Scope and limits

Calls-only for now - no AI participants. The SFU is a single media node by construction (the dev config
pins node-ip and host ports); real multi-node media scaling is deferred to the cloud fleet-controller
path. LiveKit's coordination registry shares the app's Valkey instance.

## Key files

| File | Purpose |
|------|---------|
| `src/proto/calls/v1/calls.proto` | `CallService` contract (source of truth; run `./manage.py proto` after edits) |
| `src/uniffy/domains/calls/operations.py` | Call lifecycle business logic + fanout |
| `src/uniffy/domains/calls/handlers.py` | Thin ConnectRPC handlers |
| `src/uniffy/domains/calls/webhook.py` | LiveKit webhook processor (join eviction, leave/abort, room-ended) |
| `src/uniffy/domains/calls/tokens.py` | LiveKit token minting + webhook verification |
| `src/uniffy/domains/calls/jobs/jobs.py` | Reconciler + orphan-room cron (the durability backstop) |
| `src/uniffy/core/models/calls/call.py` | `Call` + `CallParticipant` models |
| `src/ui/src/features/calls/components/CallProvider.tsx` | Global Room owner, rejoin, teardown |
| `src/mobile/src/features/calls/livekit.native.ts` | Native LiveKit glue: audio session + mic foreground service |
| `src/mobile/modules/call-foreground-service/` | Local Expo module: Android `microphone` foreground service |
| `.docker/compose/core.yaml` | LiveKit service + `webhook.urls`/keys config |
