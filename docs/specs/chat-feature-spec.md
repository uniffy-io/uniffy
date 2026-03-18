# Chat Feature - Product Requirements Document

> Status: Draft
> Author: AI-assisted brainstorm
> Date: 2026-03-15
> Domain: `chat`

---

## 1. Overview

Uniffy Chat is a Slack-style team messaging system with channels, direct messages, Mattermost-style collapsed reply threads, reactions, file sharing, E2E encryption (optional), guest access, and deep integration with Uniffy's workspace (@ mentions, search, bookmarks, agents, attachments).

Voice and video calling is planned but explicitly out of scope for the MVP.

---

## 2. Goals

1. Provide real-time team communication within the Uniffy workspace
2. Deeply integrate with existing Uniffy content via universal @ mentions and search
3. Support Mattermost-style collapsed reply threads (CRT) for organized conversations
4. Offer optional E2E encryption per channel/DM with clear trade-off communication
5. Enable external collaboration via guest access with scoped permissions
6. Allow AI agents to participate in chat channels (non-E2E only)

---

## 3. Core Entities

### 3.1 ChatChannel

A persistent conversation container. This is the primary content entity (bookmarkable, searchable, mentionable via URN).

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `organization_id` | UUID | Org scope |
| `owner_id` | UUID | Creator |
| `name` | string | Display name (e.g., "general", "engineering") |
| `slug` | string | URL-safe identifier, unique per org |
| `description` | string (markdown) | Channel purpose/topic, supports mentions |
| `channel_type` | enum | `PUBLIC`, `PRIVATE`, `DIRECT`, `GROUP_DM` |
| `visibility` | VisibilityScope | Maps to permission system |
| `is_encrypted` | bool | E2E encryption enabled (immutable after creation) |
| `is_archived` | bool | Archived channels are read-only |
| `is_deleted` | bool | Soft delete |
| `icon` | string | Optional icon identifier |
| `last_message_at` | timestamp | Denormalized for sort performance |
| `message_count` | int | Denormalized total message count |
| `member_count` | int | Denormalized member count |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |
| `deleted_at` | timestamp | |

**URN**: `urn:uniffy:content:CHAT:{channel_id}`

**Visibility mapping:**

| Channel Type | Visibility | Access |
|-------------|-----------|--------|
| PUBLIC | ORGANIZATION | Any org member can view and join |
| PRIVATE | GROUP | Only channel members |
| DIRECT | PRIVATE | Only the two participants |
| GROUP_DM | PRIVATE | Only participants (2-8 users, no channel semantics) |

### 3.2 ChatMessage

A message within a channel. Messages are children of channels. Individual messages are indexed in search only under specific conditions (see Section 10).

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `channel_id` | UUID | FK to ChatChannel |
| `sender_id` | UUID | FK to User (or agent identity) |
| `sender_type` | enum | `USER`, `AGENT`, `SYSTEM`, `GUEST` |
| `content` | text (markdown) | Message body with `[[[label\|urn]]]` mention support |
| `root_id` | UUID (nullable) | NULL = root message; set = this is a thread reply |
| `edited_at` | timestamp (nullable) | NULL if never edited |
| `is_deleted` | bool | Soft delete (shows "This message was deleted") |
| `is_pinned` | bool | Pinned to channel |
| `metadata` | jsonb | Extensible metadata (link previews, system event data, etc.) |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |
| `deleted_at` | timestamp | |

**Thread model (Mattermost CRT style):**
- `root_id = NULL` means this is a root-level message in the channel
- `root_id = <some_message_id>` means this is a reply in a thread
- Replies are hidden from the main channel view
- The root message displays a thread footer: reply count, participant avatars, last reply time

### 3.3 ChatThread (Denormalized Cache)

Inspired by Mattermost's scaling lessons. This table caches thread metadata to avoid expensive joins/aggregations on the messages table.

| Field | Type | Description |
|-------|------|-------------|
| `root_message_id` | UUID | PK, FK to ChatMessage (the root) |
| `channel_id` | UUID | FK to ChatChannel |
| `reply_count` | int | Cached count of replies |
| `last_reply_at` | timestamp | Drives thread inbox sorting |
| `participant_ids` | UUID[] | Array of user IDs who replied (for avatar display) |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### 3.4 ChatChannelMember

Tracks channel membership and per-user read state.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `channel_id` | UUID | FK to ChatChannel |
| `user_id` | UUID | FK to User |
| `role` | enum | `OWNER`, `ADMIN`, `MEMBER` |
| `last_read_message_id` | UUID (nullable) | Last message the user has seen |
| `last_read_at` | timestamp | When user last viewed the channel |
| `notification_level` | enum | `ALL`, `MENTIONS`, `NONE` (per-channel override) |
| `is_muted` | bool | Muted channels don't trigger notifications |
| `joined_at` | timestamp | |

**Unique constraint**: `(channel_id, user_id)`

### 3.5 ChatThreadMember

Per-user thread subscription and read tracking, separate from channel-level tracking.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `root_message_id` | UUID | FK to ChatThread |
| `user_id` | UUID | FK to User |
| `following` | bool | Whether user is actively following this thread |
| `last_read_at` | timestamp | When user last viewed this thread |
| `unread_mentions` | int | Count of unread @mentions in this thread |

**Auto-follow rules:**
- User starts a thread (posts root message that gets a reply)
- User replies in a thread
- User is @mentioned in a thread
- All DMs and group DMs are auto-followed

### 3.6 ChatReaction

Emoji reactions on messages.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `message_id` | UUID | FK to ChatMessage |
| `user_id` | UUID | FK to User |
| `emoji` | string | Unicode emoji or custom emoji identifier |
| `created_at` | timestamp | |

**Unique constraint**: `(message_id, user_id, emoji)` - one reaction per emoji per user per message

### 3.7 ChatGuestAccess

Guest/external access configuration per channel.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `channel_id` | UUID | FK to ChatChannel |
| `is_enabled` | bool | Whether guest access is active |
| `access_type` | enum | `INVITE_LINK`, `PASSWORD`, `EMAIL_INVITE` |
| `invite_token` | string (nullable) | Revocable secret token for link-based access |
| `password_hash` | string (nullable) | For password-protected access |
| `max_guests` | int (nullable) | Optional guest limit |
| `expires_at` | timestamp (nullable) | Auto-disable guest access after this time |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### 3.8 ChatGuest

A guest user participating in a channel.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `channel_id` | UUID | FK to ChatChannel |
| `nickname` | string | Display name chosen by guest |
| `email` | string (nullable) | Optional, for email-invited guests |
| `auth_method` | enum | `LINK`, `PASSWORD`, `EMAIL` |
| `session_token` | string | Temporary session token |
| `is_active` | bool | Can be revoked |
| `expires_at` | timestamp | Mandatory expiry |
| `last_seen_at` | timestamp | |
| `created_at` | timestamp | |

**Guest limitations:**
- Can only access the specific channel they were invited to
- Cannot browse other channels or org content
- Cannot initiate DMs with org members
- Cannot use @mentions to reference org content (notes, files, etc.)
- Cannot add integrations or bots
- Cannot access admin or settings
- Messages tagged with `sender_type = GUEST`

---

## 4. Mattermost-Style Collapsed Reply Threads (CRT)

### 4.1 Channel View (Main Timeline)

- Shows only root-level messages (`root_id = NULL`)
- Each root message that has replies shows a **thread footer**:
  - Participant avatars (from `ChatThread.participant_ids`, max 3-4 shown)
  - Reply count (from `ChatThread.reply_count`)
  - "Last reply X ago" (from `ChatThread.last_reply_at`)
- Clicking the thread footer or "Reply" opens the thread in the **right-hand side panel (RHS)**
- New thread replies do NOT bump the root message in the channel timeline
- Channel unread state is driven by new root messages only, NOT by thread replies (unless user is following the thread)

### 4.2 Thread Side Panel (RHS)

- Opens as a right-hand panel alongside the channel (does not replace it)
- On mobile: opens as a full-screen view (drawer from right)
- On tablet: opens as a drawer overlay
- Shows the root message at the top, followed by all replies chronologically
- Reply compose box at the bottom
- Thread panel is independent - user can scroll the channel while the thread is open
- Supports the same features as the main compose: markdown, mentions, file attachments, reactions

### 4.3 Threads Inbox

A dedicated view accessible from the sidebar showing all threads the user is **following**, sorted by most recent reply activity (`ChatThread.last_reply_at DESC`).

- **All Threads**: every thread the user follows
- **Unreads filter**: only threads with unread replies
- Clicking a thread opens it in the RHS within its parent channel

### 4.4 Unread Tracking (Dual Layer)

| Level | What triggers unread | Where shown | Driven by |
|-------|---------------------|-------------|-----------|
| Channel | New root messages in channel | Channel list sidebar (bold + badge) | `ChatChannelMember.last_read_message_id` |
| Thread | New replies in a followed thread | Thread footer indicator + Threads inbox | `ChatThreadMember.last_read_at` vs `ChatThread.last_reply_at` |
| Mention | @mention of user anywhere | Badge count on channel + thread | Parsed from message content |

---

## 5. Real-Time Delivery

### 5.1 Architecture

Use ConnectRPC server streaming + Valkey pub/sub, consistent with the existing notifications and agents runtime patterns.

```
[User sends message]
  -> Unary RPC: SendMessage
    -> ChatOperations.send_message()
      -> Persist to PostgreSQL
      -> Index to Meilisearch (if not E2E encrypted)
      -> Publish to Valkey channel `chat:{channel_id}`

[Other users receive message]
  -> Server streaming RPC: StreamChannelEvents
    -> Subscribe to Valkey `chat:{channel_id}`
    -> Yield ChatEvent protos as messages arrive
    -> Heartbeat every 30s
    -> StreamDisconnectMiddleware handles cleanup
```

### 5.2 Event Types

```
ChatEvent:
  - MESSAGE_CREATED      # New message in channel or thread
  - MESSAGE_UPDATED      # Edit
  - MESSAGE_DELETED      # Deletion
  - REACTION_ADDED       # New reaction
  - REACTION_REMOVED     # Reaction removed
  - TYPING_STARTED       # User typing indicator
  - TYPING_STOPPED       # User stopped typing
  - MEMBER_JOINED        # New member joined channel
  - MEMBER_LEFT          # Member left channel
  - CHANNEL_UPDATED      # Channel metadata changed (name, topic, etc.)
  - THREAD_UPDATED       # Thread metadata changed (reply count, participants)
  - HEARTBEAT            # Keep-alive
```

### 5.3 Streaming Subscriptions

A user opens a single long-lived stream per active channel. When switching channels, the previous stream is aborted and a new one is opened.

For the Threads inbox and cross-channel unread badges, a separate user-level stream (similar to notifications) delivers lightweight unread count updates:

```
StreamUserChatEvents(request) returns (stream UserChatEvent)
  - Subscribes to Valkey `chat:user:{user_id}`
  - Events: UNREAD_COUNT_CHANGED, THREAD_ACTIVITY, MENTION_RECEIVED
```

### 5.4 Typing Indicators

- Client sends `SetTyping` unary RPC when user starts typing
- Published to Valkey `chat:{channel_id}` as a `TYPING_STARTED` event with user info
- Auto-expires after 5 seconds if no follow-up `SetTyping` call
- Frontend shows "User is typing..." below the message list

### 5.5 Performance Considerations

**ConnectRPC server streaming over HTTP/2** is the established pattern. Key considerations:

