# Presence System - Product Requirements Document

> Status: Draft
> Author: AI-assisted brainstorm
> Date: 2026-03-16
> Domain: `presence` (core platform feature)

---

## 1. Overview

Presence is an app-wide system that shows whether users are online, away, or offline. It is NOT a chat-specific feature - presence indicators appear everywhere users are displayed: mention chips, member lists, sharing dialogs, admin panels, comments, the SubjectAvatar component, and chat.

---

## 2. Goals

1. Show real-time user availability across the entire Uniffy workspace
2. Zero PostgreSQL writes - fully ephemeral, Valkey-only storage
3. Integrate with the existing `SubjectAvatar` component so every avatar in the app can show presence
4. Support automatic state transitions (online -> away -> offline) with manual overrides (DND)
5. Deliver presence changes in real-time via the existing notifications stream

---

## 3. Presence States

| State | Visual | Meaning | How it's set |
|-------|--------|---------|-------------|
| **Online** | Solid green dot | User has an active Uniffy session | Automatic (heartbeat received within last 2 minutes) |
| **Away** | Hollow orange dot | User is inactive | Automatic (no activity for 5 minutes) or manual |
| **Do Not Disturb** | Red dash/minus | Notifications paused | Manual (via chat DND/pause or user menu) |
| **Offline** | Hollow gray dot | User is not connected | Automatic (no heartbeat for 2+ minutes) |

State transitions:

```
[Page load] -> ONLINE
                |
                | (5 min no mouse/keyboard)
                v
              AWAY
                |
                | (activity detected)
                v
              ONLINE
                |
                | (browser tab closed / no heartbeat for 2 min)
                v
              OFFLINE

[Manual DND] -> DND (overrides ONLINE/AWAY, reverts when DND ends)
```

---

## 4. Backend Architecture

### 4.1 Valkey-Only Storage

Presence is entirely ephemeral. No database tables, no migrations, no models.

**Valkey keys:**

| Key pattern | Value | TTL | Purpose |
|-------------|-------|-----|---------|
| `presence:{org_id}:{user_id}` | JSON (see below) | 120s | Current presence state per user per org |

**Key value:**
```json
{
    "status": "online",
    "last_active": "2026-03-16T10:30:00Z",
    "client": "web"
}
```

The `client` field tracks the source (`web`, `mobile`, `desktop`) for future multi-device presence resolution (show the "best" status across devices).

### 4.2 Heartbeat Flow

```
Client (every 60s)
  -> SetPresence unary RPC (status + client type)
    -> Backend:
      1. SET presence:{org_id}:{user_id} <json> EX 120
      2. If status changed from previous value:
         PUBLISH presence:{org_id} <change_event_json>
```

- Each heartbeat resets the TTL to 120 seconds
- Only **state changes** are published to pub/sub (not every heartbeat)
- If the client disconnects without a clean signal, the key expires after 2 minutes and the user naturally goes offline

### 4.3 Offline Detection

Two approaches (use whichever is simpler to implement):

**Option A: Valkey keyspace notifications**
- Enable `notify-keyspace-events` with `Ex` flag (expired events)
- A lightweight subscriber listens on `__keyevent@0__:expired` for `presence:*` keys
- On expiry, publish an OFFLINE event to `presence:{org_id}`

**Option B: Polling in the stream handler**
- The `StreamNotifications` handler (or a dedicated presence stream) periodically checks `EXISTS presence:{org_id}:{user_id}` for users in the subscriber's view
- Simpler but slightly less real-time (depends on poll interval)

**Recommendation: Option A** - keyspace notifications are purpose-built for this and add no polling overhead.

### 4.4 Away Detection

Away is detected client-side, not server-side:

1. Frontend tracks mouse movement, keyboard input, scroll, and touch events
2. After 5 minutes of no activity, client sends `SetPresence(status=AWAY)`
3. On any activity resumption, client sends `SetPresence(status=ONLINE)`
4. The 5-minute threshold is a constant, not user-configurable (matches Slack)

### 4.5 DND Integration

When a user enables Do Not Disturb (from chat notification pause or user menu):
1. Client sends `SetPresence(status=DND)`
2. DND overrides the automatic online/away cycle
3. Heartbeats continue (to prevent TTL expiry) but maintain DND status
4. When DND ends (timer expires or manual toggle), client sends `SetPresence(status=ONLINE)`

---

## 5. Real-Time Delivery

Presence changes are delivered via the **existing `StreamNotifications`** stream. A new event type is added:

```
StreamNotificationEvent:
  - EVENT_TYPE_NEW_NOTIFICATION (existing)
  - EVENT_TYPE_HEARTBEAT (existing)
  - EVENT_TYPE_FILE_UPDATED (existing)
  - EVENT_TYPE_PRESENCE_CHANGED (new)
```

