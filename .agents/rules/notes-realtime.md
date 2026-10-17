---
paths:
  - "src/uniffy/core/realtime/**/*.py"
  - "src/uniffy/core/models/realtime/**/*.py"
  - "src/uniffy/infrastructure/valkey/binary.py"
  - "src/uniffy/domains/projects/**/realtime.py"
  - "src/uniffy/domains/scheduling/calendar/**/realtime.py"
  - "src/ui/src/components/editor/CrepeEditor.tsx"
  - "src/ui/src/components/editor/ExpandableEditor.tsx"
  - "src/uniffy/domains/notes/**/*.py"
  - "src/uniffy/core/models/notes/**/*.py"
  - "src/proto/schema/notes/**/*.proto"
  - "src/proto/tests/fixtures/realtime_wire_frames.json"
  - "src/ui/src/features/notes/**/*.ts"
  - "src/ui/src/features/notes/**/*.tsx"
  - "src/ui/src/features/realtime/**/*.ts"
  - "src/ui/src/features/realtime/**/*.tsx"
  - "src/ui/src/features/auth/hooks/useSignOut.ts"
  - "src/mobile/src/shared/realtime/**/*.ts"
  - "src/mobile/src/shared/realtime/**/*.tsx"
  - "src/mobile/src/features/notes/realtime/**/*.ts"
  - "src/mobile/src/features/notes/realtime/**/*.tsx"
  - "src/mobile/src/features/auth/useSignOut.ts"
---

# Notes Domain and Realtime Collaboration

## Authority and ownership

NOTE, TASK and CALENDAR_EVENT share `core/realtime/`. Domain adapters live in
`domains/notes/adapter.py`, `domains/projects/realtime.py` and
`domains/scheduling/calendar/realtime.py`. Canvas notes use the note adapter and take every path
below. Core never imports domains. Web and worker composition roots register adapters explicitly.
`state.py` owns shared document and connection dataclasses.

Accepted edits live in two stores. PostgreSQL `realtime_yjs_snapshots` holds the checkpoint:
compacted Yjs bytes keyed by `(content_type, content_id)`, with organization, generation, revision,
rendered revision, last actor, fragment seed lease, `buffer_epoch`, `valkey_run_id` and
`checkpoint_seq`. The Valkey update buffer holds the edits accepted since that checkpoint. Live
state is the checkpoint plus the verified contiguous buffered tail. A replica's resident Y.Doc and
the per-process latest-state cache (`latest.py`, 64 MiB) are caches of live state, valid only for
the same generation, epoch, Valkey instance and checkpoint revision. Admission reads only the
records past the resident head while the row still names the checkpoint the resident document
follows (`UpdateBuffer.read_since`); the cache serves other readers.
`uniffy_realtime_latest_reads_total{source}` counts resident, cache and checkpoint reads.

Losing Valkey data can lose accepted edits that no checkpoint holds yet. That tradeoff is accepted.
It never permits silent deletion in normal operation, a save indicator that claims more than the
server holds, stale overwrites, weaker permission checks or dropping client recovery.

Every own update a client sends is in one of three states:

| State | Server fact | Client may retire |
|---|---|---|
| Local | Nothing proves the server holds it | Nothing |
| Accepted | Appended to the buffer under a sequence of the current epoch (type 11) | Routine retransmission; raw bytes and device recovery stay |
| Checkpointed | A PostgreSQL commit covers its sequence (type 12 or 13), or type 7 names its id | Raw bytes, recovery rows and the drain entry |

`storage.lock_document` serializes mutations with a PostgreSQL transaction advisory lock. A task or
calendar override also takes a shared lock on its policy parent. Parent deletion takes an exclusive
lock. Admission, checkpoint capture, commit and trim, plain-write merges, seeds, replacement, trash,
restore, deletion, rename, projection and idle reclaim all take it. Acquire multiple document locks
in deterministic order through `lock_documents`.

`stage_seed` hydrates and persists one shared Y.Doc baseline under that lock. A random generation is
stored both in the snapshot column and `doc_meta.generation`. Existing snapshots retain their
encoded generation, including the empty marker for historical snapshots. Independent replicas must
never invent independent CRDT baselines for the same generation. The generation changes only on
intentional replacement. The buffer epoch changes when buffered state starts or is reset, and never
changes the generation, so compatible client edits can replay into a new epoch.

## Wire protocol

One WebSocket per tab or mobile app carries every attached document on subprotocol
`uniffy.realtime.v2`:

```text
/api/realtime?org_id=<uuid>
[VarString docName][message bytes]
docName = <CONTENT_TYPE>:<uuid>
```

`multiplex.py` and client `multiplex.ts` own byte-compatible envelope encoding. Keep lib0 varint and
string behavior. `doc_name_for` and client `docNameFor` own names.
`src/proto/tests/fixtures/realtime_wire_frames.json` is the shared byte corpus for types 5, 7, 11,
12 and 13, the `unavailable` denial (retryable) and the `update conflict` denial (final for that
id), and three coverage sequences; Python, web and mobile codecs must round-trip every case. Update
ids, generations, epochs and seed tokens hold at most 128 UTF-8 bytes and integers stay within
2^53 - 1. A truncated frame, wrong type or trailing byte is malformed. Document names may hold
4 KiB; seed source text uses the 1 MiB frame limit.

| Type | Sender | Payload and meaning |
|---|---|---|
| 0 | both | y-protocols sync. A client SyncStep1 asks for state and is answered with SyncStep2 after the handshake frames. Server SyncUpdate frames carry accepted updates and realignments. The server sends SyncStep1 to an editor whose attaching state vector holds structs the resident document lacks, and to every client after an epoch reset. |
| 1 | both | Awareness update, capped at 64 KiB. |
| 2 | server | Document denial: scope 0 refuses writes, scope 1 means no view access, followed by a reason. |
| 3 | both | Awareness query, exactly one byte. Peers answer with their awareness, so the server relays only that byte and at most once per handle every five seconds. Clients send it once per attach. |
| 4 | server | Fragment seed role: varuint 1 granted or 0 revoked, then an optional lease token. |
| 5 | server | Authoritative generation. Sent before synchronization on attach, on every resync and on a generation change. |
| 6 | client | Generation, update id, update bytes. Every client write, including replies derived from sync. |
| 7 | server | Update id. PostgreSQL holds that update: a committed seed proposal, or an update that adds nothing to a document whose checkpoint holds all live state. Never sent for a buffer-only append. |
| 8 | client | Generation, request id, lease token, source Markdown, update bytes. Isolated fragment seed proposal. |
| 9 | server | Request id. Seed proposal rejected without changing state. |
| 10 | client | One byte: 1 advertises rich fragment seed capability, 0 withdraws it. |
| 11 | server | Update id, generation, epoch, accepted sequence (at least 1). The buffer holds the update. |
| 12 | server | Generation, epoch, covered sequence, checkpoint revision. PostgreSQL holds every update of that epoch through the covered sequence. |
| 13 | server | Generation, epoch, head sequence, checkpoint sequence, checkpoint revision. The checkpoint sequence never exceeds the head. Sent after 5 on attach and resync, and on every epoch reset. |

