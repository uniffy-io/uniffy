## Core

- [x] Organizations and Groups Support
- [x] User Authentication and Authorization
- [x] Multi-Tenancy Support
- [x] Global Configurable Keybindings System
- [x] Global Theming and Appearance Settings
- [x] Backend background jobs architecture
- [ ] OIDC Integration
- [ ] SSO Support
- [ ] Advanced Role-Based Access Control (RBAC)
- [ ] Audit Logging

## Settings

- [x] User Settings Management
- [x] Keybinding universal management
- [x] Settings profile for easy switching
- [x] Notification channel preference matrix (per-type x per-channel toggles)
- [x] Desktop and email master switches with per-type overrides
- [x] Email frequency selector (instant, hourly digest, daily digest)
- [ ] Quiet hours configuration (time-based notification suppression)
- [ ] Per-organization notification defaults (admin-set baseline)
- [ ] Import/export settings profiles

## Notifications

### Infrastructure (done)
- [x] Event bus with fire-and-forget ARQ job enqueue (emit_notification)
- [x] NotificationEvent dataclass for cross-domain event emission
- [x] Valkey Pub/Sub layer (separate DB from ARQ queue) for real-time fan-out
- [x] Notification and PushSubscription database models with migration
- [x] NotificationType enum (9 types: content, calendar, permissions, system)
- [x] ConnectRPC NotificationsService with 8 RPCs including server streaming
- [x] Proto definitions for notifications and settings channel preferences

### Delivery Adapters (partially done)
- [x] DeliveryAdapter ABC with channel_name, deliver, startup, shutdown interface
- [x] DELIVERY_ADAPTERS registry mapping channel names to adapter instances
- [x] InAppAdapter: DB record creation with batch commit + Valkey Pub/Sub real-time publish
- [ ] PushAdapter: Web Push via pywebpush with VAPID key management
- [ ] EmailAdapter: SMTP delivery via aiosmtplib with HTML templates
- [ ] Email digest cron job (aggregate unread notifications for hourly/daily users)
- [ ] Stale push subscription cleanup cron (remove endpoints returning 410 Gone)

### Worker Pipeline (done)
- [x] process_notification_event: recipient resolution, preference check, adapter fan-out
- [x] Automatic recipient resolution (explicit list, org members, content bookmarkers)
- [x] Per-user delivery channel resolution from settings preferences
- [x] Batch DB commit for in-app notifications + post-commit Pub/Sub publish
- [x] Standalone deliver_push_notification and deliver_email_notification ARQ jobs
- [ ] Deduplication/debounce (Valkey SET with TTL per actor+urn+type to prevent storms)
- [ ] Fan-out batching for large orgs (SYSTEM_ANNOUNCEMENT to 10k+ users)
- [ ] Per-user publish rate limiting in Pub/Sub layer
- [ ] Notification expiry cleanup cron (delete notifications older than 90 days)

### Domain Integration (done)
- [x] Notes: CONTENT_SHARED on create/move to shared visibility, CONTENT_EDITED on update
- [x] Calendar: CALENDAR_INVITE on create/update/add_attendees, CALENDAR_RESPONSE on RSVP
- [x] Permissions: PERMISSION_GRANTED on grant/update, PERMISSION_REVOKED on revoke
- [ ] Files: CONTENT_SHARED on file share, CONTENT_EDITED on file replace/update
- [ ] Chat: mention notifications, new message in subscribed channels
- [ ] Workflows: status change notifications, assignment notifications
- [ ] CONTENT_MENTIONED: detect @mentions in note/event content and notify mentioned users
- [ ] CALENDAR_REMINDER: scheduled reminders before event start time (requires cron)
- [ ] SYSTEM_ANNOUNCEMENT: admin broadcast endpoint in admin panel

