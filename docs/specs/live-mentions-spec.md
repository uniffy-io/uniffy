# Live Content Mentions - Product Requirements Document

> Status: Draft
> Author: AI-assisted brainstorm
> Date: 2026-03-16
> Domain: Core platform feature (extends `MentionChip` system)

---

## 1. Overview

Live Content Mentions upgrade the existing `[[[label|urn]]]` mention chip system from static labels to **real-time, context-aware previews**. When a piece of content is mentioned anywhere in Uniffy (chat, notes, comments, search results), the `MentionChip` shows the content's **current state** - not a snapshot from when it was mentioned.

This is an app-wide platform feature that applies everywhere mentions appear: chat messages, note bodies, comment threads, search results, sharing dialogs, and the channel resource panel.

---

## 2. Why This Matters

Uniffy's competitors (Slack, Teams, Notion) display content references as static unfurls or plain links. When you paste a Jira ticket link in Slack, it shows a snapshot. If the ticket status changes, the unfurl is stale.

Because Uniffy owns all the content, every mention can be a **live window** into the current state. This is impossible for competitors who rely on external integrations.

---

## 3. Live State by Content Type

### 3.1 What "Live" Means Per Type

| URN Type | Static (current) | Live (new) |
|----------|-----------------|-----------|
| **NOTE** | Icon + title | Icon + title + "Last edited 2m ago by Jane" + first 200 chars preview on hover. **Editing indicator**: if someone is currently editing, show `pencil` pulse icon + "{name} is editing" |
| **TASK** | Icon + title | Icon + title + **status pill** (`open` / `in-progress` / `done`) that updates in real-time. Completion strike-through animation when task is marked done. **Due date**: "Due tomorrow" / "Overdue by 3 days" with color coding |
| **PROJECT** | Icon + name | Icon + name + **progress bar** (e.g., "12/20 tasks - 60%") that updates as tasks are completed. Status pill (`active` / `completed` / `on-hold`) |
| **CALENDAR_EVENT** | Icon + title | Icon + title + **temporal context**: "In 30 minutes" / "Happening now" (pulsing dot) / "Ended 2 hours ago" / "Tomorrow at 2:00 PM". Live countdown when event is approaching |
| **FILE** | Icon + filename | Icon + filename + **processing status**: "Processing..." spinner while background jobs run (thumbnail generation, text extraction). Shows size + type after processing. **Version**: "Updated 5m ago" if recently modified |
| **USER** | Avatar + name | Avatar + name + **presence dot** (online/away/dnd/offline) from the presence system. Already partially implemented via `showPresence` on `SubjectAvatar` |
| **GROUP** | Icon + name | Icon + name + **member count** ("12 members") |
| **CHAT** | Icon + channel name | Icon + channel name + **unread indicator** if the current user has unread messages in that channel. **Member count** on hover |

### 3.2 Hover Preview Card

On hover (desktop) or long-press (mobile), the `MentionChip` expands into a rich preview card:

```
+------------------------------------------+
| [note icon]  Architecture Decision Recs  |
+------------------------------------------+
| Last edited by Jane Smith, 2 minutes ago |
|                                          |
| This document outlines the key           |
| architectural decisions for the new...   |
|                                          |
| [Open]  [Copy link]  [Bookmark]          |
+------------------------------------------+
```

**Preview card styling:**
- Container: `w-[320px] bg-card border border-border rounded-xl shadow-xl p-0 overflow-hidden`
- Header: `flex items-center gap-2 px-4 py-3 border-b border-border` with URN type icon and title
- Body: `px-4 py-3 text-sm text-muted-foreground` with content preview (first 200 chars for notes, details for tasks/events)
- Footer: `flex items-center gap-2 px-4 py-2 border-t border-border` with action buttons (ghost variant)
- Appears after 300ms hover delay (prevents flicker on mouse pass-through)
- Portal-rendered to avoid overflow clipping

**Preview card content by type:**

| Type | Header | Body | Footer actions |
|------|--------|------|---------------|
| NOTE | Icon + title + edited-by | Content preview (200 chars, markdown stripped) | Open, Copy link, Bookmark |
| TASK | Icon + title + status pill | Description preview + assignee + due date | Open, Copy link, Mark done/reopen |
| PROJECT | Icon + name + status | Progress bar + task counts + recent activity | Open, Copy link |
| CALENDAR_EVENT | Icon + title + temporal | Date/time, location, attendee avatars | Open, RSVP (if attendee), Copy link |
| FILE | Icon + filename + meta | Thumbnail preview (if image/PDF), size, type | Open, Download, Copy link |
| USER | Avatar + name + presence | Email, role, last active | View profile, Send DM |
| GROUP | Icon + name + member count | Description, member avatars (stack) | View group |
| CHAT | Icon + channel name | Topic/description, member count, unread | Open channel, Copy link |