| Factor | Assessment |
|--------|-----------|
| Concurrent connections | Each user holds 1-2 open streams (channel + user-level). HTTP/2 multiplexes over a single TCP connection, so browser connection limits are not a concern. |
| Valkey pub/sub fan-out | Each subscriber gets a dedicated Valkey connection. For 1,000 concurrent users across 200 channels, this is ~1,200 Valkey connections - well within limits. |
| Message throughput | Valkey pub/sub handles 500k+ msg/s. Message persistence (PostgreSQL + Meilisearch) is the bottleneck - batch indexing helps. |
| Latency | Valkey pub/sub adds <1ms. ConnectRPC framing adds ~1ms. Total: user-to-user latency ~50-100ms including DB persistence. |
| Reconnection | Exponential backoff with jitter (1s initial, 30s max), same as notifications stream. On reconnect, client fetches missed messages via `GetMessages(since: last_seen_id)`. |
| Horizontal scaling | Valkey pub/sub works across application instances natively. No sticky sessions needed. |

**Load testing recommendation:** Before launch, benchmark with simulated load (1,000 concurrent users, 50 active channels, 10 messages/second) to validate the streaming infrastructure holds under real conditions.

---

## 6. Content Sharing and the Mention Chip System

All content shared in chat messages uses the existing **`[[[label|urn]]]` mention chip system**. Files, notes, events, tasks, projects - everything is a URN mention rendered by the `MentionChip` component. There is no separate "file attachment" or "content embed" system for chat. This is the core Uniffy principle: every piece of content is referenceable from anywhere.

### 6.1 How Content is Shared in Chat

**Sharing any content (notes, events, tasks, etc.):**
1. User types `@` in the compose box
2. Mention search popup appears (existing `MentionSearch` component)
3. User selects a note, file, event, task, project, or user
4. A `[[[label|urn:uniffy:content:TYPE:uuid]]]` mention is inserted into the message markdown
5. The `MentionChip` renders it with the appropriate URN type color, icon, and interactive preview