**`EVENT_TYPE_PRESENCE_CHANGED` payload:**
```json
{
    "_type": "presence_changed",
    "user_id": "uuid",
    "status": "online",
    "last_active": "2026-03-16T10:30:00Z"
}
```

**Why use the notifications stream, not a separate stream?**
- Every authenticated user already has an open `StreamNotifications` connection
- Adding a presence event type is trivial (same Valkey pub/sub infrastructure)
- Avoids an extra HTTP/2 stream per user
- The notification stream handler subscribes to both `notifications:{user_id}` and `presence:{org_id}` channels

**Fan-out consideration:** The `presence:{org_id}` channel broadcasts to ALL users in the org. For large orgs (1,000+ users), every presence change reaches every connected user. This is acceptable because:
- Only state changes are published (not heartbeats)
- In a 1,000-user org with normal activity patterns, expect ~50-100 presence changes per minute (logins, away transitions)
- Each event is <200 bytes
- If this becomes a bottleneck at extreme scale, partition into `presence:{org_id}:shard:{N}` based on user interest sets

---

## 6. Bulk Presence Query

For initial page load, member lists, and search results, a bulk RPC fetches presence for multiple users:

### 6.1 Proto

New service: `presence.v1.PresenceService`

```
rpc SetPresence(SetPresenceRequest) returns (SetPresenceResponse)
rpc GetBulkPresence(GetBulkPresenceRequest) returns (GetBulkPresenceResponse)
```

**`SetPresenceRequest`:**
```protobuf
message SetPresenceRequest {
    string organization_id = 1;
    PresenceStatus status = 2;
    string client = 3;  // "web", "mobile", "desktop"
}

enum PresenceStatus {
    PRESENCE_STATUS_UNSPECIFIED = 0;
    PRESENCE_STATUS_ONLINE = 1;
    PRESENCE_STATUS_AWAY = 2;
    PRESENCE_STATUS_DND = 3;
    PRESENCE_STATUS_OFFLINE = 4;
}
```

**`GetBulkPresenceRequest`:**
```protobuf
message GetBulkPresenceRequest {
    string organization_id = 1;
    repeated string user_ids = 2;  // max 200 per request
}

message GetBulkPresenceResponse {
    map<string, UserPresence> presence = 1;
}

message UserPresence {
    PresenceStatus status = 1;
    google.protobuf.Timestamp last_active = 2;
}
```

**Implementation:** `MGET` on Valkey keys - O(1) per user, single round-trip. Users not found in Valkey are returned as `OFFLINE`.

---

## 7. Backend Domain Structure

Presence is a thin core service, not a full domain (no database models, no complex operations):

```
src/uniffy/domains/presence/
|-- operations.py    # SetPresence, GetBulkPresence (Valkey reads/writes)
|-- handlers.py      # RPC handlers
|-- service.py       # PresenceService
|-- __init__.py
```

Mount in `factory.py`:
```python
from uniffy.domains.presence.service import PresenceServiceImpl
from uniffy.gen.presence.v1.presence_connect import PresenceServiceASGIApplication

dispatcher.add_service(
    "/presence.v1.PresenceService",
    PresenceServiceASGIApplication(PresenceServiceImpl(), interceptors=[...]),
)
```

**Notification stream extension:**

In `domains/notifications/handlers.py`, the `stream_notifications` handler adds a second Valkey subscription to `presence:{org_id}`:
- Subscribe to both `notifications:{user_id}` AND `presence:{org_id}`
- Route incoming messages by `_type` field: `"presence_changed"` -> yield `EVENT_TYPE_PRESENCE_CHANGED`
- Existing notification/file_updated events continue unchanged

---

## 8. Frontend Architecture

### 8.1 Shared Components

Presence lives in the shared components layer, not in any feature:

```
src/ui/src/components/subject/
|-- SubjectAvatar.tsx         # EXISTING - extend with presence dot
|-- PresenceIndicator.tsx     # NEW - standalone dot component
```

**`PresenceIndicator`:**
```typescript
// Small dot (6px) with status-appropriate color
// Positioned absolute on avatar corner (bottom-right)
// Sizes: sm (4px), md (6px), lg (8px) matching avatar sizes

import { PresenceIndicator } from '@/components/subject';

<PresenceIndicator status="online" size="md" />
```

**`SubjectAvatar` extension:**
```typescript
// Add optional showPresence prop (default: false)
// When true, renders PresenceIndicator on the avatar corner

<SubjectAvatar subject={user} size="md" showPresence />
```

### 8.2 Redux Store

```
src/ui/src/features/presence/
|-- store/
|   |-- presenceSlice.ts      # Record<string, PresenceStatus> state
|   |-- presenceThunks.ts     # fetchBulkPresence thunk
|-- hooks/
|   |-- usePresence.ts        # Single user presence selector
|   |-- usePresenceHeartbeat.ts  # Heartbeat + activity tracking
|   |-- useBulkPresence.ts    # Fetch presence for a list of user IDs
|-- api/
|   |-- presenceApi.ts        # ConnectRPC client
|-- index.ts
```