Type 2 reasons are exact strings. `read only` goes to a viewer on attach, ahead of any sync frame.
`edit access removed` is a live downgrade. `no view access` and `access revoked` use scope 1. Write
refusals are `edit denied`, `update too large`, `invalid update`, `seed_conflict` and
`client update required` (untagged SyncStep2 or SyncUpdate). `too many open documents` refuses an
attach beyond the per-socket document limit.
`unavailable` is retryable: the client keeps every local update and resends the same ids after a
backoff. The server sends it when Valkey is unreachable, the preflight disabled buffering, an
admission outcome is unknown, an epoch will not settle, a stored record cannot be read, a document
or bucket limit is reached, Valkey answers OOM, or live state for a seed cannot be verified.
`update conflict` means the id already names different bytes in this epoch; the client never sends
that id again.

Close codes: 1009 unidentifiable oversized frame; 1011 session ended, reconnect; 1013 rate limit,
socket limit, slow consumer or temporary authentication outage; 4400 malformed prefix, bad document
name, unsupported content type or malformed SyncStep1; 4401 invalid token; 4403 connection
forbidden; 4409 refresh required; 4410 token revoked; 4426 upgrade required, never reconnect.
Keep 4409 and 4410 distinct: expiry refreshes and reconnects, revocation stops until app
authentication changes. Socket lifetime is bounded even without content attached. Inbound,
outbound and watchdog tasks supervise each other; any task failure retires the connection.

Upgrade checks run in order: origin, token, token type, token organization, revocation, membership,
protocol, then the per-user socket limit. A refusal completes the handshake and then closes with its
code, so clients read the code instead of an HTTP 403: 4403 forbidden origin, organization mismatch
or inactive membership; 4401 undecodable or wrong-type token; 4410 revoked credentials; 1013
authentication outage or socket limit; 4426 when `uniffy.realtime.v2` is not offered. The handshake
selects `uniffy.realtime.v2` when offered, otherwise the first protocol offered, never the bearer
entry. Two upgrades are refused before acceptance, as HTTP 403: a missing or malformed `org_id`
query parameter, which FastAPI's request validation closes with 1008 before the route runs, and an
upgrade from an allowed origin with no token. Clients always send both. On 4426 web stops
reconnecting and shows Reload to keep saving; mobile shows Update to keep saving. Backend, workers,
web and mobile ship protocol support together. No server serves two protocols.

## Client transport

Local update bytes batch per document for 50 ms from the first edit; later typing does not move the
deadline. Observer transactions stay together, including rich Markdown mirrors. A batch flushes
early at 64 KiB, on a hidden page or backgrounded app, on pagehide and on detach. Earlier
transaction chains go out separately before a new chain would push the batch past the frame
budget. Unsent bytes count as transport pending at once. This bounds ordinary typing frames per
client, not total writes across editors; sync, seed and lifecycle frames can send sooner.

Each flushed batch becomes one own update with id `<ydoc guid>:<counter>`. The transport keeps its
raw bytes, delete-only updates included, until a checkpoint covers it. Socket buffering is not
durability. A single update above 1 MiB minus 4 KiB, or more than 8 MiB of unaccepted bytes, stops
at document scope: the document turns read-only with a visible rejection, and the edits stay in the
Y.Doc and local recovery. They never enter an automatic retry loop.

`updateCoverage.ts` is one pure module per client, held to the corpus:

- Sequences compare only within the generation and epoch that this socket's latest type 13 set.
- Type 11 moves a local id to accepted, or straight to checkpointed when already covered.
- Type 12 raises the covered sequence even before the matching receipts arrive; a later receipt at
  or below it retires at once.
- Type 13 for a new epoch, or with a head below a receipt, returns those ids to local. They replay
  under their original ids, and the server deduplicates by id and digest.
- Type 7 retires that exact id from any epoch.
- A type 13 whose generation differs from this socket's type 5, or that arrives before it, is
  ignored.
- Receipts restored from device storage count as accepted only within the current epoch and at or
  below its head.

On open, every attached document sends SyncStep1 first, which attaches it; seed capability and,
for documents with presence, awareness and an awareness query follow. When type 5 arrives on a new
socket, ids still local are resent. Accepted ids wait for type 13 to prove or refute their
presence. A type 13 that changes the epoch on a live socket resends in-flight local ids. A server
SyncStep1 is answered with full state, as one type 6 update under a new id, only when the client's
coverage epoch changed under it; a Yjs reply always repeats the whole delete set. Otherwise the
client only flushes its unsent batch. Read-only documents never answer.

`unavailable` keeps every local id local and shows Saving unavailable. The ids resend after 5 s,
growing by 1.5 up to 15 s, and again on reconnect. Any receipt or type 7 ends the state and resends
the refused ids at once, since the server takes writes again.
`update conflict` stops only the oldest awaited id.

Generation mismatch stops replay into the active document and creates a fresh session while
keeping the incompatible draft recoverable. Ignore incoming synchronization until generation is
known. Every socket callback and asynchronous Blob decode checks socket identity before mutating
shared transport state. Old callbacks must not clear a replacement socket or its timers.

Transport owns exponential reconnect with jitter, periodic 30-second resync, 15-second awareness
keepalive, 30-second idle close and a reconnect when a sync request stays unanswered for ten
seconds. The reconnect delay grows from 500 ms by 1.5 up to 15 s. An inbound frame resets it, and so
does a forced reconnect (online, foreground or visibility, Retry, auth refresh), but opening never
does: a refused upgrade opens and closes before any frame. Web listens for online/offline,
visibility, pagehide and auth refresh/revoke events. Mobile uses AppState and connectivity
listeners. Disconnect removes remote awareness so offline mirror ownership can settle locally.
Detach sends awareness removal where possible. Headless sessions such as drains carry no local
awareness and send no awareness or awareness query frames.

Web closes 4401 and 4409 enter refresh with exponential backoff and a five-attempt cap. No socket
opens without an access token. Retry or returning online resets the cap. Mobile refreshes at once on
4401 and 4409; only a fresh token reconnects at once, and a refresh that fails or returns nothing
takes the normal reconnect backoff. Mobile caps refreshes at five in a row; foreground or regained
connectivity resets the cap. On both clients an inbound frame resets it too.
Temporary refresh errors retain credentials; startup offers Retry. Authentication rejection remains
a sign-out condition.
Refresh and organization switch share a cross-tab lock: Web Locks on secure origins, an IndexedDB
transaction otherwise. Read the refresh token after acquiring the lock, persist rotated credentials
before releasing it, and ignore responses superseded by another login. Dedicated `uniffy:auth`
storage excludes access tokens and cannot be overwritten by unrelated redux-persist writes.
Same-session storage events update refresh credentials. Other-session or organization changes retire
the old tab's auth and sockets. Reconnect reads the current Redux organization, including idle sockets.

## Server sessions and admission

The first frame naming a document attaches it after a fresh connection check and adapter
authorization. Acquire hydrates the resident document from checkpoint plus verified tail
(`hydration.py`). When the buffer cannot be read it starts from the checkpoint alone, without an
epoch, and sends no type 13 until a later refresh succeeds. Attach then realigns, sends 5 and 13,
and sends `read only` to a viewer before any sync frame. A later SyncStep1 is a resync: the server
realigns from checkpoint plus tail and resends 5 and 13 before answering, so missed hints and
progress frames repair there. Each answer encodes a whole document, so resyncs draw on a socket
budget of twice `REALTIME_MAX_DOCS_PER_SOCKET` that refills by that limit every 30 seconds; an
empty budget delays the socket's next frame instead of dropping it. The attaching SyncStep1 is
free.

