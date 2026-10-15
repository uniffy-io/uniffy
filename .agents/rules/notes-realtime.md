---
paths:
  - "src/uniffy/core/realtime/**/*.py"
  - "src/uniffy/core/models/realtime/**/*.py"
  - "src/uniffy/domains/projects/**/realtime.py"
  - "src/uniffy/domains/scheduling/calendar/**/realtime.py"
  - "src/ui/src/components/editor/CrepeEditor.tsx"
  - "src/ui/src/components/editor/ExpandableEditor.tsx"
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

# Notes Domain and Realtime Collaboration

## Authority and ownership

NOTE, TASK and CALENDAR_EVENT share `core/realtime/`. Domain adapters live in
`domains/notes/adapter.py`, `domains/projects/realtime.py` and
`domains/scheduling/calendar/realtime.py`. Core never imports domains. Web and worker composition
roots register adapters explicitly. `state.py` owns shared document and connection dataclasses.

PostgreSQL `realtime_yjs_snapshots` is authoritative for accepted CRDT bytes. Its composite key is
`(content_type, content_id)`. The row carries organization, generation, accepted revision, rendered
revision, last editor and fragment seed lease. A replica's in-memory Y.Doc is a cache.

`storage.lock_document` serializes mutations using a PostgreSQL transaction advisory lock. A task
or calendar override also takes a shared lock on its policy parent. Parent deletion takes an
exclusive lock. Plain-write merges, replacements, realtime acceptance, projection and deletion
must use compatible ordering. Acquire multiple document locks in deterministic order.

`stage_seed` hydrates and persists one shared Y.Doc baseline under that lock. A random generation
is stored both in the snapshot column and `doc_meta.generation`. Existing snapshots retain their
encoded generation, including the empty marker for historical snapshots. Independent replicas must
never invent independent CRDT baselines for the same generation.

`accept_update` resolves edit access from PostgreSQL while holding the document lock, validates
generation and merges encoded bytes with `pycrdt.merge_updates`. Merging raw updates preserves
causal dependencies that have not arrived yet. Re-encoding only the visible Y.Doc can discard those
pending bytes. Commit precedes acknowledgment and fanout. Duplicate updates do not advance revision.

## Wire and transport

One WebSocket per tab or mobile app carries every attached document:

```text
/api/realtime?org_id=<uuid>
[VarString docName][message bytes]
docName = <CONTENT_TYPE>:<uuid>
```

`multiplex.py` and client `multiplex.ts` own byte-compatible envelope encoding. Keep lib0 varint and
string behavior. `doc_name_for` and client `docNameFor` own names.

| Type | Payload and meaning |
|---|---|
| 0 | y-protocols synchronization. SyncStep1 requests current state. Server SyncStep2 supplies it. |
| 1 | Awareness update. |
| 2 | Document auth denial: scope 0 means read-only, scope 1 means no view access, followed by reason. |
| 3 | Awareness query. Live peers re-announce their own state. |
| 4 | Fragment seed role: varuint 1 granted or 0 revoked, followed by optional lease-token string. |
| 5 | Authoritative generation string. Sent before document synchronization. |
| 6 | Generation string, update ID string and update bytes. Client durable write. |
| 7 | Update ID string. Server acknowledgment of committed bytes. |
| 8 | Generation, request ID, lease token, source Markdown strings, then update bytes. Isolated fragment seed proposal. |
| 9 | Request ID string. Seed proposal rejected without changing authoritative state. |
| 10 | One byte: 1 advertises rich fragment seeding capability; 0 withdraws it. |

Untagged client SyncStep2 and SyncUpdate writes are rejected at document scope. Clients send writes
through type 6, including replies derived from sync handshakes. Read-only entries retain draft state
but suppress writes. Untagged clients require an application update. Deployment must coordinate
backend, workers, web and mobile protocol support; schema migration precedes writers.