### Frontend (done)
- [x] NotificationBell component in AppHeader with unread badge
- [x] NotificationPanel dropdown with paginated list, mark-all-read, refresh
- [x] NotificationItem with type badge, relative time, read/unread state, actions
- [x] useNotificationStream hook with ConnectRPC server streaming and exponential backoff reconnection
- [x] useNotifications, useUnreadCount, useUnreadCountPolling hooks
- [x] Redux slice with thunks for all CRUD operations
- [x] clearNotifications on logout
- [x] Channel preference matrix UI in NotificationsSection settings page
- [ ] Toast/banner for new notifications arriving while app is in foreground
- [ ] Sound playback on notification arrival (respecting soundEnabled preference)
- [ ] Click-to-navigate from notification to source content (via source_urn)
- [ ] Notification grouping/collapsing (e.g., "3 edits to My Note" instead of 3 separate)
- [ ] Empty state and loading skeleton in notification panel
- [ ] Notification search/filter in panel (by type, read/unread, date range)

### Security and Enterprise Readiness
- [ ] Rate limiting on emit_notification to prevent abuse from compromised domains
- [ ] Notification content sanitization (strip XSS from title/body before storage)
- [ ] Encryption at rest for push subscription keys (p256dh_key, auth_key)
- [ ] Audit trail for notification delivery (who received what, when, via which channel)
- [ ] Admin ability to send system announcements from admin panel
- [ ] Admin ability to view notification delivery stats (sent, delivered, failed)
- [ ] GDPR compliance: bulk-delete all notifications for a user on account deletion
- [ ] Webhook delivery adapter (outgoing webhooks for external integrations)
- [ ] Notification retention policy configuration (per-org, admin-controlled)
- [ ] End-to-end delivery confirmation (read receipts back to sender for shared content)

## Search

- [x] Search Indexing System
- [x] Global Search Functionality
- [x] Advanced Filtering Options
- [x] Keyword like search, like google does e.g note: "how to" tag:work project:xyz
- [ ] Search History and Suggestions
- [ ] Synonym Support in Search
- [ ] Search Result Ranking Customization
- [ ] Boolean Search Operators

## Notes

- [x] Notes Creation and Editing
- [x] Tree Sidebar for Notes Navigation
- [x] Editor, Markdown Editor and ReadOnly Viewer Modes
- [x] Notes Knowledge Graph
- [x] Notes Tagging System
- [x] Notes Tags Dashboard with tag management
- [x] Notes Single Tag Page showing all notes with that tag and tag details
- [x] Notes Linking and Backlinking trough the Unified Tagging System
- [x] Icons picker for notes
- [ ] Notes Versioning and History
- [ ] Suggest tags as user types his note
- [ ] Allow fuzzy search in notes wtihout the need to follow words
- [ ] Color tagging of notes

## Calendar

- [x] Day, Week, and Month view modes with navigation
- [x] Event creation and editing with date/time pickers
- [x] Multiple calendars
- [x] Proper support for categories with backend persistence
- [x] Support for color-coded events based on category
- [x] Event detail panel with markdown descriptions and @mentions
- [x] Mini calendar sidebar synced with main view
- [x] Timezone display
- [x] Bookmarks integration for quick access to events
- [x] Calendar Event single page view (navigates to calendar with event selected)
- [x] Multi-day event support with continuous visual spanning across days
- [ ] Recurring events with customizable patterns
- [ ] Event reminders and notifications
- [x] Drag and drop event rescheduling
- [x] Personal and Organization calendar separation
- [x] Event attendees management
- [ ] Event invitations with RSVP tracking
- [x] Conflict detection for overlapping events
- [ ] External calendar subscriptions
- [x] Event templates for quick creation

## Files

- [x] Base Backend Implementation 
- [x] Fast uploads and download with Browser Workers and chunked stream apis
- [x] Custom file filters, created by users that are savable and selectable in the UI
- [x] Moving Files
- [X] Files Sharing System integration
- [X] Files Tag System
- [x] Files Tags Dashboard with tag management
- [x] File Thumbnail Generation 
- [x] Global Application workers for chunked streaming of audio/video files
- [x] Files viewer for most formats
- [ ] ...
- [ ] Metadata extraction for full text search