Type 6 runs `admission.admit_update` under the resident session lock and a PostgreSQL document lock:

1. Edit access is read fresh from PostgreSQL. The role also applies to the writer's handle, so a
   type 6 frame needs no separate inbound recheck: a downgrade sends `edit access removed`, a lost
   view detaches the document.
2. Latest state comes from narrow row facts, the control head and, unless the resident document
   already holds the checkpoint, the cached or read checkpoint plus tail. An unusable epoch settles
   through `ensure_epoch` first. That commits and retakes the lock, so access is checked again. A
   vanished row is seeded again under a fresh generation.
3. `resident.follow` realigns the resident document and broadcasts what changed, including a fresh
   type 13 after an epoch reset, before any receipt of the new epoch.
4. `resident.check_update` validates against the resident document, never a fresh PostgreSQL decode:
   generation, merged bytes against `REALTIME_MAX_SNAPSHOT_BYTES`, rendered Markdown against
   `REALTIME_MAX_DOCUMENT_BYTES`, `doc_meta.generation` and seed claims. It applies the update to a
   shadow copy that takes every update the resident document takes, so its cost follows the update,
   not the document; a refused or unaccepted update drops the shadow, and the next check rebuilds
   it. An ordinary update that adds a seed claim is `seed_conflict`. When the shadow shows no change
   and no new structs, a raw merge decides: it keeps delete sets and structs whose predecessors have
   not arrived; validating only visible text would lose them.
5. An update that adds nothing appends no record. It answers type 11 at the current head, or type 7
   when the head equals the checkpoint.
6. The admit script appends the sealed record at the next sequence, records the receipt as
   sequence plus the HMAC digest of the plaintext (below), counts stored bytes and records, sets `first_ms` once and `last_ms` always, and adds the
   due entry at first pending time plus ten seconds without moving an existing one. A repeated id
   with the same digest answers its original sequence. A recovery-required answer resets the epoch
   once and retries.
7. Only a confirmed append applies the update to the resident document, sends it to local peers and
   answers type 11. Publication to other replicas runs afterwards, in sequence order, and never
   delays the receipt.

The admit call has a 150 ms deadline. When it may have reached Valkey without a reply, the client
keeps its id and resends; deduplication answers. A generation conflict reloads and sends 5, 13 and
the whole document as a SyncUpdate to the sender.

Type 8 runs `live.accept_seed`. It checks edit access, generation, lease owner and token, unchanged
source text, an empty prior fragment and a resolved seed claim against live state, then commits the
seed with the whole buffered tail as a checkpoint before type 7. Rejection answers type 9 and the
client retries against current state without inserting speculative blocks. A committed no-op replay
answers type 7.

One process-wide `RealtimeRouter` subscribes to document, permission, defaults and auth signals.
Never create a Valkey subscription per document or user. Accepted-update hints carry the sealed
record with its update id and actor, generation, epoch and sequence (payload below); replica IDs
drop a process's own echoes. A replica applies a record
that continues its resident head and otherwise reloads checkpoint plus tail. Checkpoint progress and
content-replace hints are not origin-deduped. Progress for a newer revision, another epoch or a
sequence beyond the resident head reloads first. Progress for the resident generation and epoch
then raises the resident watermark and goes to attached clients as type 12. A content-replace hint
carries no content and reloads. Publisher reconnect retries after a missing client. The subscriber
only parses: each document's messages run in order on that document's own task, so a reload waiting
on one document's lock holds up no other document. Queued progress collapses to the newest, a
queued reload absorbs the records behind it, and more than 1024 queued records become one reload.

Outbound queues retain at most 1024 frames and 8 MiB per socket; a full queue drops frames for that
socket only. Incoming frames are capped at 1 MiB and 120 messages per second with a burst of twice
that; resyncs and awareness queries carry the tighter budgets above. Resident documents evict after 15 idle minutes. Eviction and shutdown write no document state:
`drain_for_shutdown` stops seed timers and gives queued peer hints five seconds. PostgreSQL
authorization still gates each disclosure and mutation.

Deployment limits use REALTIME_MAX_DOCUMENT_BYTES (524288), REALTIME_MAX_SNAPSHOT_BYTES (8388608),
REALTIME_MAX_DOCS_PER_SOCKET (32), REALTIME_MAX_SOCKETS_PER_USER (16 per backend process), and
REALTIME_MAX_MESSAGES_PER_SECOND (120). Awareness has a 64 KiB cap. Awareness identity comes from
the authenticated account. A connection publishes only its own awareness client ID.
Socket admission reserves capacity before awaiting acceptance and releases it on every exit,
including failed acceptance and cancellation. The counter is per global user, across organizations.

## Valkey buffer and epochs

`buffer_keys.py` owns the layout, `LAYOUT_VERSION` 2. Documents map to 16 fixed buckets by SHA-256
of organization, type and id. A bucket's keys share the hash tag `rtbuf:{v2:NN}`, so every script
stays single slot; maintenance state is `rtbuf:v2:maintenance`. Each document generation and epoch
has a stream of `<seq>-0` records (`i` update id, `u` sealed update, `a` actor, `t` acceptance
time, `v` format `RECORD_FORMAT` 2), a control hash (head, pending bytes and records, committed
hint, first and last append time, starting revision) and a receipts hash. Each bucket has a due
sorted set, an early sorted set, a scope set and an accounting hash. The early set names documents
past 1 MiB or 1024 pending records; a trim below both removes them. The scope set names every scope
with a control record or records: initialization and appends add it, reclaim, a dropped retired
stream and a retire that empties the stream remove it, so maintenance walks buffered documents
instead of the keyspace. Pending keys carry no TTL and are never trimmed by length. Every script
checks argument and key types before its first write.

`infrastructure/valkey/binary.py` is the binary-safe client: no retries, 200 ms connect and 150 ms
socket timeouts, and a pool capped by `VALKEY_BINARY_MAX_CONNECTIONS` (10). A call that finds every
connection busy waits up to 50 ms, well inside the admission deadline, and
`uniffy_valkey_binary_pool_waits_total{outcome}` counts waits served and timed out. Each new
connection reads `INFO server` and refuses to serve when the `run_id` differs from the identity
recorded at startup. The caller adopts the new identity and treats the epoch as unproven.

Field `u` never holds plaintext. `UpdateBuffer.admit` seals each update with `OrgDataCipher`
(`core/crypto/org_data_cipher.py`, AES-256-GCM) after the preflight and budget checks, before the
150 ms deadline starts. The blob is format byte `0x01`, the 4-byte big-endian DEK version, a 12-byte
random nonce, then ciphertext and the 16-byte tag: `SEAL_OVERHEAD_BYTES` is 33. The key is
HKDF-SHA256 of the organization's DEK with info `uniffy-realtime-buffer-v1`, so it rotates with
`OrgCipher` and never enters Valkey. GCM associated data is the 5-byte header plus `record_aad`,
`<scope.member>:<update id>:<actor id>`, which binds organization, type, id, generation, epoch,
update id and actor. A record copied to another scope, or with an edited id, actor, version or
format byte, fails to open. Nonces are random, so one DEK version stays well under 2^32 sealed
records; a very busy organization needs DEK rotation, and no doc may claim an unbounded budget.

