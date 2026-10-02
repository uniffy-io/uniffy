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
exclusive lock. Ordinary replacements, realtime acceptance, projection and deletion must use
compatible ordering. Acquire multiple document locks in deterministic order.

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
| 4 | Fragment seed role: varuint 1 granted or 0 revoked. |
| 5 | Authoritative generation string. Sent before document synchronization. |
| 6 | Generation string, update ID string and update bytes. Client durable write. |
| 7 | Update ID string. Server acknowledgment of committed bytes. |

Untagged client SyncStep2 and SyncUpdate writes are rejected at document scope. Clients send writes
through type 6, including replies derived from sync handshakes. Read-only entries retain draft state
but suppress writes. Untagged clients require an application update. Deployment must coordinate
backend, workers, web and mobile protocol support; schema migration precedes writers.

Both multiplexers retain unacknowledged updates, including delete-only changes, and resend them on
reconnect. Only an exact type-7 ID removes a pending update. Socket buffering is not durability.
Generation mismatch stops replay into the active document and creates a fresh session while keeping
the incompatible draft recoverable. Ignore incoming synchronization until generation is known.

Every socket callback and asynchronous Blob decode checks socket identity before mutating shared
transport state. Old callbacks must not clear a replacement socket or its timers.

Transport owns exponential reconnect, periodic 30-second resync, 15-second awareness keepalive and
30-second idle close. Web listens for online/offline, visibility and auth refresh/revoke events.
Mobile uses AppState and connectivity listeners. Disconnect removes remote awareness so offline
mirror ownership can settle locally. Detach sends awareness removal where possible.

One process-wide `RealtimeRouter` subscribes to document, permission, defaults and auth signals.
Never create a Valkey subscription per document or user. Replica IDs deduplicate self-origin fanout.
Document updates and replacement payloads are reload hints, not authority: reload PostgreSQL state.
Periodic synchronization catches missed fanout. Publisher reconnect retries after a missing client.

Outbound queues and frame sizes remain bounded. Full snapshot reload and PostgreSQL access checks
cost work per disclosure. Measure that path before expanding fanout or document sizes.

## Authorization

The permission model is defined in `permissions.md`. Active organization membership and live
content access are required. Tasks inherit a live project policy. Calendar overrides retain the
master's private-detail floor while resolving addressed-row grants and attendees. Recurring masters
and synthetic occurrences do not attach.

Upgrade validates Origin, access-token type, token organization, user and session revocation facts,
and active membership. Web passes bearer in `Sec-WebSocket-Protocol` alongside
`uniffy.realtime.v1`; server echoes only that canonical protocol. Mobile can pass Authorization.
Never echo bearer data through the selected protocol.

Fresh PostgreSQL authorization runs at inbound document handling, durable mutation and outbound
disclosure. Periodic watchdog checks connection lifetime and document permissions. Expiry and lost
PubSub must not leave cached `can_edit` as authority. Close database contexts before seed-election
work opens another one, to avoid connection-pool starvation.

Document denial detaches only that handle and tombstones its subscription. Other documents on the
socket continue. Read-only downgrade suppresses writes and updates editor affordances on web and
mobile. Both retain rejected drafts. Connection-wide failures still close the socket.

Close codes: 1009 oversized frame; 4401 invalid token; 4403 connection forbidden; 4404 missing;
4408 idle eviction; 4409 refresh required; 4410 token revoked. Keep 4409 and 4410 distinct: expiry
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
renders description/references without advancing `ical_sequence`. Missing/deleted targets remove
snapshot state instead of resurrecting content. After commit, adapters index search and emit new
mentions attributed to last editor or owner fallback. These after-commit effects do not have an
independent durable outbox; content durability must not be confused with notification delivery.

A minute recovery job scans a bounded batch of `revision > rendered_revision` rows. It repairs
projection after queue loss, worker failure or failed rendering. Failed forced eviction re-arms the
dirty session; never remove its only resident recovery attempt on failure. Accepted bytes remain
safe in PostgreSQL even if queueing or process shutdown fails.

`stage_replacement` writes replacement domain content and a fresh generation in one transaction
under the same document lock. Publishing after commit wakes caches. Stale clients cannot replay
old-generation bytes into that replacement. Notes using `expected_content_version` also reject a
replacement when accepted realtime revision has not reached the domain column yet. Metadata-only
writes retain generation. Deletion follows the same locks and removes snapshot state.