Both multiplexers retain unacknowledged updates, including delete-only changes, and resend them on
reconnect. Only an exact type-7 ID removes a pending update. Socket buffering is not durability.
Local update bytes batch per document for 250 ms from the first edit. Later typing does not reset
the deadline. Observer transactions stay together, including rich Markdown mirrors. Buffered edits
count as pending immediately; an older ACK cannot clear them. At 64 KiB, backgrounding or detach,
flush early. Separate previous transaction chains before a new chain would exceed the frame budget.
Sync replies absorb buffered bytes and cancel their separate timer. Authentication teardown cancels
timers and observers. Generation and permission gates still suppress writes. Local recovery writes
remain independent of network batching. This bounds ordinary typing frames per client, not total
writes across all editors; seed, sync and lifecycle frames can send outside the timer.
Generation mismatch stops replay into the active document and creates a fresh session while keeping
the incompatible draft recoverable. Ignore incoming synchronization until generation is known.

Every socket callback and asynchronous Blob decode checks socket identity before mutating shared
transport state. Old callbacks must not clear a replacement socket or its timers.

Transport owns exponential reconnect, periodic 30-second resync, 15-second awareness keepalive and
30-second idle close. Web listens for online/offline, visibility and auth refresh/revoke events.
Mobile uses AppState and connectivity listeners. Disconnect removes remote awareness so offline
mirror ownership can settle locally. Detach sends awareness removal where possible.

Web closes 4401 and 4409 enter refresh with exponential backoff and a five-attempt cap. No socket
opens without an access token. Retry or returning online resets the cap. Temporary refresh errors
retain credentials; startup offers Retry. Authentication rejection remains a sign-out condition.
Refresh and organization switch share a cross-tab lock: Web Locks on secure origins, an IndexedDB
transaction otherwise. Read the refresh token after acquiring the lock, persist rotated credentials
before releasing it, and ignore responses superseded by another login. Dedicated `uniffy:auth`
storage excludes access tokens and cannot be overwritten by unrelated redux-persist writes.
Same-session storage events update refresh credentials. Other-session or organization changes retire
the old tab's auth and sockets. Reconnect reads the current Redux organization, including idle sockets.

One process-wide `RealtimeRouter` subscribes to document, permission, defaults and auth signals.
Never create a Valkey subscription per document or user. Replica IDs deduplicate self-origin fanout.
Document updates and replacement payloads are reload hints, not authority: reload PostgreSQL state.
Periodic synchronization catches missed fanout. Publisher reconnect retries after a missing client.

Outbound queues retain at most 1024 frames and 8 MiB per socket. Incoming frames remain capped at
1 MiB. Seed source text uses that frame limit; the 4 KiB string limit applies to document names and
small identifiers. Malformed durable updates receive a document-scoped denial, without closing
unrelated document sessions. Generation conflicts send authoritative generation/state to their sender.
Every SyncStep1 repeats generation so dropped generation frames recover.

Local accepted writes reuse the committed snapshot returned by storage. Resident revisions skip
unchanged fanout; changed state sends Yjs deltas, including delete sets and unresolved structs.
Projection compacts deleted content without discarding pending causal structs. Initialized fragments
skip seed-election database work. PostgreSQL authorization still gates each disclosure and mutation.
Snapshot merge/reload and permission checks remain capacity costs. Measure before expanding fanout.
Optional publish and projection scheduling run in supervised, coalesced tasks after commit. They do
not delay durable ACKs. Failures leave PostgreSQL recovery facts pending.

An unanswered synchronization request reconnects after ten seconds. Both clients budget encoded
frames and pending bytes before sending. Oversized edits stop at document scope with retained
drafts and visible rejection. They must not enter an automatic retry loop.

Deployment limits use REALTIME_MAX_DOCUMENT_BYTES (524288), REALTIME_MAX_SNAPSHOT_BYTES (8388608),
REALTIME_MAX_DOCS_PER_SOCKET (32), REALTIME_MAX_SOCKETS_PER_USER (16 per backend process), and
REALTIME_MAX_MESSAGES_PER_SECOND (120). Awareness has a 64 KiB cap. Awareness identity comes from
the authenticated account. A connection publishes only its own awareness client ID.
Socket admission reserves capacity before awaiting acceptance and releases it on every exit,
including failed acceptance and cancellation. The counter is per global user, across organizations.

## Authorization