**Slice state:**
```typescript
{
    statuses: Record<string, PresenceStatus>;  // userId -> status
}
```

Not persisted (ephemeral by nature - refetched on app load).

### 8.3 Hooks

**`usePresence(userId: string): PresenceStatus`**
- Selector that reads from `state.presence.statuses[userId]`
- Returns `'offline'` if not found

**`usePresenceHeartbeat()`**
- Runs in `MainLayout` (app-wide, not chat-specific)
- Sends `SetPresence(ONLINE)` on mount, then every 60 seconds
- Tracks mouse/keyboard/scroll/touch events with a 5-minute idle timer
- On idle: sends `SetPresence(AWAY)`
- On activity resume: sends `SetPresence(ONLINE)`
- On unmount (tab close): sends `SetPresence(OFFLINE)` via `navigator.sendBeacon` (best-effort)

**`useBulkPresence(userIds: string[])`**
- Dispatches `fetchBulkPresence` when `userIds` changes
- Debounced (200ms) to batch rapid sequential calls (e.g., rendering a member list)
- Deduplicates against already-known statuses in the store

### 8.4 Stream Integration

The existing `useNotificationStream` hook (in `features/notifications`) is extended to handle `EVENT_TYPE_PRESENCE_CHANGED`:

```typescript
if (event.eventType === EVENT_TYPE_PRESENCE_CHANGED) {
    const { userId, status } = parsePresencePayload(event);
    dispatch(updatePresence({ userId, status }));
}
```

No new stream connection needed.

---

## 9. Where Presence Appears

Presence dots should appear on user avatars across the entire app:

| Location | Component | `showPresence` |
|----------|-----------|---------------|
| Chat sidebar DM list | `SubjectAvatar` | Yes |
| Chat channel member list | `SubjectAvatar` | Yes |
| Chat message sender avatars | `SubjectAvatar` | Yes (latest message only, not every message in history) |
| Chat typing indicator | `SubjectAvatar` | Yes |
| Sharing dialog member list | `SubjectAvatar` | Yes |
| Admin members table | `SubjectAvatar` | Yes |
| Mention chips (`[[[User|urn]]]`) | `MentionChip` | Yes (inline dot next to name) |
| Search results (USER type) | `SubjectAvatar` | Yes |
| Comments - commenter avatars | `SubjectAvatar` | Yes |
| SubjectPicker search dropdown | `SubjectAvatar` | Yes |
| User menu / profile popover | `SubjectAvatar` | Yes |
| SubjectAvatarStack (overlapping) | Individual avatars | No (too small, visual noise) |

### Performance rule:
- Only fetch presence for users currently **visible on screen**
- Do NOT fetch presence for every user in the org on app load
- Use `useBulkPresence` with the visible user IDs, triggered by component mount

---

## 10. Privacy

- Presence is **org-scoped**: users in org A cannot see presence of users in org B
- **Invisible mode** (post-MVP): user setting to appear as permanently offline to others while still being active. Stored in `SettingsProfile` JSONB. When enabled, `SetPresence` still runs (for DND coordination) but `GetBulkPresence` returns `OFFLINE` for that user

---

## 11. Settings Integration

Add to user Settings > General (or a new "Status" section):

| Setting | Options | Default |
|---------|---------|---------|
| **Show my online status** | Toggle | On |
| **Idle timeout** | 5 min / 10 min / 15 min / 30 min | 5 min |

When "Show my online status" is off, the user appears as offline to everyone (invisible mode). This is the post-MVP privacy feature mentioned in Section 10, but the settings UI slot should be reserved from v1.

---

## 12. Proto File

```
src/proto/presence/v1/presence.proto
```

This is a new proto file requiring `./run.sh proto` after creation.

---

## 13. Search Integration Checklist

Presence does NOT require search integration. There is no `ContentType` for presence, no URN, no Meilisearch indexing. Presence is purely ephemeral state.

---

## 14. MVP Scope

**In scope:**
- Online / Away / DND / Offline states
- Automatic heartbeat (60s interval, 120s TTL)
- Automatic away detection (5 min idle)
- DND integration with chat notification pause
- Real-time delivery via notifications stream
- Bulk presence query
- `PresenceIndicator` component on `SubjectAvatar`
- Presence dots in all locations listed in Section 9
- `usePresenceHeartbeat` in `MainLayout`

**Post-MVP:**
- Invisible mode (appear offline)
- Custom status text ("In a meeting", "On vacation", etc.)
- Custom status emoji
- Status expiry ("Clear after 1 hour")
- Multi-device presence resolution (show best status across web + mobile + desktop)
- Configurable idle timeout