The receipt digest is `receipt_digest`: HMAC-SHA256 of the plaintext under a key derived with info
`uniffy-realtime-receipt-v1` from the active DEK version, 64 hex characters. It is computed with the
seal, so a retry across a DEK rotation that reaches the script carries a digest under the new
version and answers `update conflict`. The window is the retry window, or up to 60 s while a process
that missed the invalidation still caches the old active version (`OrgActiveDekVersions`); a retry
on the live path usually finds the update held and answers type 11 before the script.
`invalidate_org_dek_caches` drops the derived keys and the active version on rotation. Concurrent
misses for one key share a single load, because each load opens a database session while its
callers hold the document lock and a connection. A header version outside 1 to 2^31 - 1, the range
of `org_encryption_keys.version`, refuses to open without a lookup.

`read_prefix` unseals every record, so every `BufferedUpdate.update` a consumer sees is plaintext;
only maintenance reads `parse_record` output, for sequences and times. A record that does not
unseal is `RecoveryReason.MALFORMED` with its poison semantics. A remote hint that does not unseal,
or whose generation or epoch cannot form a scope, reloads checkpoint plus tail like a gap and is
never broadcast. Both count in `uniffy_realtime_buffer_unseal_failures_total{source}` (`stream` or
`remote`). A key that cannot load (no active DEK, master key or database failure) raises
`BufferUnavailable`, so the client gets `unavailable` and nothing is written. Logs carry the
sequence and scope or the error type, never bytes. Valkey still sees metadata: which documents
change, actor ids, times and sizes. Queues, caches and pub/sub control messages are not sealed, and
checkpoint progress hints are not authenticated.

`publish_doc_update` sends kind `accepted_update` with `origin_replica`, `generation`, `epoch`,
`sequence`, `update_id`, `actor_id` (UUID string), `sealed` (standard base64) and `published_at`.
There is no plaintext `update` field. The receiving replica's `_parse_remote_update` requires a
non-empty `update_id` within `MAX_WIRE_STRING_BYTES`, a UUID `actor_id` and valid base64 `sealed`,
then opens the record with `unseal_record` under the hint's scope.

The row binds each epoch to the `run_id` that issued its sequences, so a restarted or restored
Valkey can never reissue a sequence a client holds a receipt for. `epoch.ensure_epoch` runs under
the document lock. On an uninitialized row, a changed instance, a missing control record, a head
below `checkpoint_seq` or a gap, it folds the provable contiguous surviving prefix (up to 4096
records) into the checkpoint, creates the new control record, and commits the row with a fresh epoch
at sequence 0. After the commit it publishes progress with covered sequence 0, so replicas reload
into the new epoch, retires the old epoch's control, receipts and due entry, and takes the lock
again for the caller. Records the old epoch kept past a gap stay for investigation. A stale record
of the instance in one process alone never resets a healthy epoch.

Resets are lazy: one document at a time, on its next admission, attach, content write, checkpoint or
maintenance pass. A planned Valkey restart with persistence intact still changes `run_id` and
resets each document this way after checkpointing its surviving tail. In-place deletion without a
restart, such as FLUSHALL or a manual DEL, shows up as a missing control record or a gap. Restoring
older keys inside a running instance is unsupported.

The deployment pending budget splits evenly across the 16 buckets. Every limit counts stored
bytes: a record's sealed update (plaintext plus `SEAL_OVERHEAD_BYTES`), twice its id and 256 bytes
of entry overhead, close to what Valkey spends on it. `stored_bytes` takes the plaintext and adds
the seal overhead, which equals what the script counts over the sealed record. The script's
`max_record` (`ARGV[11]`) is `MAX_STORED_UPDATE_BYTES`, the 1 MiB frame cap plus 33. One document may hold the smaller of 16 MiB and a quarter of its bucket's
budget, and at most 4096 records. One organization may hold half of a bucket, tracked as `o:<org>`
in the accounting hash; organizations under one person's control can still fill a bucket. Exceeding
any limit, or a Valkey OOM, refuses the append retryably and trims nothing already accepted.

## Checkpoints and maintenance

Buffer jobs run on core workers with `JobReliability.BUFFERED` and a Valkey recovery fact
(`job_contracts.py`). Projection stays `DURABLE`.

`cron:dispatch_realtime_checkpoints` is a unique schedule on the core fleet: one run per second,
taken by any core worker, with quiet logging. Per bucket it reads up to 64 due entries and up to 32
entries of the early set, oldest first; a backoff moves an entry's score in both sets. It skips
claimed documents, takes a five-second claim, and enqueues at most 16 documents per bucket and 64
per tick across the fleet. The job id `checkpoint:<scope>:<claim>` is unique per dispatch, so
neither a kept result nor the in-progress key of a worker that died mid-pass refuses a later one.
The job extends its claim while it runs and on every busy requeue. A job whose claim another
dispatch or a backoff holds runs no pass (`superseded`). A worker killed mid-checkpoint frees its
document within the five-second claim, and the next tick dispatches it again; a stalled pass that
lost its claim still commits only through the guarded commit below. Due entries stay until cleanup
proves coverage, so a lost job is dispatched again. Continued typing never moves the deadline; a
record waits at most about ten seconds after its own acceptance.

`checkpoint_realtime_document` runs once per dispatch (no retries, no kept result, 120 s timeout),
two at a time per worker process; a busy process requeues after one second without using a try and
keeps the job's claim. Those two slots bound checkpoint throughput per core worker process, so the
core fleet's process count, not `CORE_WORKER_MAX_JOBS`, is the capacity lever.

1. Under the lock, capture a contiguous prefix of at most 1024 records or 4 MiB. A larger single
   first record goes alone.
2. Merge and compact outside the lock, keeping unresolved causal structs. The thread only keeps
   that work outside the lock: pycrdt holds the GIL, so it still occupies the worker's event loop,
   and the two slots of a process share one core. Plan checkpoint capacity as one core per core
   worker process.
3. Commit bytes, state vector, `checkpoint_seq`, revision and last actor only while generation,
   epoch, revision and watermark still match. A competing commit recaptures, up to three attempts.
4. Under the lock again, trim through the PostgreSQL watermark (`XTRIM MINID` at watermark plus
   one), drop those receipts and release their accounting. The due entry goes only when nothing
   remains. A surviving tail becomes due ten seconds after its oldest record, so a document edited
   during its pass is not due again at once; a later backoff score stays.
5. Publish progress and enqueue projection with job id `projection:<type>:<id>:<revision>`.

A record that cannot be decoded or unsealed marks the document poisoned: its bytes stay, the document backs off
from 15 s doubling to ten minutes, and other documents continue. Other errors back off the same
way, except an unavailable Valkey, which a later dispatch retries once the claim expires. Checkpoint
success never depends on rendering.

`cron:maintain_realtime_buffer` runs each minute at second 40. It walks a rotating slice of the
bucket scope sets (20 SSCAN calls, up to 1000 documents) and, per scope:

- skips claimed documents;
- settles a scope that is not its row's healthy epoch: a gone row or generation is obsolete, a
  replaced epoch is stale, a changed instance or a head below the watermark resets; an orphan
  control is counted;
- drops what a retired epoch kept once its newest record is older than seven days, with a warning
  and a counter;
- reclaims an idle epoch whose head equals `checkpoint_seq` with no due entry and no append for an
  hour: it deletes the keys and clears the row's epoch, run id and sequence under the lock, and the
  next touch starts a fresh epoch, counted as an `uninitialized` reset like a document's first
  buffer, even while an editor still has it open;