The permission model is defined in `permissions.md`. Active organization membership and live
content access are required. Tasks inherit a live project policy. Calendar overrides retain the
master's private-detail floor while resolving addressed-row grants and attendees. Recurring masters
and synthetic occurrences do not attach.

Upgrade validates Origin, access-token type, token organization, user and session revocation facts,
and active membership. Web passes bearer in `Sec-WebSocket-Protocol` alongside
`uniffy.realtime.v1`; server echoes only that canonical protocol. Mobile can pass Authorization.
Never echo bearer data through the selected protocol.
`core/auth/revocation.py` reads account status/token version and session ownership/revocation from
PostgreSQL in one fresh query. RPC and asset authentication use the same check. Valkey markers are
not evidence of validity. Missing or revoked session rows deny access; database failures produce
retryable unavailable responses. Live sockets repeat the durable check through their watchdog.

Fresh PostgreSQL authorization runs at inbound document handling, durable mutation and outbound
disclosure. Scalar statement structures are reused with bound actor, resource and check-time values.
Outbound frames and content hints coalesce waiting recipients into fresh batches of at most 256
requests, with eight concurrent batches and 4096 pending recipients per process and delivery class.
Each batch seals before database I/O. Later requests start a separate read, even while an earlier
read is running. Results are never retained across disclosures. Notes and tasks select policy fields
without content blobs; calendar batches retain addressed-row attendees, blocks and master privacy.
Periodic watchdog checks connection lifetime and document permissions. Expiry and lost
PubSub must not leave cached `can_edit` as authority. Close database contexts before seed-election
work opens another one, to avoid connection-pool starvation.

Document denial detaches only that handle and tombstones its subscription. Other documents on the
socket continue. Read-only downgrade suppresses writes and updates editor affordances on web and
mobile. Both retain rejected drafts. Connection-wide failures still close the socket.

Transient authorization failures stop disclosure and close the connection for retry. Never turn
an infrastructure exception into a permanent document denial or continue using a cached allow.

Close codes: 1009 unidentifiable oversized frame; 1013 rate/connection/slow-consumer limits;
4401 invalid token; 4403 connection forbidden; 4409 refresh required; 4410 token revoked.
4404 and 4408 remain reserved client compatibility constants. Keep 4409 and 4410 distinct: expiry
refreshes and reconnects, revocation stops until app authentication changes. Socket lifetime is
bounded even without content attached. Inbound, outbound and watchdog tasks supervise each other;
any task failure retires the connection.

## Projection and replacement

`SnapshotWriter` schedules domain projection after a 5-second debounce capped at 30 seconds.
Queued snapshot bytes and encode timestamps are hints only. `persist_snapshot` loads the current
committed snapshot under the document lock, calls adapter `stage_render`, then commits domain
columns and `rendered_revision` together. Timestamp last-writer-wins is not safe for CRDT state.
Metadata timestamps never supersede content revisions.

Adapters stage domain changes without hidden commits. Notes render markdown/canvas, outgoing
references and inline tags. Tasks render descriptions/references and advance version. Calendar
renders description/references without advancing `ical_sequence`. Missing targets remove snapshot
state. Trashed notes return `DeferredProjection.SOFT_DELETED`: retain accepted bytes and pending
revision without writing content or effects. Restore takes the document lock; subsequent projection
renders retained edits. Hard purge removes note snapshots. Projection stages original mention events
in `notification_outbox` in the domain transaction, attributed to last editor or owner fallback.
Shared-note content edits also stage events; changed calendar descriptions stage activity once.
Snapshot `effects_pending` commits alongside rendered revision. After commit, search and preview
hints run under the document lock against freshly loaded domain state. Failure leaves the flag for
recovery, without recreating mention deltas or activity. In-app rows deduplicate by event/user;
email uses its delivery outbox. Browser push remains at-least-once with an event-specific tag.

Notification recovery rotates bounded batches every ten seconds and deletes an outbox record only
after successful processing. Inline attachment reconciliation is staged for note/task/event live
projection and ordinary task/event description writes. Its minute sweep takes the document lock,
waits for pending projection and checks current references before removing unreferenced inline
uploads. Picked file copies remain attached. Fresh inline uploads get a 24-hour grace period before
unreferenced cleanup; deferred work remains queued. Trashed notes wait for restore. Deleted tasks
and events have no restore path and retire reconciliation rows. Unchanged projections do not bump
content versions, timestamps or notifications. Edit notifications coalesce per content/actor for ten minutes.