---

## 4. Architecture

### 4.1 Data Flow

Live mentions need two things:
1. **Initial state fetch** - resolve current state of mentioned content when rendering
2. **Real-time updates** - push state changes to the UI when the underlying content changes

### 4.2 Initial State: Batch Resolution RPC

When a view renders (a chat message list, a note body, a search result), it collects all URNs from visible `MentionChip` components and fetches their current state in a single batch call.

**New RPC** in a shared content service (or extend the existing `search.v1.SearchService`):

```protobuf
rpc ResolveMentions(ResolveMentionsRequest) returns (ResolveMentionsResponse)

message ResolveMentionsRequest {
    string organization_id = 1;
    repeated string urns = 2;  // max 100 per request
}

message ResolveMentionsResponse {
    map<string, MentionState> states = 1;
}

message MentionState {
    string urn = 1;
    string title = 2;                          // current title/name
    string status = 3;                         // content-type-specific status string
    google.protobuf.Timestamp updated_at = 4;  // last modification
    string updated_by_name = 5;                // who last modified
    string preview = 6;                        // first 200 chars (notes) or description (tasks)
    map<string, string> extra = 7;             // type-specific fields (progress, due_date, event_time, etc.)
}
```

**Backend implementation:**
- Dispatch by content type (parse URN -> ContentType -> appropriate Operations class)
- Use `BaseContentOperations.get_by_id()` for permission-checked access
- If user doesn't have VIEW permission on a URN, return a redacted `MentionState` with title = "Private content" and no preview
- Cacheable in Valkey with short TTL (30s) to reduce DB load for frequently-mentioned content

### 4.3 Real-Time Updates: Valkey Pub/Sub

When content is modified, the domain operation publishes an update event:

**New Valkey channel:** `mentions:{org_id}`

**Published on:**
- Note updated (title, content)
- Task status changed, assignee changed, due date changed
- Project progress changed (task completed/reopened)
- Calendar event time changed, RSVP changed
- File processing completed, file renamed
- User presence changed (already handled by presence system)

**Event payload:**
```json
{
    "_type": "mention_state_changed",
    "urn": "urn:uniffy:content:TASK:uuid",
    "changes": {
        "status": "done",
        "title": "Fix auth bug"
    }
}
```

**Delivery:** Via the existing `StreamNotifications` handler - subscribe to `mentions:{org_id}` alongside `notifications:{user_id}` and `presence:{org_id}`. New event type: `EVENT_TYPE_MENTION_STATE_CHANGED`.

The frontend `MentionChip` component listens for these events and re-renders when the URN it displays receives an update.

### 4.4 Performance Considerations

| Concern | Mitigation |
|---------|-----------|
| **Too many ResolveMentions calls** | Batch and debounce (200ms). Collect all visible URNs, deduplicate, single RPC. Re-fetch only on scroll revealing new chips. |
| **Too many pub/sub events** | Only publish on meaningful state changes (not every keystroke in a note). Debounce note edits to publish at most once per 10 seconds. |
| **Large channels with many mentions** | Only resolve URNs for messages currently in the viewport (intersection observer). As user scrolls, resolve newly visible URNs. |
| **Valkey memory for mention channel** | `mentions:{org_id}` is a pub/sub channel (no storage). Events are ephemeral - if a client misses one, the next `ResolveMentions` call picks up the current state. |
| **Permission checks on batch resolve** | Cache permission results per session (user+org). Most mentions in a channel are for content the user already has access to. |

---

## 5. Frontend Architecture

### 5.1 MentionChip Enhancement

The existing `MentionChip` component (`src/ui/src/features/notes/components/editor/plugins/mention/MentionChip.tsx`) is extended:

**Current behavior:**
- Parses URN from `[[[label|urn]]]`
- Renders static label with URN type icon and color
- Click navigates to content

**Enhanced behavior:**
- On mount: registers URN with the `MentionStateProvider` (context)
- Reads live state from the provider (via `useMentionState(urn)` hook)
- Renders live status indicators (status pill, progress, temporal context, presence)
- Shows hover preview card on hover/long-press