## Web persistence and lifecycle

`features/realtime/hooks/useDocSession.ts` owns Y.Doc, awareness, local recovery and attachment.
`whenSynced` waits for server synchronization and local hydration. Rich and Markdown editors remain
read-only until their binding is initialized. Never seed from a placeholder before this gate.

Encrypted IDB uses database `uniffy-realtime-yjs`, version 3, with
`[contentType, contentId, generation, seq]` rows. Schema upgrades preserve prior rows. Storage key
rotation follows the existing encryption lifecycle. Recovery requires initialized Web Crypto;
plain HTTP on host.docker.internal cannot validate encrypted recovery.

Primary local edits persist a full encoded document with causal base. Each row keeps its generation.
Online hydration merges only matching generations. Offline hydration merges a single known lineage;
ambiguous lineages wait for server identity. Retry hydration against authoritative generation before
opening editing. Mismatched rows remain available through recovered-draft UI, including raw update
export. Never delete an incompatible draft just because it cannot be replayed automatically.

Compaction, unload and disposal await pending writes. A fresh attachment waits for preceding disposal.
Clean-close removal requires completed hydration, server sync, connected transport and no pending
acknowledgments. Remove only rows written or hydrated by that session in its generation. Unseen rows
from another tab remain untouched. Per-row decrypt failure skips that row without clearing others.

`useMarkdownDocSession` supplies identity awareness, undo, read-only transport state and smoothed
outbound status. Offline status wins over pending-write hysteresis. Healthy editor chrome stays
quiet. `RealtimeSessionStatus` shows presence and exceptional status or recoverable drafts.

`ExpandableEditor` owns realtime while expanded and during pending/offline drain after Done. Its
host must suppress full-string RPC content writes once realtime owns the session. Task/calendar
preview slices remember superseded visible strings to avoid reverting on stale metadata responses;
an equal or unseen peer value releases protection. This is text-based reconciliation, not a server
revision watermark. Recurring masters and synthetic occurrences keep scoped ordinary updates.

## Text bindings and seeding

`CrepeEditor` binds y-prosemirror, cursor and undo plugins to the shared fragment. Rich text is
mirrored to `Y.Text("markdown")` by the lowest editable awareness client ID with markdownEditor set.
Mirror writes set `markdown_mirror.active=true`. Explicit Markdown and mobile text mutations set
it false in the same transaction so rich editors consume intentional text changes.

MarkdownSplitEditor uses synchronous CodeMirror transaction ranges and immediate Y.Text deltas.
Only preview rendering is debounced. Never compare a stale full editor string with an already
merged Y.Text and treat peer inserts as local deletions.

Mirror serialization normalizes exactly Milkdown's single trailing newline. Preserve user whitespace
and valid escapes. Done flushes before teardown. A delayed non-leader leave flush verifies that its
captured fragment still matches before writing. Dispose observers synchronously, mute cancelled
bindings and clear queued Milkdown callbacks before context destruction.

Fragment initialization uses a PostgreSQL seed lease shared by replicas. Peers cannot extend a
suspended owner's lease by polling. Other rich editors wait for content or a transferred role;
there is no client timeout that seeds independently. Cancellation releases the wait.

Seed metadata records client ID, original top-level clocks and original content. Duplicate cleanup
may remove only an unchanged original seed block. User edits inside that block must survive.
A suspended lease owner that resumes late can still produce a duplicate branch; changed branches
are preserved rather than guessed away. Seed lease is coordination, not a write-authorization fence.

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

Drafts use chunked Expo SecureStore, scoped by user, organization, content type and ID. Write chunks,
publish manifest, then delete replaced chunks. Same-generation saves merge prior raw bytes before
replacing records, even if current session has not hydrated. Serialize recovery reads with writes
so a writer cannot remove chunks under an active reader. Failed reads retain source records.
Other generations remain separate recoverable drafts. Pre-sync full text uses its own unmerged
lineage, never the active server generation.

`useNoteCoEditing` diffs native input against last local canonical text, transforms around peer
changes and delays visible remote rebuilds while typing. Flush local input before applying a peer
rebuild. Existing markdown notes use realtime/draft persistence from mount, including pre-sync and
reset windows. Full-document RPC autosave must not run alongside it. Titles remain metadata writes.
On generation reset preserve draft before rebuilding from server state. Web and native inputs become
read-only on access loss and label it accurately.