A minute recovery job scans a bounded batch of pending revisions or `effects_pending` rows. It selects
metadata with row locks and skips locked rows, advances `updated_at`, then commits before rendering.
This rotates failed or deferred rows behind unattempted work without changing revisions or bytes.
It repairs projection after queue loss, worker failure or failed rendering. Failed forced eviction
re-arms the dirty session; never remove its only resident recovery attempt on failure. Accepted bytes remain
safe in PostgreSQL even if queueing or process shutdown fails.

Inline tag names longer than the tag model's limit remain literal document text and create no tag
or assignment. Invalid markers must not roll back accepted content projection. Other projection
failures preserve the pending revision for retry.

A plain markdown write (task or event description, note content) onto a document with a snapshot
row merges into the live generation through `stage_text_merge`. Under the document lock it
three-way merges the column text the writer saw, the current Y.Text (accepted but unprojected
edits included) and the submitted text: live edits outside the writer's changed regions survive,
live-only text is never deleted, overlapping changes keep both. The merged text is grafted into
Y.Text with minimal edits and `markdown_mirror.active=false`, the graft bytes merge into the
snapshot, revision advances with `rendered_revision = revision`, `actor_id` is the writer, and the
domain column stores the merged text in the same transaction. `publish_content_replace` after
commit makes resident replicas reload the same generation. Callers return the merged row, so
indexing, references, mentions and inline tags run on it. Same-generation client updates stay
valid afterwards. Without a snapshot row the column write stands and a cold open hydrates from it.
Above 256 KB, diff work uses common prefix/suffix bounds. Concurrent inserted text still survives,
and unchanged CRDT items keep identity. A write with no concurrent change uses submitted text.

`stage_replacement` mints a fresh generation from the domain columns in one transaction under the
same document lock; canvas content uses it. Publishing after commit wakes caches. Stale clients
cannot replay old-generation bytes into that replacement. Notes given `expected_content_version`
reject a content write while accepted realtime revision has not reached the domain column yet;
`UpdateNoteRequest` carries the field and the agent tool always sends it. Metadata-only writes
retain generation and graft nothing. Deletion follows the same locks. Note trash retains snapshot
state until restore or hard purge.

## Web persistence and lifecycle

`features/realtime/hooks/useDocSession.ts` owns Y.Doc, awareness, local recovery and attachment.
`whenSynced` waits for server synchronization and local hydration. Rich and Markdown editors remain
read-only until their binding is initialized. Never seed from a placeholder before this gate.

Encrypted IDB uses database `uniffy-realtime-yjs`, version 3, with
`[contentType, contentId, generation, seq]` rows. Schema upgrades preserve prior rows. Storage key
rotation follows the existing encryption lifecycle. Recovery requires initialized Web Crypto;
plain HTTP on host.docker.internal cannot validate encrypted recovery.

Primary local edits persist a full encoded document with causal base. Writes coalesce while storage
is busy and replace preceding rows from the same epoch. Other tabs retain their own rows. Each row
keeps its generation and encrypted user/organization/document scope.
Online hydration merges only matching generations. Offline hydration merges a single known lineage;
ambiguous lineages wait for server identity. Retry hydration against authoritative generation before
opening editing. Mismatched rows remain available through recovered-draft UI, including raw update
export. Never delete an incompatible draft just because it cannot be replayed automatically.

Compaction, unload and disposal await pending writes. A fresh attachment waits for preceding disposal.
Clean-close removal requires completed hydration, server sync, connected transport and no pending
acknowledgments. A session ended by a generation mismatch or a document denial is never a clean
close, and any close code leaves the hook's transport status not connected until the next
`connected`. Remove only rows written or hydrated by that session in its generation. Unseen rows
from another tab remain untouched. Per-row decrypt failure skips that row without clearing others.
A session that made no local update and hydrated no row writes nothing on close.