**Sharing files (upload flow):**
1. User drags a file into the compose box, pastes from clipboard, or clicks the attach button
2. File uploads via `FilesService` (chunked upload to user's Attachments folder)
3. `AttachmentsService.AttachFile` links the file to the chat message
4. A `[[[filename.pdf|urn:uniffy:content:FILE:uuid]]]` mention is automatically inserted into the message content
5. The `MentionChip` for FILE URNs renders with a rich preview (see Section 6.2)

This means the message `content` field is the single source of truth for all referenced content. The backend parses `[[[label|urn]]]` mentions from the content to resolve references, index for search, and track cross-content links.

### 6.2 MentionChip Rendering by URN Type

The existing `MentionChip` component already renders URN mentions as interactive preview cards. For chat, the rendering is enhanced with richer inline previews based on content type:

| URN Type | Chip rendering | Rich preview |
|----------|---------------|-------------|
| **FILE (image)** | Inline thumbnail: `rounded-lg max-w-[400px] max-h-[300px]`, click opens lightbox. Multiple images in same message render as a gallery grid (2-3 columns). |
| **FILE (video)** | Inline player with thumbnail, play button overlay, HTML5 controls. Uses media stream service worker for auth. |
| **FILE (audio)** | Inline waveform player: play/pause + waveform + duration, `max-w-[350px]` |
| **FILE (PDF)** | Card: PDF icon + filename + page count + size + "Open" button. Thumbnail preview if available. |
| **FILE (other)** | Card: typed file icon + filename + size + download button. `max-w-[350px]` |
| **NOTE** | Chip: note icon + title, themed in primary color. Hover shows preview tooltip with first 200 chars. Click navigates to note. |
| **CALENDAR_EVENT** | Chip: calendar icon + event title + date/time. Themed in rose. Click navigates to event. |
| **TASK** | Chip: task icon + title + status pill (open/done). Themed in teal. Click navigates to task. |
| **PROJECT** | Chip: project icon + name. Themed in orange. Click navigates to project. |
| **USER** | Chip: avatar + full name. Themed in emerald. Click opens profile. Shows presence dot. |
| **GROUP** | Chip: group icon + name. Themed in violet. |
| **CHAT** | Chip: hash/lock icon + channel name. Themed in violet. Click navigates to channel. |

All chips use colors from `@/config/theme/urnColors.ts` - never hardcoded.

### 6.3 Image Gallery Behavior

When a message contains multiple FILE mentions that are images, the `MentionChip` renderer detects this and switches to gallery mode:

- **2-4 images**: 2-column grid, `gap-1`, `rounded-lg overflow-hidden`
- **5+ images**: 3-column grid, first 5 shown, 6th cell shows "+N more" overlay
- Click any image: opens lightbox gallery with left/right navigation, zoom, download
- Gallery container: `max-w-[400px] my-2`

### 6.4 The Attachments System (Backend)

The existing attachments system handles the storage layer:
- `AttachmentsService.AttachFile` links a file to a chat message (content_type=CHAT_MESSAGE, content_id=message_id)
- Same file can be mentioned in multiple messages (attachments are references, not copies)
- Deleting a message does NOT delete the file (files live independently in the user's Attachments folder)
- The attachment record exists for backend reference tracking. The frontend renders purely from the `[[[label|urn]]]` mentions in the message content.

### 6.5 Paste and Drag-and-Drop

- **Paste image from clipboard**: uploads immediately, inserts FILE mention at cursor position, shows inline thumbnail preview in compose box while uploading
- **Drag-and-drop files**: drop zone activates on the entire channel view (`border-2 border-dashed border-primary/50 bg-primary/5` overlay). Uploads each file, inserts FILE mentions.
- **Paste link**: If the pasted text is a Uniffy URN path (e.g., copied from notes), auto-convert to a `[[[label|urn]]]` mention
- **Upload progress**: shown as a progress bar overlay on the thumbnail in the compose box

### 6.6 Smart Overflow (30,000 Character Limit)

When message content exceeds 30,000 characters, the compose box prompts:
- **"Create as note"**: Creates a new note with the content, inserts a `[[[Note title|urn:uniffy:content:NOTE:uuid]]]` mention in the message. The long content lives in the notes system, referenced from chat via a mention chip.
- **"Create as file"**: Saves as a `.md` file attachment, inserts a FILE mention.
- **"Trim message"**: Truncates to 30,000 characters.

This naturally flows through the mention chip system - the "overflow" content becomes a proper content entity with its own URN.

---

## 7. Channel Resource Panel

### 7.1 Overview

Every channel has a **Resources** panel - a persistent, auto-populated view of all content ever referenced in the channel. This is NOT manually curated. The panel is built automatically by tracking all `[[[label|urn]]]` mentions across every message in the channel's history.

When someone mentions a note, shares a file, references a task, or links a calendar event in conversation, it automatically appears in the channel's resource panel. Zero effort required.

### 7.2 Data Source

The backend maintains a `chat_channel_resources` table (denormalized, like `ChatThread`):

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `channel_id` | UUID | FK to ChatChannel |
| `urn` | string | The referenced content URN |
| `content_type` | ContentType | Derived from URN for fast filtering |
| `first_mentioned_at` | timestamp | When this content was first referenced |
| `last_mentioned_at` | timestamp | Most recent reference |
| `mention_count` | int | How many messages reference this content |
| `first_mentioned_by` | UUID | User who first shared it |

**Populated by**: `ChatMessageOperations.send_message()` and `update_message()` parse `[[[label|urn]]]` mentions from message content and upsert into `chat_channel_resources`. Deleting a message decrements `mention_count`; rows with `mention_count = 0` are removed.

### 7.3 UI

Accessible from the channel header via a `Folder` icon button. Opens as a right-side panel (shares the thread panel slot - one or the other visible at a time, not both).

**Panel layout:**

```
+----------------------------------+
| Resources for #engineering  [X]  |
+----------------------------------+
| [filter: All | Notes | Files |   |
|  Tasks | Events | Projects]      |
+----------------------------------+
| Notes (7)                     v  |
|   [note icon] Architecture De... |
|       Mentioned 12x, last 2h ago |
|   [note icon] Sprint Retro       |
|       Mentioned 3x, last 1d ago  |
+----------------------------------+
| Files (23)                    v  |
|   [img] screenshot.png           |
|   [pdf] deployment-guide.pdf     |
|   [doc] meeting-notes.md         |
+----------------------------------+
| Tasks (12)                    v  |
|   4 open, 8 completed            |
|   [task] Fix auth bug     [done] |
|   [task] Update docs      [open] |
+----------------------------------+
| Events (3)                    v  |
|   [cal] Sprint Review - Tomorrow |
|   [cal] Team Sync - Wed 10am    |
+----------------------------------+
```

**Panel styling:**
- Surface: `bg-card`, same width/resize behavior as thread panel
- Header: `flex items-center justify-between px-4 py-3 border-b border-border`
- Filter tabs: `flex gap-1 px-4 py-2 border-b border-border`, pill-style toggles `rounded-full px-2.5 py-1 text-xs`
- Active filter: `bg-primary/10 text-primary`
- Section headers: collapsible, `text-xs uppercase font-medium tracking-wider text-muted-foreground` with count badge
- Resource items: `px-4 py-2 hover:bg-muted/30 cursor-pointer` - click navigates to the content
- Each item shows: URN-typed icon, content title (truncated), mention frequency and recency
- Sorted by: `last_mentioned_at DESC` within each section (most recently discussed first)

**Responsive:**
- Desktop: side panel (shares slot with thread panel)
- Tablet: drawer from right
- Mobile: full-screen drawer

### 7.4 Resource Panel in E2E Channels

In E2E encrypted channels, the server cannot parse message content. The resource panel shows: "Resources are not available in encrypted channels. Content shared here is only visible in the conversation." This is listed in the E2E trade-offs (Section 8.4).

---

## 8. Smart Quick Actions

### 8.1 Overview

Any chat message can be turned into structured content with a single action. Right-click a message (or use the hover toolbar "more" menu) to access quick actions that create content pre-populated from the message context.

### 8.2 Available Actions

| Action | Icon | Creates | Pre-populated fields |
|--------|------|---------|---------------------|
| **Create task** | `CheckSquare` | Task in a project | Title: AI-extracted summary or first line. Description: quoted message with attribution. Assignee: message sender (if they volunteered, e.g., "I'll handle this"). Source: `[[[Created from #channel\|urn:CHAT:...]]]` back-reference. |
| **Add to calendar** | `CalendarPlus` | Calendar event | Title: AI-extracted event name. Date/time: AI-parsed from message ("let's meet Thursday at 2pm" -> Thursday 14:00). Attendees: channel members or mentioned users. Description: quoted message. Source back-reference. |
| **Save as note** | `NotePencil` | Note | Title: AI-extracted topic or first line. Body: message content as markdown. Source back-reference. |
| **Set reminder** | `Bell` | Calendar reminder | Linked to the message URN. Time picker prompt (in 30 min / 1 hour / tomorrow / custom). When triggered, notification navigates back to the original message in the channel. |
| **Copy as quote** | `Quotes` | Text in clipboard | Formatted as markdown blockquote with attribution: `> message content\n> - @sender in #channel, timestamp` |

### 8.3 Multi-Message Selection

Users can select a range of messages (click first, shift-click last) and apply quick actions to the entire selection:

- **Create note from messages**: All selected messages formatted as a structured document with sender attribution, timestamps, and any mentioned content preserved as URN links.
- **Extract tasks from messages**: AI agent scans selected messages and extracts action items as individual tasks. "I'll fix the auth bug" -> Task assigned to sender. "We need to update the docs by Friday" -> Task with due date.
- **Create meeting notes**: Structured document with: Attendees (unique senders in selection), Discussion (messages as bullets), Decisions (AI-extracted), Action items (AI-extracted as tasks).

Multi-select UI:
- Selection highlight: `bg-primary/5 border-l-2 border-primary`
- Floating action bar at bottom of message area: `fixed bottom-20 left-1/2 -translate-x-1/2 bg-card border border-border rounded-xl shadow-xl px-4 py-2 flex items-center gap-3`
- Shows: "{N} messages selected" + action buttons + "Cancel" (Escape)

### 8.4 Back-References

All content created from chat messages automatically includes a back-reference:

- The created content's body/description includes: `Created from conversation in [[[#channel-name|urn:uniffy:content:CHAT:channel_id]]]`
- The original message gets a subtle indicator: a small link icon with tooltip "Task created from this message" (stored in message `metadata.derived_content[]` as URN list)
- Clicking the back-reference in the note/task navigates to the original message in the channel (scroll-to + highlight)

### 8.5 AI-Powered Extraction

The "Create task" and "Add to calendar" actions use the AI agents system for smart field extraction:

- Uses a lightweight system prompt focused on extraction (not full agent conversation)
- Runs via `AgentOperations` with a dedicated extraction skill
- Extracts: titles, assignees (@mentioned users), dates/times (natural language parsing), priorities
- Falls back to manual entry if extraction confidence is low
- The extraction happens client-side in a modal where the user can review and edit before confirming

### 8.6 Quick Action Modal

When a quick action is triggered, a modal appears with pre-populated fields:

```
+------------------------------------------+
| Create Task from Message            [X]  |
+------------------------------------------+
| From: John Doe in #engineering           |
| "I'll fix the auth bug by Friday"        |
+------------------------------------------+
| Title:    [Fix the auth bug          ]   |
| Project:  [Backend Refactor      v]      |
| Assignee: [John Doe             v]       |
| Due date: [Friday, March 21     v]       |
| Priority: [Medium               v]       |
| Description:                             |
| > I'll fix the auth bug by Friday        |
| > - @John in #engineering, 10:32 AM      |
|                                          |
| Created from [#engineering]              |
+------------------------------------------+
|                    [Cancel]  [Create]     |
+------------------------------------------+
```

- Modal: standard Uniffy modal styling (`bg-card rounded-xl shadow-2xl border border-border`)
- "From" context: shows the source message as a quoted block
- Fields: pre-populated but fully editable
- Project/assignee: use existing `SubjectPicker` and project selector components
- "Created from" link: auto-inserted, non-removable

### 8.7 Frontend Components

```
src/ui/src/features/chat/
|-- components/
|   |-- actions/
|   |   |-- QuickActionMenu.tsx         # Context menu / hover menu items
|   |   |-- CreateTaskModal.tsx         # Task creation from message
|   |   |-- CreateEventModal.tsx        # Event creation from message
|   |   |-- CreateNoteModal.tsx         # Note creation from message
|   |   |-- SetReminderPopover.tsx      # Reminder time picker
|   |   |-- MessageSelectionBar.tsx     # Multi-select floating action bar
|   |   |-- ExtractTasksModal.tsx       # AI multi-message task extraction
|   |   |-- CreateMeetingNotesModal.tsx # Multi-message meeting notes
```

---

## 9. End-to-End Encryption (E2E)

### 7.1 Scope

E2E encryption is **opt-in per channel/DM**, configured at channel creation time. Once enabled, it **cannot be disabled** (immutable `is_encrypted` flag). E2E is available for:

- PRIVATE channels
- DIRECT messages
- GROUP_DM conversations

E2E is **not available** for PUBLIC channels (cryptographically nonsensical - anyone can join and receive keys).

### 7.2 Protocol

Use **MLS (Messaging Layer Security, RFC 9420)** as the encryption protocol.

- Industry standard with formal security proofs
- O(log n) cost for membership changes (vs O(n) for Signal Sender Keys)
- Supported by OpenMLS (Rust, MIT) and mls-rs (AWS, Apache 2)
- Forward secrecy and post-compromise security are first-class guarantees

### 7.3 Key Management

| Aspect | Approach |
|--------|---------|
| Key generation | Client-side only; keys never sent as plaintext to server |
| Group key agreement | MLS TreeKEM ratchet tree; new epoch on every membership change |
| Key rotation | On member join/leave + every 500 messages + every 7 days |
| Key backup | Encrypted with user recovery phrase; encrypted blob stored server-side |
| Device verification | Cross-signing with TOFU (Trust On First Use) default |
| Multi-device | Each device registers as an MLS leaf node; key packages distributed via server |

### 7.4 What Breaks When E2E Is Enabled

The server never sees plaintext in E2E channels. This has concrete consequences:

| Feature | Status | User-facing communication |
|---------|--------|--------------------------|
| Full-text search | Unavailable | "Search is not available in encrypted channels" empty state |
| AI agents | Cannot participate | Agent tools hidden from E2E channel settings |
| Link previews | Client-side only | Each client generates previews independently |
| Push notification content | Generic only | "You have a new message" instead of preview |
| Message history for new members | Unavailable | "Messages before you joined are not visible in encrypted channels" |
| Meilisearch indexing | Skipped | Server stores ciphertext only |
| Compliance export | Unavailable in MVP | Post-MVP: optional key escrow for regulated industries |

### 7.5 UI Communication

Encrypted channels MUST be clearly distinguished throughout the UI:

1. **Lock icon** on channel name in sidebar and header
2. **"Encrypted" badge** in channel info panel
3. **Onboarding prompt** for recovery key setup (first time a user joins any E2E channel)
4. **Feature-specific empty states** explaining why search/agents/etc. are unavailable
5. **Warning at channel creation** explaining trade-offs before committing to encryption
6. **Verification indicators**: shield icon on members (filled = verified, outline = unverified)
7. **Advisory warning** (not blocking) when sending to a channel with unverified devices

### 7.6 Recovery Key Flow

1. User joins their first E2E channel (or creates one)
2. App generates a recovery phrase (12-word BIP39 or similar)
3. Modal: "Save your recovery key. You will need this to restore your encrypted message history if you lose access to all your devices."
4. User must confirm they saved it (copy/write down)
5. Encrypted key material is stored server-side, encrypted with the recovery phrase
6. On new device login, user is prompted for recovery phrase to restore key material

### 7.7 Post-MVP: Compliance Key Escrow

For regulated industries (finance, healthcare, government):

- Organization admin can enable "Compliance Mode" for E2E channels
- A copy of epoch secrets is encrypted with an organization-held key and stored in an HSM/KMS
- This breaks pure E2E (the org CAN read content) but satisfies eDiscovery
- Channels with compliance mode show a different indicator: "Encrypted (org-auditable)"
- This is a named product differentiator vs. Signal/WhatsApp which cannot offer this

---

## 8. Guest Access (Omni-Channel)

### 8.1 Access Methods

| Method | Flow | Use case |
|--------|------|----------|
| **Invite link** | Admin generates a revocable link; guest clicks, chooses nickname, enters channel | Quick external collaboration |
| **Password** | Admin sets a channel password; guest enters link + password + nickname | Semi-public rooms (community, support) |
| **Email invite** | Admin sends email invite; guest receives magic link (48h expiry, 5min on re-auth) | Known external collaborators |

### 8.2 Guest Experience

1. Guest clicks invite link (or enters channel URL + password)
2. Prompted to choose a **nickname** (no full account creation)
3. Optionally provide email (required for email-invite method)
4. Enters the channel in a **minimal UI**: message list, compose box, member list
5. Guest sees a banner: "You are a guest in this channel. Your access expires on [date]."
6. Guest session expires at the configured `expires_at` time

### 8.3 Guest Limitations

- Can ONLY access the single channel they were invited to
- Cannot browse other channels, search org content, or see org structure
- Cannot initiate DMs with org members
- Cannot use universal @ mentions (only @user mentions within the channel)
- Cannot add integrations, bots, or agents
- Cannot access files outside those shared in the channel
- Messages are tagged `sender_type = GUEST` with a "Guest" badge
- No access to settings, admin, or any other Uniffy features

### 8.4 Admin Controls

- **Enable/disable** guest access per channel
- **Choose access method** (link, password, email)
- **Set expiry** for guest access (mandatory, default 7 days, max configurable by org)
- **Set max guests** per channel (optional)
- **Revoke** individual guest sessions or all guest access
- **Regenerate** invite links (invalidates previous links)
- **Audit log** of guest join/leave activity

### 8.5 Guest Access + E2E Encryption

Guests in E2E channels participate in the MLS group. Their client generates keys like any other participant. When a guest is removed or their session expires, a key rotation is triggered automatically. Guests do NOT have access to message history before they joined (standard E2E behavior).

---

## 9. Agent Integration

AI agents can participate in chat channels (non-E2E only) through new tools added to the agent tool registry.

### 9.1 New Agent Tools

| Tool | Destructive | Description |
|------|-------------|-------------|
| `chat.list_channels` | No | List channels the user has access to |
| `chat.read_channel` | No | Read recent messages from a channel |
| `chat.send_message` | No | Send a message to a channel as the user |
| `chat.read_thread` | No | Read a thread's messages |
| `chat.reply_to_thread` | No | Reply in a thread as the user |
| `chat.search_messages` | No | Search chat messages via Meilisearch |

### 9.2 Agent Messages

When an agent sends a message on behalf of a user:
- `sender_type = USER` (the agent acts as the user, same as other tool executions)
- The message `metadata` includes `{ "via_agent": true, "agent_id": "<uuid>" }`
- The UI renders a small "via Agent Name" badge on the message

### 9.3 E2E Restriction

Agent tools are **not available** for E2E encrypted channels. The tool executor checks `channel.is_encrypted` and returns `ToolResult(success=False, error="Cannot access encrypted channels")`. The agent builder UI hides chat tools when the target channel is encrypted.

---

## 10. Search Integration

### 10.1 Search Scoping Rules

Chat messages are high-volume content. To prevent them from flooding general search results, **chat messages are excluded from global search by default** and only included when explicitly requested.

**Chat channels** (the container entity) are always searchable globally, like any other content type.

| Search context | Chat channels | Chat messages | Rationale |
|---------------|---------------|---------------|-----------|
| Global search from any non-chat page | Included | Excluded | Prevents message flood in general results |
| Global search from `/chat` page | Included | Included | User is in chat context, expects chat results |
| `chat:` prefix (e.g., `chat: deployment`) | Included | Included | Explicit filter |
| `all:` prefix (e.g., `all: deployment`) | Included | Included | User explicitly asked for everything |
| `in:#channel-name` filter | N/A | Included (scoped) | Scoped to a specific channel |
| `Ctrl+F` within a channel | N/A | Included (scoped) | Direct PostgreSQL full-text query, not Meilisearch |

### 10.2 Channel Indexing

- Indexed on create/update via `BaseContentOperations` (automatic)
- Search fields: `name`, `description`, `slug`
- Content type: `CHAT` (already registered as `SEARCH_RESULT_TYPE_CHAT = 3`)

### 10.3 Message Indexing

- Indexed on send/edit via `ChatMessageOperations`
- Search fields: `content` (plaintext extracted from markdown)
- Linked to parent channel for scoped search
- Messages in E2E channels are **NOT** indexed (server only has ciphertext)

### 10.4 Search Results UX

- Channel results show: channel name, description snippet, member count
- Message results show: message content snippet, sender name, channel name, timestamp
- Clicking a message result navigates to the message in its channel (scrolls to and highlights it)

### 10.5 In-Channel Search (`Ctrl+F`)

A lightweight search scoped to the current channel. Uses PostgreSQL full-text search directly on `chat_messages.content` filtered by `channel_id`, bypassing Meilisearch. Supports:
- Free-text search
- `from:@username` filter
- `has:file` / `has:link` / `has:reaction` filters
- Date range with `before:` / `after:` / `on:` filters
- Navigate between results with up/down arrows

---

## 11. Notifications Integration

Chat integrates with the existing Uniffy notifications system (`core/events/bus.py` -> ARQ worker -> delivery adapters). Chat does NOT build its own notification pipeline - it emits `NotificationEvent` objects through `emit_notification()` like every other domain, and the existing worker handles recipient resolution, channel delivery (in-app, browser push, email), and real-time Valkey pub/sub publishing.

### 11.1 New Notification Types

Add to `NotificationType` enum in `src/uniffy/core/models/shared.py` and the proto `NotificationType`:

| Type | Trigger | Actor | Source URN |
|------|---------|-------|-----------|
| `CHAT_MENTION` | User is @mentioned in a channel message or thread reply | Message sender | `urn:uniffy:content:CHAT:{channel_id}` |
| `CHAT_DM` | New message in a DM or Group DM | Message sender | `urn:uniffy:content:CHAT:{channel_id}` |
| `CHAT_CHANNEL_INVITE` | User is added to a channel | User who added them | `urn:uniffy:content:CHAT:{channel_id}` |
| `CHAT_CHANNEL_REMOVED` | User is removed from a channel | User who removed them | `urn:uniffy:content:CHAT:{channel_id}` |
| `CHAT_THREAD_REPLY` | New reply in a thread the user is following | Reply author | `urn:uniffy:content:CHAT:{channel_id}` |

### 11.2 Emit Points

Chat operations call `emit_notification()` at these points:

**`ChatMessageOperations.send_message()`:**
```
1. Parse message content for [[[label|urn:uniffy:content:USER:*]]] mentions
2. For each mentioned user:
   -> emit_notification(CHAT_MENTION, target_user_ids=[mentioned_user_id])
3. If channel_type is DIRECT or GROUP_DM:
   -> emit_notification(CHAT_DM, target_user_ids=[other_participants])
4. If message has root_id (thread reply):
   -> Resolve thread followers from ChatThreadMember where following=True
   -> Exclude the sender and anyone already notified via CHAT_MENTION
   -> emit_notification(CHAT_THREAD_REPLY, target_user_ids=[followers])
```

**`ChatChannelOperations.add_members()`:**
```
-> emit_notification(CHAT_CHANNEL_INVITE, target_user_ids=[new_member_ids])
```

**`ChatChannelOperations.remove_members()`:**
```
-> emit_notification(CHAT_CHANNEL_REMOVED, target_user_ids=[removed_member_ids])
```

### 11.3 Notification Metadata

The `notification_metadata` JSONB field carries chat-specific context for frontend rendering:

```python
metadata = {
    "channel_id": str(channel.id),
    "channel_name": channel.name,
    "channel_type": channel.channel_type.value,  # PUBLIC, PRIVATE, DIRECT, GROUP_DM
    "message_id": str(message.id),               # for CHAT_MENTION, CHAT_DM, CHAT_THREAD_REPLY
    "root_message_id": str(message.root_id),      # for CHAT_THREAD_REPLY (to open thread panel)
}
```

This allows `NotificationItem` in the frontend to:
- Show "#channel-name" in the source pill
- Navigate to the exact message on click (scroll-to + highlight)
- Open the thread panel directly for thread reply notifications

### 11.4 Default Delivery Channels

Add to `DEFAULT_NOTIFICATION_CHANNELS` in `src/uniffy/domains/settings/defaults.py`:

```python
"CHAT_MENTION":          {"in_app": True,  "browser": True,  "email": False},
"CHAT_DM":               {"in_app": True,  "browser": True,  "email": False},
"CHAT_CHANNEL_INVITE":   {"in_app": True,  "browser": False, "email": False},
"CHAT_CHANNEL_REMOVED":  {"in_app": True,  "browser": False, "email": False},
"CHAT_THREAD_REPLY":     {"in_app": True,  "browser": False, "email": False},
```

Rationale:
- **Mentions and DMs** get browser push by default (high-signal, user expects immediate awareness)
- **Thread replies** are in-app only (lower signal - the threads inbox already tracks unread state)
- **Channel invite/removed** are in-app only (informational, not urgent)
- **Email is off** for all chat types by default (chat is inherently real-time; email digest is noise)
- Users can override any of these per-type in Settings > Notifications

### 11.5 Notification Level Hierarchy (Suppression)

Chat notifications respect a **four-layer suppression chain**. If any layer suppresses, the notification is not emitted:

| Layer | Where configured | Effect |
|-------|-----------------|--------|
| 1. Channel mute | `ChatChannelMember.is_muted` | Suppresses ALL notifications for this channel (mentions still tracked for badge but no push/in-app) |
| 2. Channel notification level | `ChatChannelMember.notification_level` | `ALL` = notify on every message; `MENTIONS` = only @mentions and DMs; `NONE` = suppress all |
| 3. User notification settings | `SettingsProfile.notifications.channel_overrides` | Per-type delivery channel toggles (in-app, browser, email) |
| 4. Master switches | `SettingsProfile.notifications.browser_enabled` etc. | Global on/off per delivery channel |

**Suppression logic in `ChatMessageOperations` (before calling `emit_notification`):**

```
For each potential recipient:
  1. If ChatChannelMember.is_muted -> skip entirely
  2. If notification_level == NONE -> skip entirely
  3. If notification_level == MENTIONS and this is not a mention/DM -> skip
  4. If notification_level == ALL -> emit (worker handles delivery channel resolution)
```

Layers 3 and 4 are handled by the existing notification worker (`_get_delivery_channels`) - no chat-specific code needed there.

### 11.6 Deduplication: Real-Time Stream vs Notifications

Chat has TWO real-time delivery paths that must not conflict:

| Path | Purpose | What it delivers |
|------|---------|-----------------|
| `StreamChannelEvents` (chat stream) | Live message feed for the active channel | Every message, reaction, typing indicator in the channel |
| `StreamNotifications` (notification stream) | Cross-app notification bell | Only mention/DM/invite notifications |

**Rules:**
- If the user is **actively viewing** the channel where a mention/DM occurs, the frontend still receives the notification via `StreamNotifications` but auto-marks it as read (since the user is already looking at the message)
- The chat stream is the primary delivery path for messages. Notifications are supplementary - they exist for when the user is NOT in the chat page
- The notification `body` for chat types should be a short preview (first 200 chars of message content, plaintext) not the full message

### 11.7 Frontend: NotificationItem Rendering for Chat Types

The existing `NotificationItem` component renders based on `notification_type`. Chat types need specific rendering:

| Type | Title format | Body | Click action |
|------|-------------|------|-------------|
| `CHAT_MENTION` | "{actor} mentioned you in #{channel}" | Message preview (200 chars) | Navigate to `/chat/{channelId}`, scroll to message, highlight |
| `CHAT_DM` | "{actor} sent you a message" | Message preview (200 chars) | Navigate to `/chat/{channelId}`, scroll to message |
| `CHAT_CHANNEL_INVITE` | "{actor} added you to #{channel}" | Channel description preview | Navigate to `/chat/{channelId}` |
| `CHAT_CHANNEL_REMOVED` | "{actor} removed you from #{channel}" | - | No navigation (channel is no longer accessible) |
| `CHAT_THREAD_REPLY` | "{actor} replied in a thread in #{channel}" | Reply preview (200 chars) | Navigate to `/chat/{channelId}`, open thread panel for `root_message_id` |

The source URN pill uses the existing `CHAT` URN type theme (violet, `ChatTeardrop` icon) with the channel name as label.

### 11.8 Push Notification Content

Browser push notifications (via `PushAdapter` + Web Push API):

| Type | Push title | Push body |
|------|-----------|-----------|
| `CHAT_MENTION` | "#{channel} - {actor}" | "@you: {message preview}" |
| `CHAT_DM` | "{actor}" | "{message preview}" |
| `CHAT_THREAD_REPLY` | "Thread in #{channel}" | "{actor}: {message preview}" |
| `CHAT_CHANNEL_INVITE` | "Uniffy Chat" | "{actor} added you to #{channel}" |

**E2E encrypted channels**: Push body is replaced with "You have a new message" (server cannot read content). Push title still shows channel/actor since those are metadata, not message content.

### 11.9 Proto Updates

Add to `src/proto/notifications/v1/notifications.proto` `NotificationType` enum:

```protobuf
NOTIFICATION_TYPE_CHAT_MENTION = 10;
NOTIFICATION_TYPE_CHAT_DM = 11;
NOTIFICATION_TYPE_CHAT_CHANNEL_INVITE = 12;
NOTIFICATION_TYPE_CHAT_CHANNEL_REMOVED = 13;
NOTIFICATION_TYPE_CHAT_THREAD_REPLY = 14;
```

Add to `src/proto/notifications/v1/notifications.proto` `StreamNotificationEvent` event types:

No new stream event types needed. Chat notifications use the existing `EVENT_TYPE_NEW_NOTIFICATION` which carries the full `Notification` message. The frontend differentiates by `notification_type`.

---

## 12. Chat Notification Preferences

Chat requires significantly more granular notification controls than other Uniffy domains. A dedicated **Chat Notifications** subpage is accessible from the chat sidebar (gear icon) and from global Settings. This is inspired by Slack's layered notification model but adapted to Uniffy's existing settings architecture.

### 12.1 Settings Location

- **Primary**: `/chat/notifications` - a dedicated page within the chat feature, linked from the chat sidebar header (gear/bell icon)
- **Secondary**: Settings > Notifications shows the global per-type toggles (Section 11.4) but links to "Manage chat notification preferences" for the full granular UI
- **Per-channel quick access**: Channel header bell icon opens a popover with that channel's notification overrides

### 12.2 Global Chat Defaults

These are the user's baseline for all chat channels. Stored in `SettingsProfile.notifications` JSONB under a new `chat` key.

| Setting | Options | Default | Description |
|---------|---------|---------|-------------|
| **Notify me about** | All messages / Mentions and DMs / Nothing | Mentions and DMs | Master trigger level for chat |
| **Thread replies** | On / Off | On | Notify about replies in threads I'm following |
| **Keywords** | Comma-separated words | (empty) | Custom highlight words that trigger notifications like @mentions |
| **Sound** | Dropdown (notification sounds) | Default | Sound for chat notifications |
| **Mute all chat sounds** | Toggle | Off | Silence all chat notification sounds |
| **Include message preview** | Toggle | On | Show message content in push notifications (privacy control) |

**Keywords behavior:**
- Case-insensitive, exact word match (not substring)
- Keyword matches trigger a notification even in muted channels (same as @mentions)
- Keywords are visually highlighted in chat messages
- No limit on keyword count

### 12.3 Per-Channel Notification Overrides

Each channel can override the global chat defaults. Stored in `ChatChannelMember` fields (already defined in Section 3.4).

**Quick popover** (from channel header bell icon):

| Setting | Options | Default |
|---------|---------|---------|
| **Notifications** | All messages / Mentions only / Mute | (inherits global) |
| **Mute** | Toggle | Off |

**Advanced overrides** (expandable section or "Advanced" link in popover):

| Setting | Options | Default |
|---------|---------|---------|
| **Desktop notifications** | On / Off | (inherits global) |
| **Mobile notifications** | On / Off | (inherits global) |
| **Badge every unread message** | On / Off | Off |
| **Follow every thread** | On / Off | Off |

**"Badge every unread message"**: When enabled, the sidebar shows a numeric badge for every new message in this channel, not just mentions. Useful for high-priority channels.

**"Follow every thread"**: When enabled, the user auto-follows every new thread in this channel and gets notified of all replies. Useful for small, important channels where you want full context.

### 12.4 Notification Schedule (Do Not Disturb)

Extends the existing `quiet_hours_start` / `quiet_hours_end` in `NotificationsDefaults` with richer scheduling. Stored in `SettingsProfile.notifications.chat_schedule`.

**Recurring schedule:**

| Setting | Options | Default |
|---------|---------|---------|
| **Allow chat notifications** | Every day / Weekdays / Custom | Every day |
| **Start time** | Time picker | 08:00 |
| **End time** | Time picker | 22:00 |
| **Custom days** | Day checkboxes (Mon-Sun) | (all checked) |

Outside the configured window, all chat push notifications are suppressed. In-app notifications still accumulate silently.

**On-demand pause:**
- Accessible from chat sidebar header (bell-slash icon) or via keyboard shortcut
- Preset durations: 30 minutes, 1 hour, 2 hours, Until tomorrow, Until next week
- Custom duration picker
- Visual indicator: bell-slash icon in sidebar header + status indicator on user's avatar in chat
- Notifications accumulate during pause and are available in the notification panel when resumed

### 12.5 Mobile vs Desktop Differentiation

Stored in `SettingsProfile.notifications.chat_mobile`.

| Setting | Options | Default |
|---------|---------|---------|
| **Use different settings for mobile** | Toggle | Off |
| **Mobile notify about** | All messages / Mentions and DMs / Nothing | (mirrors desktop) |
| **Mobile timing** | Immediately / When inactive on desktop / After delay | When inactive on desktop |
| **Delay duration** | 1 min / 2 min / 5 min / 10 min | 2 min |

When "Use different settings for mobile" is off, mobile mirrors desktop settings. When on, the mobile-specific trigger level and timing apply.

**Per-channel mobile overrides** are also available in the channel's advanced notification settings. This allows patterns like: "Get all messages on desktop for #engineering, but only mentions on mobile."

### 12.6 Channel Notification Overrides List

The `/chat/notifications` page includes an **"Exceptions"** section that lists all channels where the user has applied custom notification overrides. This provides a single audit view:

```
Channel                  | Notification Level | Muted | Desktop | Mobile | Badge All | Follow All
#general                 | All messages       | No    | On      | Off    | Yes       | No
#random                  | Mute               | Yes   | -       | -      | -         | -
@john-doe (DM)           | Mentions only      | No    | On      | On     | No        | -
#engineering-alerts      | All messages       | No    | On      | On     | Yes       | Yes
```

Each row has an edit button that opens the per-channel popover, and a reset button that clears all overrides for that channel.

### 12.7 Mute Behavior (Detailed)

Muting is the strongest per-channel suppression. What exactly happens:

| Behavior | Muted? |
|----------|--------|
| Desktop/mobile push notifications | Suppressed |
| In-app notification panel entries | Suppressed |
| Sidebar unread bold/badge | Suppressed (channel grayed out in sidebar) |
| @mention badge | **Still shown** (red badge on muted channel) |
| Keyword match notification | **Still shown** (keywords penetrate mute) |
| Thread reply indicators (Threads inbox) | **Still shown** for followed threads |
| Message delivery | Normal (messages accumulate, visible when you visit) |
| Channel position in sidebar | Drops to bottom of section, visually dimmed |

Mute = silence ambient noise, not directed signals. This matches user expectations from Slack/Teams.

### 12.8 Suppression Hierarchy (Complete)

The full evaluation order when deciding whether to send a chat notification:

```
1. Is the user in DND / outside notification schedule?
   YES -> Suppress (unless keyword match, see below)

2. Is the channel muted?
   YES -> Suppress general notifications
         EXCEPT: @mentions and keyword matches still create badges (no push)

3. Does the channel have a per-channel notification level override?
   YES -> Use the channel-level setting:
          ALL       -> proceed to delivery
          MENTIONS  -> only @mentions, DMs, keyword matches proceed
          NONE      -> suppress all
   NO  -> Use global chat default trigger level

4. Is this a thread reply? Check thread notification preference:
   Global "thread replies" OFF -> suppress
   Per-thread "turn off notifications" -> suppress
   Otherwise -> proceed

5. Delivery channel resolution (existing notification worker):
   Check per-type channel_overrides (in_app, browser, email)
   Apply master switches (browser_enabled, email_enabled)
   Apply mobile-specific overrides if enabled

6. Send via active delivery channels
```

### 12.9 Data Model Extensions

**`SettingsProfile.notifications` JSONB** - new keys under the `chat` namespace:

```python
{
    # Existing top-level keys (unchanged)
    "browser_enabled": True,
    "email_enabled": True,
    "sound_enabled": True,
    "channel_overrides": { ... },

    # New chat-specific keys
    "chat": {
        "default_trigger": "mentions_and_dms",  # "all" | "mentions_and_dms" | "nothing"
        "thread_replies": True,
        "keywords": [],                          # list of strings
        "sound": "default",                      # sound identifier
        "mute_sounds": False,
        "include_preview": True,

        "schedule": {
            "mode": "every_day",                 # "every_day" | "weekdays" | "custom"
            "start_time": "08:00",
            "end_time": "22:00",
            "custom_days": [1, 2, 3, 4, 5],     # ISO weekday numbers (1=Mon)
        },

        "mobile": {
            "enabled": False,                    # Use different settings for mobile
            "trigger": "mentions_and_dms",
            "timing": "inactive",                # "immediate" | "inactive" | "delay"
            "delay_minutes": 2,
        },

        "paused_until": null,                    # ISO timestamp or null
    }
}
```

**`ChatChannelMember`** - extended fields (additions to Section 3.4):

| Field | Type | Description |
|-------|------|-------------|
| `desktop_enabled` | bool (nullable) | NULL = inherit global; True/False = per-channel override |
| `mobile_enabled` | bool (nullable) | NULL = inherit global; True/False = per-channel override |
| `mobile_trigger` | enum (nullable) | NULL = inherit; per-channel mobile trigger level |
| `badge_all_messages` | bool | Show badge for every message, not just mentions |
| `follow_all_threads` | bool | Auto-follow every thread in this channel |

### 12.10 Frontend: Chat Notifications Page

**Route**: `/chat/notifications`

**Components:**

```
src/ui/src/features/chat/
|-- components/
|   |-- notifications/
|   |   |-- ChatNotificationsPage.tsx     # Main settings page
|   |   |-- GlobalChatDefaults.tsx        # Section: trigger level, threads, keywords, sound
|   |   |-- NotificationSchedule.tsx      # Section: DND schedule + on-demand pause
|   |   |-- MobileSettings.tsx            # Section: mobile-specific overrides
|   |   |-- ChannelOverridesList.tsx       # Section: exceptions table with edit/reset
|   |   |-- ChannelNotificationPopover.tsx # Per-channel quick settings popover
|   |   |-- KeywordInput.tsx              # Tag-style keyword entry
|   |   |-- PauseDurationPicker.tsx       # Quick pause duration selector
```

**Page layout:**
1. **Global Chat Defaults** - trigger level dropdown, thread replies toggle, keyword input, sound picker, preview toggle
2. **Notification Schedule** - recurring schedule config + on-demand pause button
3. **Mobile** - toggle for separate mobile settings, mobile trigger and timing
4. **Channel Overrides** - table of all channels with custom settings, sortable, with inline edit and bulk reset

### 12.11 Proto Updates for Chat Settings

The existing `NotificationsSettings` proto message uses `map<string, NotificationChannelPreference> channel_overrides` which is fully generic. The new chat-specific settings are stored in the same `SettingsProfile.notifications` JSONB column and serialized through the existing `UpdateSettings` / `GetEffectiveSettings` RPCs.

No new proto messages are needed. The chat notification preferences are opaque JSONB that the frontend reads/writes through the existing settings update path. The backend `get_effective_notification_channels()` function is extended to check `chat.*` keys when resolving delivery channels for `CHAT_*` notification types.

---

## 13. Keyboard Shortcuts

Added to `src/uniffy/domains/settings/defaults.py`:

| Shortcut ID | Default | Action |
|-------------|---------|--------|
| `chat.newMessage` | `N` | Focus compose box |
| `chat.search` | `Ctrl+F` | Search within channel |
| `chat.prevChannel` | `Alt+Up` | Previous channel in sidebar |
| `chat.nextChannel` | `Alt+Down` | Next channel in sidebar |
| `chat.toggleThread` | `T` | Open/close thread panel |
| `chat.markRead` | `Escape` | Mark channel as read |
| `chat.editLast` | `Up` | Edit your last message |
| `chat.replyThread` | `R` | Reply to selected message thread |
| `chat.emojiPicker` | `Ctrl+Shift+E` | Open emoji picker |

---

## 13. Routes and Navigation

### 13.1 URL Structure

```
/chat                          # Channel list / last active channel
/chat/:channelId               # Specific channel
/chat/threads                  # Threads inbox
/chat/dm/:userId               # Open/create DM with a user
```

### 13.2 Sidebar

The chat sidebar shows:

1. **Threads** link (with unread badge)
2. **Direct Messages** section
   - Recent DMs sorted by last activity
   - "+ New Message" button
3. **Channels** section
   - Bookmarked channels first
   - Then channels sorted by last activity
   - Each shows: name, unread indicator, mention badge
   - Lock icon for encrypted channels
   - "+ Create Channel" button
4. **Search** within channel list

---

## 14. Presence System

Presence is an **app-wide platform feature**, not chat-specific. See `docs/specs/presence-spec.md` for the full specification.

Chat consumes presence through the shared `PresenceIndicator` component and `usePresence` hook. Presence dots appear on:
- DM list avatars in the chat sidebar
- Channel member list avatars
- Message sender avatars
- Typing indicator user avatars

Chat's DND/pause feature (Section 12.4) sets the user's presence to `DND` via the shared presence API.

---

## 15. UI Design and Styling

### 15.1 Design Philosophy

Chat is a professional messaging platform. The UI follows the **flat/list message style** (Slack, Mattermost, Discord) - not the bubble style used in the agents chat. Flat style scales to multi-user conversations, provides more space for code blocks and file previews, and is the established standard for workplace communication tools.

### 15.2 Overall Layout

Three resizable panels via `react-resizable-panels`:

```
+------------------+----------------------------+------------------+
|                  |                            |                  |
|  Chat Sidebar    |    Channel View            |  Thread Panel    |
|  (channels,      |    (messages + compose)    |  (RHS)           |
|   DMs, threads)  |                            |                  |
|                  |                            |                  |
|  bg-card         |    bg-background           |  bg-card         |
|  w: 240-320px    |    flex: 1 (fills)         |  w: 320-500px    |
|                  |                            |                  |
+------------------+----------------------------+------------------+
```

- **Sidebar**: `bg-card`, collapsible to icon rail (`w-12`), expanded `w-60` to `w-80`. Uses `CollapsibleSidebarRail` pattern on tablet, `Drawer` on mobile.
- **Channel view**: `bg-background`, fills remaining space. Contains header, message list, and compose box.
- **Thread panel**: `bg-card`, resizable (`minSize: 320`, `maxSize: 500`), appears when a thread is opened. Drawer on tablet/mobile.
- **Panel separators**: `w-1 bg-border hover:bg-primary/50 cursor-col-resize data-[resize-handle-state=drag]:bg-primary` (standard Uniffy pattern)
- Panel sizes persisted to `localStorage`

**Responsive tiers:**

| Tier | Layout |
|------|--------|
| **Desktop** (1024px+) | Three-panel: sidebar + channel + thread RHS. All resizable. |
| **Tablet** (768-1024px) | Sidebar as collapsible rail/drawer. Channel full-width. Thread as drawer overlay from right. |
| **Mobile** (<768px) | Single panel. Sidebar as drawer. Channel list and channel view as separate screens. Thread as full-screen drawer. |

### 15.3 Message Display Style

**Flat/list style** - full-width, left-aligned, stacked vertically:

```
[avatar]  John Doe                                   10:32 AM  [hover: reactions, reply, more]
          Hey, has anyone looked at the deployment issue?
          I think the config in staging is wrong.

          Jane Smith                                  10:33 AM
          Yeah, I'm on it. Found the problem - the env
          var was pointing to prod DB.
```

**Message anatomy:**

| Element | Styling |
|---------|---------|
| **Container** | `group px-4 py-1 hover:bg-muted/30 transition-colors` |
| **Avatar** | `SubjectAvatar` size `md` (32px) with `showPresence`, top-left of message |
| **Sender name** | `text-sm font-semibold text-foreground` |
| **Timestamp** | `text-xs text-muted-foreground ml-2` inline with name. On hover: shows full date in tooltip |
| **Content** | `text-sm text-foreground leading-relaxed` with prose markdown rendering |
| **Edited indicator** | `text-xs text-muted-foreground` "(edited)" after content |

**Consecutive message grouping:**

When the same sender posts multiple messages within 5 minutes, subsequent messages collapse:
- No avatar, no name, no timestamp (timestamp appears on hover)
- Reduced top padding: `py-0.5` instead of `py-1`
- Visual effect: messages from the same person flow as a continuous block

```
[avatar]  John Doe                                   10:32 AM
          Hey, has anyone looked at the deployment issue?
          I think the config in staging is wrong.        <- grouped, no avatar/name
          Found the log trace, sharing now               <- grouped, timestamp on hover
```

### 15.4 Message Density Modes

User-configurable via chat settings (stored in `chatUiSlice`, persisted):

| Mode | Avatar size | Spacing | Name/timestamp | Use case |
|------|------------|---------|----------------|----------|
| **Comfortable** (default) | 32px (`md`) | `py-1.5` between messages, `py-0.5` grouped | Full name + timestamp on separate line above content | New users, readability |
| **Compact** | 20px (`xs`) | `py-0.5` between messages, `py-px` grouped | Name, timestamp, and content on the **same line**: `John Doe  10:32 AM  message text` | Power users, high-volume channels |

Toggle accessible from: channel header (compact/comfortable icon button, same pattern as agents chat context stats button) and chat notification preferences page.

### 15.5 Hover Actions Toolbar

A floating toolbar appears above the top-right corner of a message on hover:

```
                                              +---+---+---+---+---+
                                              | :)| 💬 | 📌 | :  | ... |
                                              +---+---+---+---+---+
+-------------------------------------------------------------------+
| [avatar]  John Doe              10:32 AM                          |
|           Hey, has anyone looked at the deployment issue?          |
+-------------------------------------------------------------------+
```

**Toolbar styling:**
- Container: `absolute -top-4 right-4 flex items-center bg-card border border-border rounded-lg shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-10`
- Buttons: `ghost` variant, size `xs` (h-7 w-7)
- On mobile: no hover toolbar. Long-press opens a bottom sheet with all actions

**Actions (left to right):**

| Icon | Action | Notes |
|------|--------|-------|
| `Smiley` | Add reaction | Opens emoji picker popover |
| `ChatText` | Reply in thread | Opens thread panel with this message as root |
| `PushPin` | Pin/unpin message | Toggle, filled icon when pinned |
| `ArrowBendUpLeft` | Quote reply | Inserts quoted block in compose box |
| `DotsThreeVertical` | More actions menu | Dropdown with: Edit, Delete, Copy text, Copy link, Forward (v2), Bookmark message (v2) |

**Edit/Delete** appear in the "more" menu only for the user's own messages. Admins see Delete for any message.

### 15.6 Reactions Display

Reactions appear below the message content as a row of pills:

```
[avatar]  John Doe                                   10:32 AM
          Great work on the release!

          [ 👍 3 ] [ 🎉 2 ] [ ❤️ 1 ] [ + ]
```

**Reaction pill styling:**
- Container: `inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-xs cursor-pointer transition-colors`
- Default: `border-border bg-muted/50 hover:bg-muted`
- User has reacted: `border-primary/50 bg-primary/10 text-primary`
- Emoji: 14px
- Count: `text-xs font-medium`
- `[+]` button: `border-dashed border-border hover:border-primary/50` with `Plus` icon

**Reaction tooltip:** On hover over a pill, show who reacted: "John, Jane, and 1 other"

**Emoji picker for reactions:**
- Triggered from hover toolbar `Smiley` button or `[+]` button on existing reactions
- Popover with emoji grid, search, and frequently used section
- Uses the existing `IconPicker` emoji tab pattern but as a standalone component

### 15.7 Thread Footer

When a root message has replies, a thread footer appears below reactions:

```
[avatar]  John Doe                                   10:32 AM
          Has anyone looked at the deployment issue?

          [ 👍 3 ]

          [ava][ava][ava]  5 replies   Last reply 2 hours ago   ->
```

**Thread footer styling:**
- Container: `flex items-center gap-2 mt-1 px-2 py-1.5 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors group/thread`
- Participant avatars: `SubjectAvatarStack` size `xs` (20px), max 4 shown
- Reply count: `text-xs font-medium text-primary` ("5 replies")
- Last reply time: `text-xs text-muted-foreground` ("Last reply 2 hours ago")
- Arrow: `CaretRight` size 12, `text-muted-foreground group-hover/thread:text-primary transition-colors`
- Unread indicator: blue dot before reply count if thread has unread replies

Click opens the thread in the RHS panel.

### 15.8 Thread Panel (RHS)

**Header:**
- `flex items-center justify-between px-4 py-3 border-b border-border bg-card`
- Title: `text-sm font-semibold` "Thread" or "Thread in #channel-name"
- Close button: `X` icon, ghost variant
- Channel link: `text-xs text-muted-foreground hover:text-primary` clicking navigates to the parent channel

**Body:**
- Root message rendered at top with full styling (same as channel view)
- Separator: `border-b border-border mx-4` with label `text-xs text-muted-foreground` "X replies"
- Replies rendered below, same flat/list style as channel view
- `ScrollArea` with auto-scroll to bottom on new replies

**Compose:**
- Same compose box component as the channel, but with placeholder "Reply..."
- Positioned at bottom of the thread panel

### 15.9 Chat Sidebar

**Surface:** `bg-card`, border-right `border-border`

**Structure (top to bottom):**

```
+----------------------------------+
| [org logo] Chat    [gear] [edit] |  <- Header
+----------------------------------+
| 🔍 Search channels...            |  <- Search input
+----------------------------------+
| ▶ Threads            [3]         |  <- Threads link with unread badge
+----------------------------------+
| ▼ Channels                  [+]  |  <- Section header
|   # general              [2] 📌  |
|   # engineering                  |
|   🔒 secret-project        [1]  |
|   # design           (muted)    |
+----------------------------------+
| ▼ Direct Messages           [+]  |  <- Section header
|   [ava●] Jane Smith     [1]     |
|   [ava○] John Doe               |
|   [ava ] 3 people               |  <- Group DM
+----------------------------------+
```

**Sidebar elements:**

| Element | Styling |
|---------|---------|
| **Header** | `flex items-center justify-between px-3 py-2 border-b border-border`. Gear icon opens `/chat/notifications`. Edit icon (compose) opens new message modal. |
| **Search input** | `mx-3 my-2`, `Input` component with `MagnifyingGlass` icon, filters channel list |
| **Section header** | `text-xs uppercase font-medium tracking-wider text-muted-foreground px-3 py-2 mt-1` with collapse chevron and "+" create button |
| **Channel item** | `flex items-center gap-2 px-3 py-1.5 rounded-md mx-1.5 cursor-pointer` |
| **Channel item (active)** | `bg-primary/10 text-primary font-medium` |
| **Channel item (inactive)** | `text-muted-foreground hover:bg-muted hover:text-foreground` |
| **Channel item (unread)** | `font-semibold text-foreground` with unread badge |
| **Channel item (muted)** | `text-muted-foreground/60` dimmed, sorted to bottom of section |
| **Unread badge** | `min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center` |
| **Mention badge** | Same as unread but shows @mention count |
| **Lock icon** | `Lock` 12px `text-muted-foreground` before channel name for encrypted channels |
| **Hash icon** | `Hash` 14px `text-muted-foreground` before public channel names |
| **DM avatar** | `SubjectAvatar` size `sm` (24px) with `showPresence` |
| **DM unread** | Same badge as channels |

**Bookmarked channels** appear at the top of the Channels section with a `Star` icon, sorted by last activity.

### 15.10 Channel Header

**Dense-on-demand** - compact by default, expandable on click (same pattern as agents chat context stats):

**Compact (default):**
```
+-----------------------------------------------------------------------+
| # general     12 members     🔍     📌 3     ⚙️     [density] [panel] |
+-----------------------------------------------------------------------+
```

- Container: `flex items-center gap-3 px-4 py-2 border-b border-border bg-card`
- Channel icon: `Hash` or `Lock` (16px) + channel name `text-sm font-semibold text-foreground`
- Member count: `text-xs text-muted-foreground` with `Users` icon, clickable (opens member list panel)
- Search: `MagnifyingGlass` ghost button, opens in-channel search bar
- Pinned: `PushPin` ghost button with count badge, opens pinned messages panel
- Settings: `GearSix` ghost button, opens channel settings modal
- Density toggle: `Rows` / `SquareHalf` icon toggle for comfortable/compact
- Panel toggle: `SidebarSimple` ghost button, shows/hides sidebar on tablet/mobile

**Expanded (on click/hover of channel name):**

A collapsible section slides down below the compact header:

```
+-----------------------------------------------------------------------+
| # general     12 members     🔍     📌 3     ⚙️     [density] [panel] |
+-----------------------------------------------------------------------+
| Discuss anything and everything. This is the main communication       |
| channel for the team. See [[[Onboarding Guide|urn:...NOTE:...]]]      |
| Created by John Doe on Jan 15, 2026                                   |
+-----------------------------------------------------------------------+
```

- `transition-[max-height,opacity] duration-200 ease-out overflow-hidden`
- Description: `text-sm text-muted-foreground` with markdown rendering and mention support
- Creator and creation date: `text-xs text-muted-foreground`
- Chevron indicator on the channel name area to show expandability

### 15.11 Compose Box

A lightweight rich-text composer with inline markdown preview. Heavier than the agents plain textarea, lighter than the notes Milkdown editor.

**Layout:**
```
+-----------------------------------------------------------------------+
| [formatting toolbar - appears on text selection or toolbar toggle]     |
+-----------------------------------------------------------------------+
| | Type a message to #general...                                       |
| |                                                                     |
| |                                                            [200px   |
| |                                                             max-h]  |
+-----------------------------------------------------------------------+
| [+attach] [emoji] [@mention] [</>code]              [formatting] [⏎] |
+-----------------------------------------------------------------------+
```

**Container styling:**
- Outer: `mx-4 mb-4 border border-border rounded-xl bg-muted/30 focus-within:ring-1 focus-within:ring-ring focus-within:border-transparent transition-all`
- Textarea area: `px-4 pt-3 pb-2 text-sm resize-none bg-transparent min-h-[40px] max-h-[200px] overflow-y-auto`
- Bottom toolbar: `flex items-center justify-between px-2 py-1.5 border-t border-border/50`

**Bottom toolbar buttons (left group):**
- `Plus` (attach file) - opens file picker, supports drag-and-drop onto the compose area
- `Smiley` (emoji) - opens emoji picker popover
- `At` (@mention) - triggers mention search
- `Code` (code block) - inserts ``` fenced code block with language selector

**Bottom toolbar buttons (right group):**
- `TextB` (formatting toggle) - shows/hides the floating formatting toolbar
- `PaperPlaneRight` (send) - `default` button variant, primary colored, disabled when empty

**Floating formatting toolbar (appears on text selection):**
- `absolute` positioned above the selection
- `bg-card border border-border rounded-lg shadow-lg px-1 py-0.5`
- Buttons: Bold (`TextB`), Italic (`TextItalic`), Strike (`TextStrikethrough`), Code (`Code`), Link (`LinkSimple`), Quote (`Quotes`)
- All ghost variant, size `xs`

**Behavior:**
- `Enter` sends message, `Shift+Enter` for newline
- Markdown renders inline as you type (bold text appears bold, code appears in monospace)
- Paste image support: images from clipboard create an inline attachment preview
- Drag-and-drop files onto the compose area
- File attachment previews appear above the toolbar: `rounded-lg border border-border bg-muted w-16 h-16` thumbnails with `X` to remove
- @mention autocomplete: triggers on `@` keystroke, searches users/groups/content via `SubjectPicker` dropdown pattern
- Character counter: appears at `28,000+` characters as `text-xs text-muted-foreground` right-aligned
- Over-limit prompt: at `30,000` characters, shows inline banner with "Create as note" / "Create as file" / "Trim" options

**Thread compose** uses the same component but with:
- Placeholder: "Reply..."
- Slightly narrower (adapts to thread panel width)
- No channel name reference in placeholder

### 15.12 Code Blocks

Full syntax highlighting with language detection:

```
+-----------------------------------------------------------------------+
| javascript                                        [copy]              |
+-----------------------------------------------------------------------+
| const handler = async (req) => {                                      |
|   const data = await fetchData(req.params.id);                        |
|   return Response.json(data);                                         |
| };                                                                    |
+-----------------------------------------------------------------------+
```

**Styling:**
- Container: `rounded-lg border border-border overflow-hidden my-2`
- Header bar: `flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border text-xs text-muted-foreground`
- Language label: left-aligned, auto-detected or specified after opening ```
- Copy button: `Copy` icon, ghost variant size `xs`, shows `Check` icon for 2s after click
- Code body: `p-4 text-sm font-mono bg-muted/30 overflow-x-auto`
- Syntax highlighting: use a lightweight library (Shiki or Prism) with theme-aware colors
- Inline code: `px-1.5 py-0.5 rounded bg-muted font-mono text-[13px]`

### 15.13 Mention Chip Rendering in Messages

All shared content in chat renders via the existing `MentionChip` component from the notes editor mention plugin system. The message markdown `[[[label|urn]]]` mentions are parsed and rendered as interactive chips with URN-type-specific rich previews. See Section 6.2 for the full rendering table per URN type.

**Key styling rules for mention chips in chat messages:**

**Inline chips (NOTE, USER, GROUP, TASK, PROJECT, CALENDAR_EVENT, CHAT):**
- Rendered inline with text flow, same as in the notes editor
- Chip: `inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-sm font-medium cursor-pointer`
- Background: URN type theme from `getUrnTypeTheme()` (e.g., `bg-primary/10 text-primary` for notes)
- Icon: from `getUrnIcon()`, 14px
- Hover: preview tooltip with content summary (first 200 chars for notes, date/time for events, status for tasks)
- Click: navigates to content via `urnToPath()`
- USER chips show `PresenceIndicator` dot inline

**Block-level chips (FILE mentions with rich media):**

FILE mentions break out of inline text flow and render as block-level previews:

**Images** (`FILE` where mime starts with `image/`):
- Single: `rounded-lg overflow-hidden border border-border max-w-[400px] max-h-[300px] my-2 cursor-pointer`
- Hover: `hover:brightness-95 transition-all`
- Click: lightbox (full-screen `bg-black/90`, zoom, download, Escape to close)
- Multiple images in same message: gallery grid (2 cols for 2-4, 3 cols for 5+, "+N more" overlay on 6th cell)

**Videos** (`FILE` where mime starts with `video/`):
- `rounded-lg overflow-hidden border border-border max-w-[400px] my-2`
- Play button overlay on thumbnail, HTML5 controls
- Auth via media stream service worker

**Audio** (`FILE` where mime starts with `audio/`):
- `rounded-lg border border-border bg-muted/30 px-3 py-2 max-w-[350px] my-2`
- Play/pause + waveform visualization + duration

**Documents and other files:**
```
+-------------------------------------------+
| [icon]  deployment-guide.pdf              |
|         2.4 MB - PDF Document    [download]|
+-------------------------------------------+
```
- Container: `flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-muted/30 max-w-[350px] my-2 hover:bg-muted/50 transition-colors cursor-pointer`
- File icon: typed Phosphor icon (`FilePdf`, `FileDoc`, `FileXls`, etc.), 24px, colored by URN type theme (blue for files)
- File name: `text-sm font-medium text-foreground truncate`
- Meta: `text-xs text-muted-foreground` (size + type)
- Download: `DownloadSimple` icon, ghost variant, appears on hover

All file previews use the existing HTTP file routes + service worker auth proxy for authenticated resource loading.

### 15.14 Typing Indicator

Appears below the last message, above the compose box:

```
[ava] [ava]  Jane and John are typing...
```

- Container: `flex items-center gap-2 px-4 py-1 h-6 text-xs text-muted-foreground`
- Avatars: `SubjectAvatar` size `xs` (16px) with presence
- Text: "{name} is typing..." (1 person), "{name} and {name} are typing..." (2), "Several people are typing..." (3+)
- Three-dot animation: reuse `.thinking-dot` CSS animation from agents chat
- Fades in/out with `transition-opacity duration-150`
- Height is reserved (always `h-6`) to prevent layout shift

### 15.15 Empty States

**New channel (no messages yet):**
```
        [large Hash icon, 48px, text-muted-foreground/30]

        This is the start of #channel-name
        Start connecting with your team.

        [optional: channel description in text-muted-foreground]
        [optional: "Add members" button if channel is empty]
```

- Centered vertically and horizontally in the message area
- Icon: `Hash` or `Lock` (for private), 48px, `text-muted-foreground/30`
- Title: `text-lg font-semibold text-foreground`
- Subtitle: `text-sm text-muted-foreground mt-1`

**New DM:**
```
        [SubjectAvatar size xl]

        Jane Smith
        This is the beginning of your conversation with Jane.

        [presence indicator + "Online" / "Away" / "Offline"]
```

**Threads inbox (no followed threads):**
```
        [ChatText icon, 48px, text-muted-foreground/30]

        No threads yet
        Threads you start or follow will appear here.
```

### 15.16 System Messages

Channel events (joins, leaves, renames, etc.) rendered as centered, muted inline notices:

```
                 Jane Smith joined #general
                 ──────── January 15 ────────
                 John Doe changed the channel topic
```

**Styling:**
- Container: `flex justify-center py-2`
- Text: `text-xs text-muted-foreground`
- Date separators: `flex items-center gap-3` with `border-t border-border flex-1` lines on each side and date label in the center

### 15.17 Date Separators

When messages span multiple days, a sticky date separator appears:

```
──────────────── Today ────────────────
──────────────── Yesterday ────────────
──────────────── March 14, 2026 ───────
```

- `sticky top-0 z-10 flex items-center gap-4 px-4 py-2 bg-background/95 backdrop-blur-sm`
- Lines: `flex-1 border-t border-border`
- Label: `text-xs font-medium text-muted-foreground whitespace-nowrap`
- Uses `formatDateShort` from shared formatting utils

### 15.18 Unread Separator

When scrolling up and then returning to a channel with new messages, an unread separator marks where new content begins:

```
────────────── New messages ───────────
```

- Same layout as date separator but with `border-primary/50` colored lines and `text-primary text-xs font-medium` label
- Disappears after the channel is marked as read

### 15.19 Colors and Theme Integration

| Element | Light mode | Dark mode |
|---------|-----------|-----------|
| Message area background | `bg-background` (white) | `bg-background` (dark navy) |
| Sidebar/thread panel | `bg-card` (slightly off-white) | `bg-card` (slightly lighter navy) |
| Message hover | `bg-muted/30` | `bg-muted/30` |
| Selected/active channel | `bg-primary/10 text-primary` | `bg-primary/10 text-primary` |
| Unread badge | `bg-primary text-primary-foreground` | Same |
| Compose box border | `border-border` | `border-border` |
| Code block background | `bg-muted/30` | `bg-muted/30` |
| Reaction pill (own) | `border-primary/50 bg-primary/10` | Same |
| System messages | `text-muted-foreground` | Same |

All colors use theme CSS variables - no hardcoded colors anywhere. The user's accent color (primary) tints active states, badges, and interactive highlights consistently.

### 15.20 Animations

| Animation | Duration | Easing | Trigger |
|-----------|----------|--------|---------|
| New message appear | 250ms | `ease-out` | `.bubble-enter` (reuse from agents) - fade in + 8px translate up |
| Hover toolbar appear | 150ms | `ease-out` | `opacity-0 -> opacity-100` on `group-hover` |
| Reaction add | 200ms | `ease-out` | Scale bounce `scale-0 -> scale-110 -> scale-100` |
| Thread panel open | 200ms | `ease-out` | Width transition on panel, or Drawer slide-in on mobile |
| Typing indicator dots | 1.4s | staggered | Reuse `.thinking-dot` from agents |
| Channel header expand | 200ms | `ease-out` | `max-height` + `opacity` transition |
| Unread separator fade | 300ms | `ease-in` | Fades out when channel marked as read |

---

## 16. Database Tables Summary

| Table | Primary Key | Purpose |
|-------|------------|---------|
| `chat_channels` | `id` | Channel/DM containers |
| `chat_messages` | `id` | All messages (root + replies) |
| `chat_threads` | `root_message_id` | Denormalized thread metadata cache |
| `chat_channel_members` | `id` | Membership + read state per channel |
| `chat_thread_members` | `id` | Thread following + read state |
| `chat_reactions` | `id` | Emoji reactions |
| `chat_guest_access` | `id` | Per-channel guest access config |
| `chat_guests` | `id` | Guest sessions |

---

## 16. Proto Services

### 16.1 `chat.v1.ChatService`

Core channel and message CRUD.

```
rpc CreateChannel(CreateChannelRequest) returns (CreateChannelResponse)
rpc GetChannel(GetChannelRequest) returns (GetChannelResponse)
rpc UpdateChannel(UpdateChannelRequest) returns (UpdateChannelResponse)
rpc ArchiveChannel(ArchiveChannelRequest) returns (ArchiveChannelResponse)
rpc DeleteChannel(DeleteChannelRequest) returns (DeleteChannelResponse)
rpc ListChannels(ListChannelsRequest) returns (ListChannelsResponse)
rpc JoinChannel(JoinChannelRequest) returns (JoinChannelResponse)
rpc LeaveChannel(LeaveChannelRequest) returns (LeaveChannelResponse)
rpc AddMembers(AddMembersRequest) returns (AddMembersResponse)
rpc RemoveMembers(RemoveMembersRequest) returns (RemoveMembersResponse)
rpc GetMembers(GetMembersRequest) returns (GetMembersResponse)

rpc SendMessage(SendMessageRequest) returns (SendMessageResponse)
rpc GetMessages(GetMessagesRequest) returns (GetMessagesResponse)
rpc GetMessage(GetMessageRequest) returns (GetMessageResponse)
rpc UpdateMessage(UpdateMessageRequest) returns (UpdateMessageResponse)
rpc DeleteMessage(DeleteMessageRequest) returns (DeleteMessageResponse)
rpc PinMessage(PinMessageRequest) returns (PinMessageResponse)
rpc UnpinMessage(UnpinMessageRequest) returns (UnpinMessageResponse)
rpc GetPinnedMessages(GetPinnedMessagesRequest) returns (GetPinnedMessagesResponse)

rpc GetThread(GetThreadRequest) returns (GetThreadResponse)
rpc GetThreadMessages(GetThreadMessagesRequest) returns (GetThreadMessagesResponse)
rpc GetThreadsInbox(GetThreadsInboxRequest) returns (GetThreadsInboxResponse)
rpc FollowThread(FollowThreadRequest) returns (FollowThreadResponse)
rpc UnfollowThread(UnfollowThreadRequest) returns (UnfollowThreadResponse)

rpc AddReaction(AddReactionRequest) returns (AddReactionResponse)
rpc RemoveReaction(RemoveReactionRequest) returns (RemoveReactionResponse)

rpc SetTyping(SetTypingRequest) returns (SetTypingResponse)
rpc MarkChannelRead(MarkChannelReadRequest) returns (MarkChannelReadResponse)
rpc MarkThreadRead(MarkThreadReadRequest) returns (MarkThreadReadResponse)
```

### 16.2 `chat.v1.ChatStreamService`

Real-time streaming (wrapped in `StreamDisconnectMiddleware`).

```
rpc StreamChannelEvents(StreamChannelEventsRequest) returns (stream ChatEvent)
rpc StreamUserChatEvents(StreamUserChatEventsRequest) returns (stream UserChatEvent)
```

### 16.3 `chat.v1.ChatGuestService`

Guest access management.

```
rpc ConfigureGuestAccess(ConfigureGuestAccessRequest) returns (ConfigureGuestAccessResponse)
rpc GetGuestAccess(GetGuestAccessRequest) returns (GetGuestAccessResponse)
rpc RevokeGuestAccess(RevokeGuestAccessRequest) returns (RevokeGuestAccessResponse)
rpc JoinAsGuest(JoinAsGuestRequest) returns (JoinAsGuestResponse)
rpc ListGuests(ListGuestsRequest) returns (ListGuestsResponse)
rpc RemoveGuest(RemoveGuestRequest) returns (RemoveGuestResponse)
```

---

## 17. Backend Domain Structure

```
src/uniffy/domains/chat/
|-- channels/
|   |-- converters.py
|   |-- handlers.py
|   |-- operations.py      # Extends BaseContentOperations
|   |-- queries.py
|   |-- service.py
|-- messages/
|   |-- converters.py
|   |-- handlers.py
|   |-- operations.py
|   |-- queries.py
|-- threads/
|   |-- converters.py
|   |-- handlers.py
|   |-- operations.py
|-- streaming/
|   |-- handlers.py         # StreamChannelEvents, StreamUserChatEvents
|   |-- service.py
|   |-- events.py           # Domain event dataclasses
|-- guests/
|   |-- converters.py
|   |-- handlers.py
|   |-- operations.py
|   |-- service.py
|-- reactions/
|   |-- operations.py
|-- __init__.py

src/uniffy/core/models/chat/
|-- channel.py
|-- message.py
|-- thread.py
|-- channel_member.py
|-- thread_member.py
|-- reaction.py
|-- guest_access.py
|-- guest.py
|-- __init__.py
```

---

## 18. Frontend Feature Structure

```
src/ui/src/features/chat/
|-- api/
|   |-- chatApi.ts              # Channel + message CRUD
|   |-- chatStreamApi.ts        # Streaming client
|   |-- chatGuestApi.ts         # Guest access
|-- store/
|   |-- chatChannelsSlice.ts    # Channel list state
|   |-- chatChannelsThunks.ts
|   |-- chatMessagesSlice.ts    # Messages per channel
|   |-- chatMessagesThunks.ts
|   |-- chatThreadsSlice.ts     # Thread state
|   |-- chatThreadsThunks.ts
|   |-- chatUiSlice.ts          # UI preferences (persisted)
|   |-- index.ts
|-- components/
|   |-- ChatLayout.tsx          # Main 3-panel layout
|   |-- sidebar/
|   |   |-- ChatSidebar.tsx
|   |   |-- ChannelList.tsx
|   |   |-- DirectMessageList.tsx
|   |   |-- ChatSidebarSkeleton.tsx
|   |-- channel/
|   |   |-- ChannelHeader.tsx
|   |   |-- ChannelView.tsx
|   |   |-- MessageList.tsx
|   |   |-- MessageItem.tsx
|   |   |-- ThreadFooter.tsx
|   |   |-- TypingIndicator.tsx
|   |-- compose/
|   |   |-- MessageCompose.tsx
|   |   |-- EmojiPicker.tsx
|   |   |-- FileUploadButton.tsx
|   |-- thread/
|   |   |-- ThreadPanel.tsx
|   |   |-- ThreadsInbox.tsx
|   |-- reactions/
|   |   |-- ReactionBar.tsx
|   |   |-- ReactionPicker.tsx
|   |-- modals/
|   |   |-- CreateChannelModal.tsx
|   |   |-- ChannelSettingsModal.tsx
|   |   |-- GuestAccessModal.tsx
|   |   |-- InviteMembersModal.tsx
|   |-- encryption/
|   |   |-- EncryptionBadge.tsx
|   |   |-- RecoveryKeyModal.tsx
|   |   |-- VerificationStatus.tsx
|-- hooks/
|   |-- useChatStream.ts        # Channel event stream (long-lived)
|   |-- useUserChatStream.ts    # User-level unread stream
|   |-- useChannelMessages.ts
|   |-- useThreadMessages.ts
|   |-- useTypingIndicator.ts
|   |-- useUnreadCounts.ts
|-- pages/
|   |-- ChatPage.tsx
|-- utils/
|   |-- chatUtils.ts
|-- index.ts
```

---

## 19. MVP vs Post-MVP

### MVP (v1)

- Public and private channels
- Direct messages (1:1) and group DMs
- Mattermost-style collapsed reply threads with RHS panel
- Threads inbox
- Real-time message delivery via ConnectRPC streaming + Valkey pub/sub
- Typing indicators
- Emoji reactions
- File sharing via attachments system
- Inline image/file previews
- Message editing and deletion
- Pinned messages
- Unread tracking (channel + thread level)
- @mention notifications
- Channel member management
- Full-text search integration (Meilisearch) with scoped visibility rules
- In-channel search (`Ctrl+F`) with filters
- Universal @ mentions (reference any Uniffy content)
- Bookmarkable channels
- Agent tools for chat (non-E2E channels)
- Keyboard shortcuts
- Responsive design (desktop, tablet, mobile)
- Zen mode support
- Presence indicators (online/offline/away) - see `docs/specs/presence-spec.md`
- Live content previews in mention chips - see `docs/specs/live-mentions-spec.md`
- Channel resource panel (auto-populated from message URN references)
- Smart quick actions from messages (create task, event, note, reminder from any message)

### Post-MVP (v2)

- E2E encryption (MLS protocol)
- Recovery key management
- Device verification UI
- Guest access (invite link, password, email)
- Guest UI (minimal chat interface)
- Channel archiving with export
- Message forwarding to other channels
- Scheduled messages
- Custom emoji
- Message bookmarks (save individual messages)
- Channel categories/folders in sidebar
- Read receipts (who has seen a message)

### Future (v3+)

- Voice calls (WebRTC)
- Video calls (WebRTC)
- Screen sharing
- Compliance key escrow for E2E channels
- Huddles (persistent audio rooms)
- Slack Connect-style cross-org federation
- SCIM integration for guest lifecycle management
- Client-side encrypted search for E2E channels
- Message translation

---

## 20. Resolved Design Decisions

### 20.1 Channel Creation Permissions

**Decision: Configurable per org, default to "any member".**

- Default: any org member can create PUBLIC and PRIVATE channels
- Org admins can restrict channel creation to admins only (org-level setting in `OrganizationSettings`)
- DMs and Group DMs can always be created by any member (no restriction)

### 20.2 Message Retention Policies

**Decision: Org-level and per-channel retention, shipped as v2.**

- Org admin sets a default retention period (e.g., 90 days, 1 year, forever)
- Per-channel override available to admins (e.g., #compliance keeps forever, #random deletes after 30 days)
- ARQ cron job runs nightly to purge expired messages from PostgreSQL and Meilisearch
- E2E channels: server deletes ciphertext on schedule, but clients with cached keys may still have local copies - document this in the E2E trade-offs UI
- MVP ships with "forever" retention only; configurable retention is post-MVP

### 20.3 Bot/Webhook Support and Slack-Compatible API

**Decision: Post-MVP (v2/v3). Plan for a Slack-compatible API layer.**

- **Incoming webhooks** (external services POST to a channel): high value for CI/CD, monitoring, alerting. Post-MVP.
- **Outgoing webhooks** (channel events trigger external URLs): lower priority. v3.
- **Slack-compatible API**: A compatibility layer that accepts Slack webhook formats and Bot API calls, allowing existing Slack integrations to work with Uniffy with minimal changes. This is a significant differentiator for migration. v3.
- For MVP, AI agents cover the "automated messages in channels" use case

### 20.4 Channel and Group DM Size Limits

**Decision: 8 for Group DM, unlimited for channels.**

- Group DMs: max 8 participants (lightweight, no admin/moderation)
- Need more than 8? Create a proper channel (which has roles, settings, moderation)
- Channels: no hard member limit. Valkey pub/sub handles large fan-out natively

### 20.5 Message Size Limits

**Decision: 30,000 characters with smart overflow prompt.**

- Backend rejects messages over 30,000 characters with a validation error
- Frontend shows a character counter when approaching the limit (appears at 28,000+)
- **Smart overflow prompt**: When a user pastes or types content that exceeds 30,000 characters, the compose box shows an inline prompt: "This message is too long. Would you like to create it as an attachment instead?" with options:
  - **"Create as note"** - opens a new note with the content pre-filled, inserts a `[[[Note title|urn:uniffy:content:NOTE:uuid]]]` mention in the message
  - **"Create as file"** - saves as a `.txt` / `.md` file attachment on the message
  - **"Trim message"** - truncates to 30,000 and lets the user edit
- This turns a limitation into a feature - long content gets proper storage and is searchable/referenceable

### 20.6 File Upload Limits

**Decision: Use the existing org-level file and attachments system. No chat-specific limits.**

- Files shared in chat go through the standard `FilesService` upload + `AttachmentsService` linking
- Org-level storage quotas and per-file size limits apply uniformly
- No new file infrastructure needed

### 20.7 Thread Depth

**Decision: Flat replies only (Mattermost model).**

- No nested/recursive threads. All replies in a thread are siblings at the same depth
- To "reply to a reply," users @mention the person in their flat reply
- Keeps the data model, UI rendering, notification logic, and mobile experience simple
- Proven pattern across Slack, Mattermost, Teams, and Discord

### 20.8 Default Channels

**Decision: Yes, admin-configurable with a mandatory #general.**

- Every org gets a `#general` channel auto-created on org creation (seed data)
- `#general` is a **system channel**: cannot be deleted or archived, but can be renamed and customized
- Org admins can mark additional channels as "default" in channel settings
- New members auto-join all default channels on org membership creation
- Default channels cannot be left by members (they can mute but stay as members)
- `#general` is the landing channel when a user first opens `/chat`

---

## 21. Future Considerations

Items explicitly identified during design that are out of scope but should inform architectural decisions:

| Item | Timeline | Notes |
|------|----------|-------|
| Voice/video calls (WebRTC) | v3+ | Channel header should have a "call" button placeholder in the UI from v1 (disabled with "Coming soon" tooltip) |
| Slack-compatible API | v3+ | Design the webhook/bot data model to be Slack-format-compatible from the start |
| ~~Presence indicators~~ | ~~v2~~ | Moved to MVP |
| Message translation | v3+ | Run through the agent system or a dedicated translation worker |
| Huddles (persistent audio rooms) | v3+ | Lightweight always-on audio channels, separate from formal calls |
| Cross-org federation | v3+ | Requires identity bridging; significantly harder than guest access |
| SCIM integration for guests | v3+ | Auto-deprovision guests when their external identity changes |
| Client-side encrypted search | v3+ | Local encrypted index per device for E2E channels |
| Channel categories/folders | v2 | User-defined sidebar organization (like Slack sections) |
| Custom emoji | v2 | Org-uploaded emoji with a picker extension |
| Scheduled messages | v2 | Compose now, send later; ARQ cron job |
| Read receipts | v2 | "Seen by X, Y, Z" on messages; privacy toggle per user |
| Message forwarding | v2 | Forward a message to another channel with attribution |