- trims committed prefixes a lost cleanup left;
- restores a missing due entry from the original first pending time.

Each pass also recounts the accounting of one bucket from its scope set, organization shares
included, rotating once per minute.

## Deployment preflight

`preflight.py` runs at backend and worker startup through `ensure_buffer_ready`; after a failed
start, buffer calls retry it at most every five seconds. A verdict holds for the instance it read:
once the binary client adopts another `run_id`, the next buffer call reruns the preflight at once,
and admission refuses until that read succeeds. It reads `INFO server`, `INFO persistence`
and `CONFIG GET` for maxmemory-policy, maxmemory, save and appendfsync. The single requirement is an
eviction policy outside `allkeys-*`. `noeviction` and `volatile-*` are safe because pending keys
carry no TTL.

With `REALTIME_VALKEY_PREFLIGHT=strict`, the default, a confirmed `allkeys-*` policy disables
buffered acceptance. Admission answers `unavailable`, content writes on documents with an epoch fail
retryably, clients keep local copies and show Saving unavailable, and the log names the setting.
`warn` keeps acceptance and logs the risk. A renamed or denied CONFIG yields unknown: the requirement
is logged and acceptance continues. Persistence never gates; the log states the loss window it
implies. The verdict is the `uniffy_realtime_valkey_preflight{verdict}` gauge and the `/healthz`
field `realtime_buffer` (enabled, disabled, unknown or not_run). `REALTIME_PENDING_BUDGET_BYTES`
defaults to a quarter of maxmemory capped at 512 MiB, or 256 MiB when maxmemory is 0 or unreadable.

Platform admins read the buffer through `superadmin.v1.SystemConfigService.GetRealtimeBufferStatus`
(`domains/platform/config/realtime.py`), shown on the `/platform` overview: the verdict and mode,
whether the budget comes from the environment, the preflight facts with the loss window, and
deployment-wide pending bytes, records, documents and oldest pending age. It requires a system
admin and names no document, organization or secret. Totals come from the bucket accounting hashes
and due sets in one pipelined round trip; when Valkey cannot be read the call answers without them.
Its epoch reset and poison counts are the answering backend process's own counters since it
started.

## Projection and effects

Worker checkpoints, seed acceptance, renames and restores that leave a revision unrendered enqueue
`project_realtime_document`, a `DURABLE` job carrying only content type, id and organization, one job id
per revision. Plain text merges and replacements write the domain column themselves and mark the
revision rendered. `persist_snapshot` loads the committed checkpoint under the document lock, calls
adapter `stage_render`, then commits domain columns, `rendered_revision` and `effects_pending`
together. It never rewrites the bytes; checkpoints compact them. Timestamp last-writer-wins is not
safe for CRDT state, and metadata timestamps never supersede content revisions. Lists, search,
previews, mentions and notifications lag live editing by the checkpoint delay plus projection.
Editors stay current. A buffer receipt never triggers an effect.

Adapters stage domain changes without hidden commits. Notes render markdown/canvas, outgoing
references and inline tags. Tasks render descriptions/references and advance version. Calendar
renders description/references without advancing `ical_sequence`. Missing targets remove snapshot
state. Trashed notes return `DeferredProjection.SOFT_DELETED`: retain accepted bytes and pending
revision without writing content or effects. Restore takes the document lock; subsequent projection
renders retained edits. Hard purge removes note snapshots. Projection stages original mention events
in `notification_outbox` in the domain transaction, attributed to last editor or owner fallback.
Shared-note content edits also stage events; changed calendar descriptions stage activity once.
After commit, search and preview hints run under the document lock against freshly loaded domain
state. Failure leaves `effects_pending` for recovery, without recreating mention deltas or activity.
In-app rows deduplicate by event/user; email uses its delivery outbox. Browser push remains
at-least-once with an event-specific tag.

Notification recovery rotates bounded batches every ten seconds and deletes an outbox record only
after successful processing. Inline attachment reconciliation is staged for note/task/event live
projection and ordinary task/event description writes. Its minute sweep runs
`reconcile_inline_item` under the document lock. It defers while accepted edits may be missing from
the columns, which includes a buffered tail and a buffer it cannot verify, then checks current
references before removing unreferenced inline uploads. Picked file copies remain attached. Fresh
inline uploads get a 24-hour grace period before unreferenced cleanup. Trashed notes wait for
restore. Deleted tasks and events have no restore path and retire reconciliation rows. Unchanged
projections do not bump content versions, timestamps or notifications. Edit notifications coalesce
per content/actor for ten minutes.

A minute recovery job scans a batch of up to 100 rows with pending revisions or `effects_pending`.
It selects metadata with row locks and skips locked rows, advances `updated_at`, then commits before
rendering. This rotates failed or deferred rows behind unattempted work without changing revisions
or bytes. It repairs projection after queue loss, worker failure or failed rendering.

Inline tag names longer than the tag model's limit remain literal document text and create no tag
or assignment. Invalid markers must not roll back accepted content projection. Other projection
failures preserve the pending revision for retry.

## Content writes and lifecycle barriers

`live.load_live_document` returns checkpoint plus verified tail under the caller's document lock. A
lost or replaced epoch yields its provable surviving prefix, and the next staged write moves the
document to a fresh epoch in the same transaction. Rows without an epoch read PostgreSQL alone, so
documents that were never buffered keep working through a Valkey outage. Anything else that cannot
be verified raises `LiveStateUnavailable`, a `core.errors.UnavailableError` that maps to
UNAVAILABLE: the write commits nothing and the caller keeps its content. Barriers stage into the
caller's transaction and never commit. They return an after-commit step that trims the covered
tail, publishes progress and, where content changed, enqueues projection. A failed after-commit step
is left to maintenance and recovery.

A plain markdown write (task or event description, note content, agent tools) onto a document with
a snapshot row merges into live state through `live.stage_text_merge`. Under the document lock it
three-way merges the column text the writer saw, the current live Y.Text (buffered and unprojected
edits included) and the submitted text: live edits outside the writer's changed regions survive,
live-only text is never deleted, overlapping changes keep both. The merged text is grafted into
Y.Text with minimal edits and `markdown_mirror.active=false`. The grafted bytes commit as the
checkpoint covering the buffered tail, revision advances with `rendered_revision = revision`,
`actor_id` is the writer, and the domain column stores the merged text in the same transaction.
After commit the tail is trimmed, progress lets a peer with accepted-only receipts show Saved, and
`publish_content_replace` makes resident replicas reload. Callers return the merged row, so
indexing, references, mentions and inline tags run on it. Same-generation client updates stay valid
afterwards. Without a snapshot row the column write stands and a cold open hydrates from it. Above
256 KB, diff work uses common prefix/suffix bounds. Concurrent inserted text still survives, and
unchanged CRDT items keep identity. A write with no concurrent change uses submitted text.

Notes given `expected_content_version` reject a content write while accepted edits, buffered ones
included, have not reached the domain column yet (`has_unprojected_content`). `UpdateNoteRequest`
carries the field and the agent tool always sends it. Metadata-only writes retain generation and
graft nothing into their document.