Each row payload carries `dirty`: a persisted-origin transaction changed the content projection
(Y.Text plus non-empty fragment blocks, or any non-metadata root). Seed, duplicate cleanup, mirror
and markdown-to-rich rebuild writes never set it; neither do editor normalizations. An acknowledged
close compacts with `dirty=false`, so the row is a cache. `readRecoveredDrafts` lists a generation
only when a row decrypts, one row is dirty and the text is non-empty; Discard deletes that
generation's rows. First DEK generation wipes the registered databases, so undecryptable rows never
accumulate. Sign-out scans durable dirty rows before key teardown and rechecks live pending edits after the
scan. Startup discovery rebuilds the drain registry from stored scope. Local user writes mark rows
dirty without consulting transport listener order. ACK compaction explicitly clears the marker.
Registered databases close and await pending writes before deletion; blocked deletion is an error.
Sign-out returns blocked while pending edits exist; callers confirm before `teardownStorageEncryption`. The Offline chip promises
device persistence only while `isStorageEncryptionReady()`.

`useMarkdownDocSession` supplies identity awareness, rich-editor undo and read-only transport state.
Pending writes feed drain/unload guards without a transient syncing badge. Healthy editor chrome
stays quiet. `RealtimeSessionStatus` shows presence, exceptional status and recoverable drafts at
phone widths too. No-view denial says Access lost; edit-only denial says View-only. Recurring event
masters explain that descriptions save on Done after scope selection.

`ExpandableEditor` owns realtime while expanded and during pending/offline drain after Done. Its
host must suppress full-string RPC content writes once realtime owns the session. Task/calendar
preview slices remember superseded visible strings to avoid reverting on stale metadata responses;
an equal or unseen peer value releases protection. This is text-based reconciliation, not a server
revision watermark. Recurring masters and synthetic occurrences keep scoped ordinary updates.
A generation change keeps the overlay on the new session with a quiet inline notice; it never
flashes the open-time text under "Connecting...".

`pendingDocs.ts` keeps a localStorage registry written after successful dirty storage writes (content
type, id, organization, user, discard policy). `drain.ts` attaches a headless Y.Doc per entry
without presence, hydrates from IDB, lets the durable path send, waits for acknowledgments, then
closes like a session (`acknowledged`, discard per policy) and drops the entry. A write denial or
generation mismatch drops the entry and keeps the rows as a draft; a connection-level close keeps
the entry for the next trigger. `useRealtimeDrain` (mounted in `ProtectedRoute`) kicks on mount,
`online`, auth refresh, encryption ready and registry changes, and skips docs an editor holds. Opening an editor cancels its drain before attaching and waits
for prior persistence disposal.
Hosts show "Will sync when online" while a doc is pending after Done or sits in the registry.
`useUnloadGuard` runs while a doc is pending or the registry is non-empty.

## Text bindings and seeding

`CrepeEditor` binds y-prosemirror, cursor and undo plugins to the shared fragment. Each rich writer
mirrors its local fragment mutations synchronously. Transport batches all observer transactions
into one durable frame, so acknowledged rich edits include their Markdown projection even if that
writer disappears. The lowest eligible awareness ID reconciles external changes and idle mirrors.
Mirror writes set `markdown_mirror.active=true`; text clients set it false. This flag is only a
cold-start hint. Live classification uses transaction origins and never the shared boolean.

`MarkdownReconciler` keeps the pre-event text while external changes await projection. The leader
merges serialized pending rich edits with the current external text before updating the fragment.
Queued work reads the latest text, and close/pagehide flush reconciles synchronously. Projection
uses y-prosemirror's incremental update without deleting the fragment first, preserving unchanged
nodes and relative cursor positions. Projection sets the mirror marker atomically. External text changes preserve their pre-event base
regardless of the resolved flag. Local rich changes mirror synchronously; reconciliation has a
two-second maximum delay and leave flush is synchronous. Bounded diff preserves both insertions.

Cold start (`resolveColdStartFragment`): an empty fragment seeds from Y.Text; `active=true` or a
serializer-equal fragment keeps; `active=false` rebuilds the fragment from Y.Text regardless of
peers; an unset flag keeps the fragment even before peer awareness arrives. A peer is rich only
while its awareness state carries `markdownEditor`. The decision runs before `markdownMirrorReady`
flips, so the first mirror flush never serializes an unreconciled fragment.

