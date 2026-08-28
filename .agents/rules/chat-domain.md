---
paths:
  - "src/uniffy/domains/chat/**/*.py"
  - "src/uniffy/core/models/chat/**/*.py"
  - "src/proto/chat/**/*.proto"
  - "src/ui/src/features/chat/**/*.ts"
  - "src/ui/src/features/chat/**/*.tsx"
---

# Chat Domain

Channels, threads, messages, reactions, read state, streaming. Chat is one of the two highest-traffic paths in the system - every change here is held to the bar in the backend rules' "Performance-critical domains" section.

## Access model (separate from content permissions)

Chat uses **channel membership**, not `access_mode`. `ChatAccessChecker` (`domains/chat/access.py`) is the only gate:

- `check_access` (view), `require_send`, `require_elevated` (moderate).
- PUBLIC channels are open to the whole org; every other channel type requires a `ChatChannelMember` row.
- Org admins and chat domain admins bypass for **moderation** - this is one of the two deliberate exceptions to the no-admin-god-mode rule (see `permissions.md`). Do not extend it beyond chat.
- Chat-adjacent content (attachments on messages, calls) delegates to `ChatAccessChecker`, never to the generic `PermissionChecker`.

## Streaming events

- Channel-scoped event types MUST be listed in `_CHANNEL_EVENT_TYPES` (`domains/chat/streaming/handlers.py`) or subscribers silently never receive them. Adding a new event type without updating that set is the known failure mode (it broke CALL_* events once).
- `CALL_*` events ride the chat user-stream; the calls rule (`calls-domain.md`) owns their semantics.
- A stream reconnect must be able to resync any state the events carry (snapshot RPC), because events during the gap are lost.

## Performance discipline (chat-specific)

- Hot reads go through `domains/chat/cache.py` helpers (channel rows, members, pinned-message ids, DM peer lists, channel-resources head) and `domains/chat/senders.py` for profile resolution. Raw PG on these paths is a regression.
- The send pipeline fetches member ids ONCE and threads the list into publisher / indexer / notifier. Same shape for reactions and member events.
- Mention counting uses `mentioned_urns @> ARRAY[...]` against the partial GIN index - no `LIKE` scans.
- Multi-channel aggregates (unread counts) are single queries with `unnest(...)` joins, never UNION-per-channel.

## Uploads and attachments

- Chat consumes the upload engine (`uploadService`) DIRECTLY via the returned handle plus a scoped `subscribe` - NEVER the Redux upload mirror. The tray filters `context === 'chat'` out. Full engine contract: `files-domain.md`.
- Message attachments: `batch_list_attachments` shares one channel access check across a page of messages; per-message checks are the slow path.

## Frontend

- `ChatStreamProvider` owns the user-stream connection; indicator/roster state resyncs from snapshot RPCs on reconnect.
- Chat messages store Markdown with `[[[label|urn]]]` mentions like all user-editable text; chip behavior is owned by `mentions.md`.

## Key files

| File | Purpose |
|---|---|
| `src/proto/chat/v1/chat.proto` + `chat_stream.proto` | Service + stream contracts |
| `src/uniffy/domains/chat/access.py` | `ChatAccessChecker` - the single access gate |
| `src/uniffy/domains/chat/cache.py` | Valkey helpers for hot reads |
| `src/uniffy/domains/chat/streaming/handlers.py` | User-stream fanout, `_CHANNEL_EVENT_TYPES` |
| `src/uniffy/domains/chat/senders.py` | Batch user/agent profile resolution |
| `src/uniffy/core/models/chat/` | Channel, member, message, thread, reaction, read cursor models |