`lifecycle.stage_replacement` mints a fresh generation from the staged domain columns, without an
epoch, in one transaction under the document lock; canvas content uses it. The old generation's
buffer keys retire after commit. Stale clients cannot replay old-generation bytes into the
replacement. `stage_trash` folds the buffered tail into the checkpoint before trash, without
projection or effects; an unverifiable tail fails retryably. `stage_restore` publishes progress and
enqueues projection when retained edits are unrendered. `stage_hard_delete` deletes the row in the
caller's transaction and retires the keys afterwards. Later appends find no control record and no
row to start an epoch on. Note trash, restore and purge, task and project deletion, calendar
deletion and withdrawal, and recurrence copies all go through these barriers or live reads.

Rename propagation (`search/rename.py` over `core/realtime/rename.py`) finds candidates through
outgoing references and the buffer's due index, so a label only a pending edit holds is found. It
locks batches of 100 documents in deterministic order, one transaction each, and renames each
document in a savepoint. Labels graft into live Y.Text and canvas text as a checkpoint covering the
tail, without changing generation; projection follows. A document whose live state cannot be
verified keeps its old label and is counted and logged. Publish after commit wakes resident caches.

## Authorization

The permission model is defined in `permissions.md`. Active organization membership and live
content access are required. Tasks inherit a live project policy. Calendar overrides retain the
master's private-detail floor while resolving addressed-row grants and attendees. Recurring masters
and synthetic occurrences do not attach.

Upgrade validates Origin, access-token type, token organization, user and session revocation facts,
and active membership. Web passes bearer in `Sec-WebSocket-Protocol` alongside
`uniffy.realtime.v2`; server selects that canonical protocol, or on a refusal of a client that lacks
it the first protocol offered. Mobile passes Authorization. Never echo bearer data through the
selected protocol.
`core/auth/revocation.py` reads account status/token version and session ownership/revocation from
PostgreSQL in one fresh query. RPC and asset authentication use the same check. Valkey markers are
not evidence of validity. Missing or revoked session rows deny access; database failures produce
retryable unavailable responses. Live sockets repeat the durable check through their 30-second
watchdog.

Fresh PostgreSQL authorization runs at inbound document handling, admission and outbound
disclosure; a type 6 frame takes its inbound read from admission. Scalar statement structures are reused with bound actor, resource and check-time values.
Outbound frames and content hints coalesce waiting recipients into fresh batches of at most 256
requests, with eight concurrent batches and 4096 pending recipients per process and delivery class.
Each batch seals before database I/O. Later requests start a separate read, even while an earlier
read is running. Results are never retained across disclosures. Notes and tasks select policy fields
without content blobs; calendar batches retain addressed-row attendees, blocks and master privacy.
The watchdog checks connection lifetime and document permissions. Expiry and lost PubSub must not
leave cached `can_edit` as authority. Close database contexts before seed-election work opens
another one, to avoid connection-pool starvation. Permission revoked after acceptance stops further
writes and disclosure; edits already accepted still checkpoint.

Document denial detaches only that handle and tombstones its subscription. Other documents on the
socket continue. Read-only downgrade suppresses writes and updates editor affordances on web and
mobile. Connection-wide failures still close the socket.

Transient authorization failures stop disclosure and close the connection for retry. Never turn
an infrastructure exception into a permanent document denial or continue using a cached allow.

## Web local recovery and lifecycle

`features/realtime/hooks/useDocSession.ts` owns Y.Doc, awareness, local recovery and attachment.
`whenSynced` waits for server synchronization and local hydration. Rich and Markdown editors remain
read-only until their binding is initialized. Never seed from a placeholder before this gate.

Encrypted IDB uses database `uniffy-realtime-yjs`, version 4, with one `updates` store keyed
`[contentType, contentId, generation, seq]`. Each row is AES-GCM over a small JSON header followed
by the raw update bytes, so no base64 or JSON encoding touches the update; opening version 4 drops
rows of the earlier layout. Rows carry encrypted user, organization and document scope and come in
two kinds. A snapshot row holds a full encoded document and `dirty`, keyed by a
random per-attach epoch and counter. A pending row (`pending:<updateId>`) holds one own update's raw
bytes, edit time and receipt identity until a checkpoint covers it. Rows of no known kind and keys
without a generation predate coverage identity: they are ignored, never replayed, listed as drafts
or drained. Recovery requires initialized Web Crypto; plain HTTP on host.docker.internal cannot
validate encrypted recovery. A failed database open is not cached, so a later read retries.

`linkRecovery` joins local recovery to the transport on attach. Every coverage transition writes or
deletes a pending row; only a checkpointed transition deletes one. After hydration, `restorePending`
hands back the updates an earlier session left unconfirmed, under their original ids and receipts.
Snapshot writes coalesce while storage is busy and replace earlier rows of the same epoch only.
While edits continue, a full snapshot goes at most every two seconds (`SNAPSHOT_INTERVAL_MS`); a
flush, pagehide, a hidden tab, close and compaction write one at once. Between snapshots each
transport batch's pending row holds its edits: once it lands and the transport has nothing unsent,
those edits count as stored on the device. Other tabs retain their own rows. Each persistence
session also claims, through Web Locks (`claimDocumentRows`), the writers whose rows it reads,
writes or adopts, until its close has written them; a session never replays rows a live session in
another tab still claims. When a tab closes with pending rows, an open editor in another tab adopts
them under their original ids and shows their original edit times, so Saving delayed can appear for
edits that tab never typed.

Online hydration replays only the generation the server confirmed. Offline hydration replays a
single known lineage; ambiguous lineages wait for server identity. Other generations and
`recovery:` lineages never hydrate automatically, offline included. They stay available through the
recovered-draft UI, including raw update export. Never delete an incompatible draft just because it
cannot be replayed automatically. Per-row decrypt failure skips that row without clearing others.

`dirty` marks a snapshot holding own content that no checkpoint is known to cover. A persisted-origin
transaction sets it when it changes the content projection (Y.Text plus non-empty fragment blocks,
or any non-metadata root). Seed, duplicate cleanup, mirror and markdown-to-rich rebuild writes never
set it; neither do editor normalizations. A snapshot taken while a checkpoint covers every own edit
is written clean. `readRecoveredDrafts` lists another lineage only when a row decrypts, is pending
or dirty, and holds text or fragment content; Discard deletes that lineage's rows. First DEK
generation wipes the registered databases, so undecryptable rows never accumulate.

`resolveCloseDisposal` counts a close as checkpointed only with completed hydration, server sync,
connected transport and no checkpoint-pending own edit, and never after a generation mismatch or a
denial. Any close code leaves the transport status not connected until the next `connected`. A
checkpointed close compacts rows into a cache, or deletes them for sessions that set
`discardLocalOnCleanClose`, and clears the drain entry. Any other close keeps uncheckpointed rows
and hands the document to the drain. A session that made no local update and hydrated no row writes
nothing on close. Compaction, unload and disposal await pending writes. A fresh attachment waits for
the preceding disposal. Registered databases close and await pending writes before deletion.