MarkdownSplitEditor uses synchronous CodeMirror transaction ranges and immediate Y.Text deltas.
Only preview rendering is debounced. Never compare a stale full editor string with an already
merged Y.Text and treat peer inserts as local deletions.

An idle mirror flush compares parsed/serialized content and leaves equivalent Markdown source
untouched. Rich edits can normalize Markdown syntax. Editor schemas preserve list start numbers,
literal HTML breaks, leading paragraph spaces, YAML/TOML front matter, image alt and caption.
Image size uses `<!--uniffy:image-ratio=...-->`; numeric alt from existing documents still supplies
size without deleting alt text. Front matter is captured before image transforms discard positions.
Only deliberate rich typing converts `#name` to a tag; imported source needs the canonical tag marker.
Serialization removes trailing empty editor paragraphs and its single document terminator. A cleared
document serializes empty, while explicit HTML breaks and code literals remain. Done flushes before
teardown. Dispose observers synchronously, mute cancelled bindings and clear queued Milkdown callbacks
before context destruction.

Fragment initialization uses a PostgreSQL seed lease shared by replicas. Only clients advertising
seed capability enter election; mobile, Markdown and drains never claim leases. A rich editor
stops initialization after sixty seconds and offers Retry while retaining read-only content. Peers cannot extend a
suspended owner's lease by polling. Server timer retries election at lease expiry without waiting
for client traffic. Release removes handles before optional database election; election failure
cannot interrupt other handle cleanup. Waiting editors explain initialization and remain read-only.

Web builds each seed proposal in an isolated Y.Doc. Type 8 carries the lease token and source text.
Under the document lock, acceptance checks generation, edit access, owner, token, expiry, unchanged
source text, an empty prior fragment and a resolved seed claim. Proposal cannot mutate source text.
Commit precedes type-7 acknowledgment. Rejection uses type 9 and retries against current state without
inserting speculative blocks into the live document. A committed no-op replay remains idempotent.

Seed metadata records client ID, original top-level clocks and SHA-256 hashes of original content.
Duplicate checks also understand stored raw content from earlier snapshots. Duplicate cleanup
may remove only an unchanged original seed block. User edits inside that block must survive.
Type-6 writes introducing a seed claim are rejected with `seed_conflict`. Web quarantines that full
mixed draft into a `recovery:` lineage before starting a fresh authoritative session. Recovery
lineages never hydrate automatically, including offline. Failed encrypted storage retains a
user-scoped in-memory copy for the current tab. Restore keeps the source until explicit Discard.
Backend and web seed protocol support must deploy together; existing tabs need the updated bundle.

Origin rules:

| Origin | Undo | Encrypted web persistence |
|---|---|---|
| session ID | yes | yes |
| REMOTE_ORIGIN | no | no |
| HYDRATION_ORIGIN | no | no |
| MARKDOWN_MIRROR_ORIGIN | no | no |

These are shared Symbols where specified, never same-spelling strings. Rebuilt fragment/mirror state
is derived; primary edits must retain causal source in recovery. UndoManager tracks local session
origins only.

## Canvas

Canvas uses Y.Map nodes, Y.Array order, Y.Map edges and Y.Map defaults. Node data text fields use
Y.Text. Keep backend `_NODE_TEXT_FIELDS` and client `NODE_TEXT_FIELDS` aligned. Text mutations diff
against last local input, never against a merged peer view. Structural node changes skip text fields.
Pointer awareness is throttled and uses flow coordinates. Awareness carries identity only; clients
calculate peer paint through shared identity color utilities.

## Mobile

Generic transport and lifecycle live in `src/mobile/src/shared/realtime/`; note bindings live in
`features/notes/realtime/`. Mobile has no web UndoManager or caret broadcasting. `lib0/webcrypto`
uses its Metro shim. Keep wire behavior, generation checks, ACK handling and document denial aligned
with web.