### 5.2 MentionStateProvider

A React context provider that manages batch resolution and real-time updates for all visible mentions:

```
src/ui/src/shared/providers/
|-- MentionStateProvider.tsx    # Context provider
|-- useMentionState.ts          # Hook: get live state for a URN
|-- useMentionBatchResolver.ts  # Hook: batch resolution logic
```

**Mounted in:** `MainLayout` (app-wide, not per-feature)

**How it works:**
1. `MentionChip` components register their URNs via `useMentionState(urn)`
2. The provider collects registered URNs, debounces 200ms, calls `ResolveMentions` RPC
3. Results are stored in a `Map<string, MentionState>` in the provider state
4. The `StreamNotifications` hook dispatches `MENTION_STATE_CHANGED` events to the provider
5. Provider updates the specific URN's state, triggering re-render of only the affected chips

### 5.3 Intersection Observer for Viewport-Aware Resolution

To avoid resolving URNs for messages scrolled off-screen:

```typescript
// MentionChip registers with IntersectionObserver
// Only URNs currently in the viewport are sent to ResolveMentions
// When a chip scrolls into view, it registers; when it scrolls out, it unregisters
// This keeps the batch size small even in channels with thousands of mentions
```

### 5.4 Redux Store

Live mention state is NOT stored in Redux (too granular, too transient). It lives in a React context (`MentionStateProvider`) that is:
- Ephemeral (not persisted)
- Scoped to the current viewport
- Updated via streaming events and batch fetches
- Cleared on navigation (stale states are re-fetched)

---

## 6. Live Indicators UX

### 6.1 Inline Status Indicators

Small, non-intrusive additions to the existing chip appearance:

**Task status pill:**
```
[task icon] Fix auth bug [done]
```
- Pill: `rounded-full px-1.5 py-0.5 text-[10px] font-medium`
- Open: `bg-blue-500/10 text-blue-600 dark:text-blue-400`
- In progress: `bg-amber-500/10 text-amber-600 dark:text-amber-400`
- Done: `bg-green-500/10 text-green-600 dark:text-green-400` + `line-through` on title
- Transition: `transition-all duration-300` when status changes (background color fade)

**Calendar temporal context:**
```
[cal icon] Sprint Review  In 30 minutes
[cal icon] Team Sync      Happening now  (pulsing green dot)
[cal icon] Retrospective  Yesterday
```
- Temporal text: `text-[10px] text-muted-foreground ml-1`
- "Happening now": `text-green-600` with pulsing dot (`animate-pulse w-1.5 h-1.5 rounded-full bg-green-500`)
- "Overdue": `text-red-600`
- Updates every minute via a lightweight interval (not per-chip, one global timer recalculates all temporal labels)

**Note editing indicator:**
```
[note icon] API Documentation  ✏️ Jane is editing
```
- Editing icon: `Pencil` 10px with `animate-pulse` in `text-primary`
- Text: `text-[10px] text-muted-foreground italic`
- Appears when note has an active editing session (via collaborative editing presence, or a simpler "last edited < 60s ago" heuristic for MVP)

**Project progress:**
```
[project icon] Backend Refactor  [======    ] 60%
```
- Mini progress bar: `w-12 h-1 rounded-full bg-muted overflow-hidden` with `bg-primary` fill
- Percentage: `text-[10px] text-muted-foreground ml-1`

**File processing:**
```
[file icon] recording.mp4  Processing...
```
- Spinner: `animate-spin w-3 h-3 text-muted-foreground`
- After processing completes: replaced with size + type

### 6.2 Animations on State Change

When a mention's state changes in real-time (e.g., a task is completed while you're reading the chat), the chip should subtly animate:

- **Task completed**: status pill fades from blue to green over 300ms, title gets strike-through with 200ms delay
- **Event starting**: temporal text transitions to "Happening now" with a fade, green dot appears with `scale-0 -> scale-100` over 200ms
- **Note updated**: brief highlight flash (`bg-primary/10` for 1s, then fades) to draw attention
- **File processing done**: spinner fades out, meta info fades in

All animations are subtle and non-disruptive. The user should notice changes without being distracted.

---

## 7. Emit Points (Backend)

Each domain operation that modifies content state publishes to `mentions:{org_id}`:

| Domain | Operation | Published fields |
|--------|-----------|-----------------|
| Notes | `update()` | `title`, `updated_at`, `updated_by_name` |
| Tasks | `update()` | `status`, `title`, `assignee`, `due_date` |
| Tasks | `move()` | `status` (if status changed) |
| Projects | task completed/reopened | `progress` (completed/total), `status` |
| Calendar | `update()` | `title`, `start_time`, `end_time`, `status` |
| Calendar | RSVP changed | `attendee_count`, `rsvp_summary` |
| Files | processing completed | `processing_status`, `mime_type`, `size` |
| Files | `rename()` | `title` (filename) |

**Debounce rule:** Note content edits are debounced to publish at most once per 10 seconds (prevents flood during active editing). Title changes publish immediately.

**Publishing:**
```python
from uniffy.core.valkey.pubsub import publish_mention_state

await publish_mention_state(
    organization_id=org_id,
    urn=note.urn,
    changes={"title": note.title, "updated_at": note.updated_at.isoformat()},
)
```

---

## 8. Privacy and Permissions

- `ResolveMentions` respects the existing permission system. If the requesting user doesn't have VIEW access to a URN, the response returns a redacted state:
  ```json
  {
      "urn": "urn:uniffy:content:NOTE:uuid",
      "title": "Private content",
      "status": "restricted",
      "preview": ""
  }
  ```
- The `MentionChip` renders restricted content as: `[lock icon] Private content` in `text-muted-foreground` with no hover preview and no click navigation
- Real-time events on `mentions:{org_id}` are broadcast to all users, but the frontend only processes events for URNs currently rendered in the viewport. The event payload contains only the changed fields (title, status) - not full content - so leaking a title change for a restricted note is acceptable. If this is a concern, the streaming handler can filter events per-user based on cached permissions (post-MVP optimization)

---

## 9. Where Live Mentions Apply

| Location | Resolution strategy | Real-time updates |
|----------|-------------------|-------------------|
| Chat messages | Viewport-aware batch resolve on scroll | Via `StreamNotifications` |
| Note body (editor) | Batch resolve on note load | Via `StreamNotifications` |
| Comment threads | Batch resolve on thread expand | Via `StreamNotifications` |
| Search results | Resolve on render (limited set) | Not needed (short-lived view) |
| Channel resource panel | Batch resolve on panel open | Via `StreamNotifications` |
| Notification panel | Resolve for visible items | Not needed (items are historical) |
| Sharing dialog | Not applicable (no content mentions) | N/A |

---

## 10. Integration with Existing Systems

### 10.1 Notifications Stream Extension

Add to `StreamNotificationEvent` event types:

```protobuf
EVENT_TYPE_MENTION_STATE_CHANGED = 4;
```

Payload carried as JSON in the event, same pattern as `EVENT_TYPE_FILE_UPDATED` and `EVENT_TYPE_PRESENCE_CHANGED`.

The notifications handler subscribes to `mentions:{org_id}` (third Valkey subscription alongside `notifications:{user_id}` and `presence:{org_id}`).

### 10.2 Existing MentionChip Component

The existing `MentionChip` in `src/ui/src/features/notes/components/editor/plugins/mention/` is refactored:

1. Move `MentionChip` to `src/ui/src/components/mention/MentionChip.tsx` (shared component, not notes-specific)
2. Keep the notes editor plugin wrapper in place, importing from the new shared location
3. Add `useMentionState(urn)` hook integration
4. Add hover preview card rendering
5. Add live status indicators per URN type

### 10.3 Cascade System

The existing cascade system (`src/uniffy/core/content/cascade.py`) handles `propagate_rename` - when content is renamed, all references update their label. Live mentions complement this: cascade updates the stored `[[[label|urn]]]` text in documents, while live mentions update the rendered display in real-time before the cascade completes.

---

## 11. MVP Scope

**In scope:**
- `ResolveMentions` batch RPC with permission checks
- `MentionStateProvider` context with viewport-aware resolution
- Live status indicators for: TASK (status pill), CALENDAR_EVENT (temporal context), USER (presence), FILE (processing status)
- Hover preview card with content summary and quick actions
- Real-time updates via `StreamNotifications` for task status changes and event time changes
- Move `MentionChip` to shared components

**Post-MVP:**
- Note editing indicator (requires collaborative editing presence)
- Project progress bar (requires project completion tracking)
- Per-user permission filtering on real-time events
- Valkey caching layer for `ResolveMentions` results
- "Stale mention" detection (content was deleted or significantly changed since mentioned)
- Mention analytics (most referenced content, trending topics)