`quarantine()` copies the whole document into a fresh `recovery:` lineage and moves its pending rows
out of the live generation. It runs on `seed_conflict`, which then starts a fresh authoritative
session; on a write denial while own edits are unaccepted or oversized (`denialRetainsDraft`); and
when a read-only reopen hydrates unsent edits (`hydrationRetainsDraft`). Edits the server accepted
before a denial are no draft: they still checkpoint. A `no view access` or `access revoked` denial
runs `settleLostAccess` instead, in a live session and in a drain alike. With an edit the server
never accepted, or one the transport still holds, the whole document first moves to a `recovery:`
draft; otherwise this session's accepted pending rows and the snapshots it wrote or hydrated of the
live lineage are deleted, because the server keeps what it accepted. After it nothing more is written
for the document and nothing is handed to the drain. Failed encrypted storage keeps a user-scoped
in-memory copy for the current tab. Restore keeps the source until explicit Discard.

Unload rule: each persistence session registers one `beforeunload` handler. It flushes and warns
only while some own edit is neither stored on this device nor covered by a checkpoint. Accepted
edits already on the device never prompt. Drain registry entries never prompt either, because they
are written only after their rows land.

`pendingDocs.ts` keeps a localStorage registry of content type, id, organization, user and discard
policy. A storage write records the document while its session holds uncheckpointed work, and close
hands it off again. `drain.ts` gives each entry a headless Y.Doc, with no presence and no seed
claim, and hydrates it from IDB before attaching, so the attaching SyncStep1 carries what the
device holds and the server answers only the difference. A single stored lineage also goes to the
multiplexer as `heldGeneration`, so a server generation that differs is a mismatch; rows of more
than one lineage wait for the server's generation and hydrate on sync. Hydration hands unconfirmed
updates back to the transport. A drain finishes as:

- drained once no own edit is checkpoint pending: close as checkpointed, discard per policy, drop
  the entry;
- retained on a write denial or generation mismatch: unaccepted edits move to a recovery lineage,
  accepted rows stay because they still checkpoint, and the entry is dropped. A view denial
  settles lost access as above;
- retry on close 4401, 4403 or 4410, or when an editor takes over: rows and entry wait for the next
  trigger;
- retry with backoff when 60 s pass without a checkpoint or hydration fails: the document's next
  attach waits 1 minute, doubling up to 15 minutes. Opening its editor or the `online` event clears
  the wait; a drained or retained finish forgets it.

Acceptance alone never drains. `useRealtimeDrain`, mounted in `ProtectedRoute`, rebuilds the
registry from stored rows on mount and when encryption becomes ready; that discovery skips
`recovery:` lineages, which wait for the user. It kicks drains on mount, `online`, auth refresh,
registry changes and every 30 seconds. A kick skips documents an editor holds and documents still
waiting out their backoff. Across tabs of one origin, `documentLocks.ts` uses Web Locks: an open
editor holds `uniffy:realtime:<docName>` shared from attach until its close has written its rows,
and a drain runs only when it takes that lock exclusively at once, finishing `held` otherwise. So no
tab replays the rows of an editor or a drain in another tab, and the per-writer row claims above
keep a reconnecting editor from replaying another tab's live rows. Plain HTTP origins have no Web Locks;
there a tab skips only its own editors and the server's deduplication keeps the data right. Opening
an editor cancels its drain before attaching, including one still waiting for its lock, and waits
for prior persistence disposal.

Sign-out: `useSignOut` returns false without signing out while any editable attached document is
checkpoint pending, the registry holds an entry for the user, or stored pending or dirty rows exist
for the user; it scans storage and then rechecks live state. Callers confirm with "Discard and sign
out" and call again with `discardUnsynced`, which clears the user's registry entries before
`teardownStorageEncryption`.

## Persistence chip

Every live editor shows a chip: `RealtimeSessionStatus` in the note header and `ExpandableEditor`
for task and event descriptions, expanded and after Done. `RealtimeStatusBadge` takes the first
match:

1. Alerts: Edit not synced, View-only - edit access removed, Access lost, Session ended - reload,
   Reload to keep saving.
2. Not saved on device: a device write failed while a save state other than Saved shows.
3. Connection: Connecting, or Offline for a disconnected or offline transport. The Offline title
   promises a device copy only when storage is available.
4. Save state from `useDocSaveState`: Saving unavailable, then Saving delayed (oldest uncheckpointed
   own edit thirty seconds old, once coverage is known, so a reconnect that missed a checkpoint never
   flashes it), then Syncing (transport pending, held one second after it settles), then nothing
   until coverage is known, then Synced (accepted, awaiting checkpoint) or Saved.

On web, coverage is known once this socket's type 13 arrived and local recovery has read the device.
Viewers get no save state. Only checkpoint coverage (12, 13 or 7) reaches Saved; a receipt stops at
Synced. No toast or flash per batch, and product copy never names Valkey, epochs or sequences.

`ExpandableEditor` owns realtime while expanded. After Done (`canReleaseSession`) it holds the
session while own edits are unaccepted, the transport is down, or accepted edits are not stored on
the device; otherwise the drain takes over. It reads narrow values (`useCheckpointPending`,
`useDeviceStorage`, and `useSessionReleasable` only while closing), so typing does not re-render the
editor tree on every batch, and its toolbar chip shows only the colored dot on phone widths. Access loss and rejection release at once. While the
document is checkpoint pending or in the registry, the collapsed editor shows the chip. Its host
must suppress full-string RPC content writes once realtime owns the session. Task/calendar preview
slices remember superseded visible strings to avoid reverting on stale metadata responses; an equal
or unseen peer value releases protection. This is text-based reconciliation, not a server revision
watermark. Recurring masters and synthetic occurrences keep scoped ordinary updates and explain
that descriptions save on Done after scope selection. A generation change keeps the overlay on the
new session with a quiet inline notice; it never flashes the open-time text under "Connecting...".

`useMarkdownDocSession` supplies identity awareness, rich-editor undo and read-only transport state.
`RealtimeSessionStatus` shows presence, the chip and recoverable drafts at phone widths too.

## Text bindings and seeding

`CrepeEditor` binds y-prosemirror, cursor and undo plugins to the shared fragment. Each rich writer
mirrors its own local fragment mutations onto Y.Text synchronously, so one transport batch carries
the fragment change and its Markdown projection even if that writer disappears. Every non-read-only
rich editor advertises `markdownEditor` in awareness. The leader is the one with the lowest awareness
client ID among them (`isMarkdownMirrorLeader`). Only the leader projects external Y.Text changes
into the fragment and flushes idle mirrors; a second projection of the same text duplicates it.
Mirror writes set `markdown_mirror.active=true`; text clients and server merges set it false. This
flag is only a cold-start hint. Live classification uses transaction origins and never the shared
boolean.

`MarkdownReconciler` treats a Y.Text change as pending external text only when the fragment does not
already render it: the serialized fragment equals the text, or the text parses and serializes to
the same Markdown. A rich peer's own mirror write is therefore never external, even though
Milkdown's serializer keeps a trailing space its parser drops. The leader merges the pending base,
its serialized rich content and the incoming text (`mergeMarkdownEdits`). The incoming text leaves
out the Y.Text insertions of every client whose same transaction also changed the fragment. Two rich
writers appending at the end of the document anchor to the same character of Y.Text, which then
orders their keystrokes by client instead of by paragraph, while the fragment keeps each paragraph
its own type; their edits therefore come from the fragment alone. The leader keeps fragment blocks
that read the same after a Markdown round trip, leaves a fragment that already reads as the merge
untouched, and writes fragment and mirror in one `HYDRATION_ORIGIN` transaction. The mirror repair
goes in separate small edits, so a concurrent writer's anchors survive. While external text awaits projection, a non-leader mirrors only its own keystroke
onto that text and never projects; its leave flush writes nothing. A peer projection that makes the
fragment match clears the pending base. Reconciliation runs in a microtask after external text.
Idle mirror flushes run 250 ms after the last change with a two-second maximum. Leave flush on
pagehide and dispose is synchronous. Projection uses y-prosemirror's incremental update without
deleting the fragment first, preserving unchanged nodes and relative cursor positions. Bounded diff
preserves both insertions.

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