Draft payloads use AES-256-GCM ciphertext in per-user Expo SQLite databases. SecureStore holds the
device-only key. AAD binds user/organization/document key, record ID and generation. Fresh nonces come
from expo-crypto. WAL and FULL synchronous commits publish a replacement and retire its predecessors
in one transaction. Per-user transaction serialization also bounds concurrent document writers.
SecureStore chunked drafts stay readable. A same-generation save merges readable source bytes, commits
the encrypted replacement, then retires old chunk records. Unreadable chunks and ciphertext remain
recoverable records; a missing key never silently resets a populated database.
Same-generation saves merge prior raw bytes before
replacing records, even if current session has not hydrated. Serialize recovery reads with writes
so a writer cannot remove chunks under an active reader. Failed reads retain source records.
Other generations remain separate recoverable drafts. Pre-sync full text uses its own unmerged
lineage, never the active server generation. Load these lineages before socket sync and hydrate the
newest compatible draft only while the input still equals its loaded base. At sync, replay only
when the server still matches that base or already contains the draft. Changed bases remain for
explicit recovery. Retire the exact text record only after the merged causal snapshot is stored;
a later edit in the same lineage must survive. Known-generation bytes merge only after server sync.
Never persist an empty-generation document or save a clean close. SQLite document discovery
plus the prior SecureStore index
drive background drain after Done, foreground and connectivity changes. ACKed generations prune
on clean close; explicit sign-out waits for writes and removes indexed chunks, SQLite storage and its key.
View-only sessions
never merge local draft bytes into live content. Recovery inserts after current text and keeps its
source until Discard. Reads, writes and deletion share the storage queue. Resumed bindings carry
the actual input base across detach and retire pre-sync copies only after successful preservation.

`useNoteCoEditing` is a thin wrapper over `createTextBinding` (`textBinding.ts`). The binding
keeps the text the native input grew from together with the remote delta that text has not seen;
applying the pending delta to the base always yields the doc. Local input is diffed against that
base and rebased through the pending delta; the pending delta is rebased through the local change
in return. Remote `Y.Text` events are recorded as retain/insert/delete deltas (`textDelta.ts`),
refined against the pre-event text when a peer rewrites a span as one replace, and composed into
every pending delta. Caret and local indices map through those deltas, never through one
prefix/suffix diff. A local insert and the caret stay before a peer insert at the same index.

A rebuild keeps the pre-rebuild base until the next native text reveals its lineage: each native
text is diffed against the base that explains it with the strictly smaller change, and a text equal
to the pre-rebuild base is a delete of the peer insert, not a late event. Rebuilds wait for typing
silence and for IME composition to end; composition is inferred from the last text change and the
caret (`composition.ts`) and capped by a hold. Blur and teardown force a rebuild. Flush local input
before applying a peer rebuild. The screen restores the caret in the same commit as the rebuilt
text, never on a timer. Existing markdown notes use realtime/draft persistence from mount,
including pre-sync and reset windows. Full-document RPC autosave must not run alongside it. Titles
remain metadata writes. On generation reset preserve draft before rebuilding from server state. Web
and native inputs become read-only on access loss and label it accurately.


## Connection unavailable

Before initial sync, web notes show the RPC content read-only. After five seconds the connection
notice offers Retry. Descriptions may explicitly switch to plain editing only before realtime
ownership, with no pending local work or generation reset. Disable the realtime attachment for
that editing session and report `realtimeOwned: false` on Done so the host saves through ConnectRPC.
Do not switch a live editor to whole-document RPC writes when its socket disconnects.
Reverse proxies must forward WebSocket upgrades and subprotocol headers on `/api/realtime`.


Rename propagation takes document locks in deterministic order, updates stored columns and grafts
label edits into committed Y.Text/canvas state without changing generation. Pending snapshots are
candidates even before outgoing references project. Publish after commit wakes resident caches.

Web and mobile reconnect delays include jitter. Mobile proxy close code 1000 reconnects while docs
remain attached; explicit teardown does not. Mobile reconnect clears server read-only latches while
retaining caller-requested read-only mode.
Draft storage coalesces queued same-generation writes and preserves unreadable source records.
An in-progress write finishes before the next queued write. Full snapshot encoding, encryption and
SQLite blob writes still cost work proportional to document size. Physical-device latency and crash
qualification remain required before claiming large-draft readiness.