Fragment initialization uses a PostgreSQL seed lease (45 seconds) shared by replicas. Only clients
advertising seed capability enter election; mobile, Markdown and drains never claim leases.
Initialized fragments skip election. A rich editor stops initialization after sixty seconds and
offers Retry while retaining read-only content. Peers cannot extend a suspended owner's lease by
polling. Server timer retries election at lease expiry without waiting for client traffic. Release
removes handles before optional database election; election failure cannot interrupt other handle
cleanup. Waiting editors explain initialization and remain read-only.

Web builds each seed proposal in an isolated Y.Doc. Type 8 carries the lease token and source text.
Proposal cannot mutate source text. Seed metadata records client ID, original top-level clocks and
SHA-256 hashes of original content. Duplicate checks also understand stored raw content from earlier
snapshots. Duplicate cleanup may remove only an unchanged original seed block. User edits inside that
block must survive.

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
calculate peer paint through shared identity color utilities. Canvas edits take the same admission,
checkpoint and replacement paths as markdown notes; no text RPC merge applies.

## Mobile

Generic transport and lifecycle live in `src/mobile/src/shared/realtime/`; note bindings live in
`features/notes/realtime/`. Mobile has no web UndoManager or caret broadcasting. `lib0/webcrypto`
uses its Metro shim. Keep wire behavior, generation checks, coverage handling and document denial
aligned with web.

Coverage is known once this socket's type 13 arrived for the current generation; socket cleanup
clears it, and the chip shows Connecting until then. `PersistenceChip` runs on the note screen.
`persistenceState` takes the first match: Access lost, Session ended, Update to keep saving,
View-only for lost edit access, Edit not synced, Not saved on device (a device write failed before
first sync or while an edit is checkpoint pending), Offline, View-only for read-only, Saving
unavailable, Saving delayed (once coverage is known), Syncing (held one second), Connecting, Synced,
Saved. Mobile task and event descriptions save through ordinary RPC with an explicit Save button and
keep that indicator.

Draft payloads use AES-256-GCM ciphertext in per-user Expo SQLite databases. SecureStore holds the
device-only key. AAD binds user/organization/document key, record ID and generation. Fresh nonces come
from expo-crypto. WAL and FULL synchronous commits publish a replacement and retire its predecessors
in one transaction. Per-user transaction serialization also bounds concurrent document writers.
SecureStore chunked drafts stay readable. A same-generation save merges readable source bytes, commits
the encrypted replacement, then retires old chunk records. Unreadable chunks and ciphertext remain
recoverable records; a missing key never silently resets a populated database.

An `updates` table keeps every own update from its first local event until a checkpoint covers it
or view access is lost; a receipt changes nothing on the device. After sync a session or drain
replays every retained update of the server's generation under its original id. A generation keeps
its draft while any of its updates is retained. A `no view access` or `access revoked` denial runs
`settleLostAccess` for the generation. When this socket's coverage is known and nothing is transport
pending, the server holds every own update, so the generation's records and retained updates are
deleted; otherwise they move whole to a `recovery:` lineage that stays a recovered draft. Neither a
session nor a drain saves or replays the document afterwards.

Same-generation saves merge prior raw bytes before replacing records, even if current session has
not hydrated. Serialize recovery reads with writes so a writer cannot remove chunks under an active
reader. Failed reads retain source records. Other generations remain separate recoverable drafts.
Pre-sync full text uses its own unmerged lineage, never the active server generation. Load these
lineages before socket sync and hydrate the newest compatible draft only while the input still
equals its loaded base. At sync, replay only when the server still matches that base or already
contains the draft. Changed bases remain for explicit recovery. Retire the exact text record only
after the merged causal snapshot is stored; a later edit in the same lineage must survive.
Known-generation bytes merge only after server sync. Never persist an empty-generation document.
View-only sessions never merge local draft bytes into live content. Recovery inserts after current
text and keeps its source until Discard. Reads, writes and deletion share the storage queue. Resumed
bindings carry the actual input base across detach and retire pre-sync copies only after successful
preservation.

A close is clean when the session is synced, connected, not read-only, not denied and has no
checkpoint-pending edit; a clean close discards that generation's device copy. Otherwise a dirty
session saves its draft and the drain finishes the work. Drains run per stored draft on mount,
foreground, connectivity regained, every 30 seconds and after each stored save of a closed editor,
and skip `unmerged:` and `recovery:` lineages. A drain hydrates a single stored lineage before
attaching and passes it as `heldGeneration`; drafts of several lineages wait for the server's
generation. It ends once no own edit is checkpoint pending, then discards the generation. A drain
that sees no checkpoint within 60 seconds, a write denial, a generation mismatch or a failed replay
ends and backs off the document: 1 minute, doubling up to 15 minutes, cleared by opening its editor
or by regained connectivity. A view denial settles lost access as above.

Sign-out goes through `useSignOut`. `settleUnsyncedEdits` flushes batches and waits up to 15 seconds
for attached documents to checkpoint, then reports whether any stored draft is more than a cache of
an open, fully checkpointed document. If so the user confirms ("Unsaved edits") before
`logout({ discardUnsynced: true })`. Sign-out stops drains and deletes the user's drafts, SQLite
database and key.

`useNoteCoEditing` is a thin wrapper over `createTextBinding` (`textBinding.ts`). The binding
keeps the text the native input grew from together with the remote delta that text has not seen;
applying the pending delta to the base always yields the doc. Local input is diffed against that
base and rebased through the pending delta; the pending delta is rebased through the local change
in return. Remote `Y.Text` events are recorded as retain/insert/delete deltas (`textDelta.ts`),
refined against the pre-event text when a peer rewrites a span as one replace, and composed into
every pending delta. Caret and local indices map through those deltas, never through one
prefix/suffix diff. A local insert and the caret stay before a peer insert at the same index. Local
input reaches the Y.Doc after a 120 ms debounce, flushed at once when the app goes to the
background or inactive.

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
ownership, with no checkpoint-pending local work, no drain entry and no generation reset. Disable
the realtime attachment for that editing session and report `realtimeOwned: false` on Done so the
host saves through ConnectRPC. Do not switch a live editor to whole-document RPC writes when its
socket disconnects. Reverse proxies must forward WebSocket upgrades and subprotocol headers on
`/api/realtime`.

Web and mobile reconnect delays include jitter. Mobile proxy close code 1000 reconnects while docs
remain attached; explicit teardown does not. Mobile reconnect clears server read-only latches while
retaining caller-requested read-only mode.
Draft storage coalesces queued same-generation writes and preserves unreadable source records.
An in-progress write finishes before the next queued write. A queued write encodes its document once
when it runs (`saveDraft`), so saves while a write is in flight cost nothing; a caller that destroys
the document right after saving uses `saveDraftNow`. Encryption and SQLite blob writes still cost
work proportional to document size. Physical-device latency and crash
qualification remain required before claiming large-draft readiness.
