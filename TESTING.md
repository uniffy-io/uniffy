# Manual test checklist

Pre-release smoke tests grouped by domain. Run end-to-end against a real
deployment (or a local stack with mailcatcher) before tagging a release.
Each section assumes a logged-in test user unless noted.

## How to use this file

- Run through the sections relevant to the change you are shipping.
- Items marked `(both products)` must pass on cloud-style multi-tenant AND
  single-tenant self-hosted deploys. Items marked `(cloud)` are SaaS-only.
- If a step fails, file an issue with the section + step number before
  releasing.

---

## Email infrastructure

Requires either `MAIL_FROM_ADDRESS` + `SMTP_*` set in the env, OR at
least one org configured at `/admin/email`. Local dev uses mailcatcher
(`smtp://localhost:1025`, web UI at http://localhost:1080).

### 1. Admin send-test (per-org SMTP)

1. Sign in as an org OWNER or ADMIN.
2. Open `/admin/email`. Verify the **Source** badge reads `System default`
   when no per-org row exists, or `Per-org config` when one does.
3. On the **Configuration** tab, enter `smtp.resend.com` / `587` /
   `resend` / a real Resend API key (or your test SMTP creds) /
   `Use TLS = on`. Save.
4. The page should reload with the saved values and show
   `last_test_status: not yet tested`.
5. Switch to **Send Test** and send to your own email.
6. The test mail lands within ~10s. The page updates
   `verified_at` + `last_test_status: ok`.
7. Trigger a deliberate failure: set `SMTP_PASSWORD` to garbage, save, send
   test. Page shows `last_test_status: failed` with the error message.

### 2. Suppression list

1. Add an address to `mail_suppressions` directly in the DB
   (`INSERT INTO mail_suppressions (id, email, reason, source) VALUES (gen_random_uuid(), 'bounce@example.com', 'BOUNCED', 'manual', now())`).
2. Trigger any send to that address (invite, password reset, admin test).
3. The audit log at `/admin/audit-logs` shows `Email: Suppressed` for
   that recipient. No SMTP submission happens.

---

## Invite-by-email

### 3. Invite a brand-new email (`(both products)`)

1. Sign in as org OWNER or ADMIN.
2. `/admin/members` -> **Invite member**. Enter an email that does not
   already exist as a user, pick role `MEMBER`, send.
3. Toast: "Invitation sent to <email>". The **Invitations** table below
   the member list shows a `PENDING` row.
4. The invite email lands (template `auth/invitation`) with a
   `{UNIFFY_BASE_URL}/auth/accept-invite?token=...` link.
5. Open the link in an incognito window. The page shows the inviter
   name + org name + role. Fill username + password (8+ chars), submit.
6. Redirected to `/` as a fresh signed-in member. The invitation row
   flips to `ACCEPTED` and the audit log records
   `Auth: Invitation accepted`.

### 4. Invite an email that already has an account (`(both products)`)

1. As an admin in Org A, invite the email of an existing user from Org B.
2. Toast: "<name> added to the organization". No invitation row is
   created in the `Invitations` table.
3. The existing user receives the `auth/added_to_org` email and finds
   Org A in their org switcher on next login.
4. Audit log records `Organization: Member added via invite`.

### 5. Resend + revoke

1. From the `Invitations` table, click the resend icon on a pending row.
   Toast: "Invitation resent". A fresh email is delivered with a new
   token (the old token no longer works).
2. Click the revoke icon. Confirm the dialog. Row flips to `REVOKED`.
3. Open the original accept-invite link -> "This invitation cannot be
   used".

### 6. Invite-only registration gate (`(both products)`)

1. Set `ALLOW_PUBLIC_REGISTRATION=false` in env, restart backend.
2. Open `/auth` in incognito. The Sign in / Register pill toggle is
   gone; only the Sign in form renders.
3. Direct POST to `auth.v1.AuthService/Register` -> `INVALID_ARGUMENT`
   "Public registration is disabled. You must be invited." Audit log
   records `Auth: Registration rejected`.
4. Set `ALLOW_PUBLIC_REGISTRATION=true`, restart, hard-refresh `/auth`.
   The Register tab is back.

---

## Password reset

### 7. Reset flow, enabled org (`(both products)`)

1. Pick a test user with a primary org (any active member).
2. Open `/auth/forgot-password` in incognito. Enter the user's email,
   submit. Page shows "If an account exists for <email>, a reset link
   is on its way."
3. The `auth/password_reset` email lands within ~10s with a
   `{UNIFFY_BASE_URL}/auth/reset-password?token=...` link, branded
   with the user's primary org name + SMTP config.
4. Open the link. Page shows the bound email + the "All existing
   sessions will be signed out" notice.
5. Enter a new password (8+ chars) + confirm. Submit.
6. Page flips to "Password updated". Click **Sign in**.
7. Old refresh tokens are rejected -- the existing session in the
   original tab is signed out on next request because
   ``User.token_version`` bumped.
8. Audit log records `Auth: Password reset requested` then
   `Auth: Password reset completed`.

### 8. Reset flow, no-enumeration guarantee

1. Open `/auth/forgot-password`. Submit a non-existent email.
2. The success-state UI is identical to the real-account case (same
   wording, same timing).
3. Audit log records `Auth: Password reset requested` with details
   `outcome: no_user`; no email is sent.

### 9. Per-org toggle (`(both products)`)

1. As org OWNER/ADMIN, open `/admin/security`. Toggle **Password
   reset** off. Toast: "Password reset disabled for this organization".
2. The same user from step 7 requests a reset. UI shows the same
   success message; no email is sent.
3. Audit log records `Auth: Password reset blocked` with details
   `reason: disabled_for_org`.
4. Toggle back on; reset works again.

### 10. Expired / used / unknown token

1. Take a fresh reset URL, wait 31 minutes.
2. Open the URL -> "This reset link cannot be used: Reset link has
   expired".
3. Successfully consume a valid token, then click **Reset password**
   from the success page -> "Reset link has already been used".
4. Tamper with the token query parameter -> "Reset link is invalid".

---

## Uploads (unified engine)

The upload engine is module-level and lives outside the React tree, so uploads
survive navigation. The floating transfers tray mounts at app root.

- [ ] Drag 100 small files onto `/files`, then immediately navigate to `/notes`.
      Uploads keep running and stay visible in the floating tray (they do not
      abort on leaving `/files`).
- [ ] While that batch runs, confirm the UI stays responsive (no main-thread
      freeze) and the tray progress updates smoothly (throttled, not per-chunk).
- [ ] Start a small-file upload, reload the page mid-upload. It resumes from the
      first missing part (watch the network tab: completed parts are not re-sent).
- [ ] Start an upload of a file larger than the persist limit (~50 MB), reload
      mid-upload. It is marked failed with a "re-select to upload" message rather
      than silently lost.
- [ ] Cancel an in-flight upload from the tray. The worker stops (no further
      `UploadChunk` POSTs in the network tab) and the row shows cancelled.
- [ ] Tray view-states: minimize to the pill, expand it again, then hide it. With
      it hidden, start a new upload - it stays hidden (sticky). Press `Ctrl/Cmd+U`
      (or rebind via Settings) to bring it back.
- [ ] With the tray hidden, force an upload to fail (e.g. kill the backend) -
      a toast still appears (failures break through a hidden tray).
- [ ] Chat: attach a large file in a channel. The composer stays responsive
      (off main thread); navigating away does not orphan it. The attachment does
      NOT appear in the global tray (chat shows progress inline).
- [ ] Editor: paste a large image into a note. The editor stays responsive and
      the upload shows in the global tray.
- [ ] Recording: record a screen capture, then reload before it finishes
      uploading. Recovery still completes the recording (now via the shared
      `uniffy-uploads` IndexedDB store).
- [ ] Recording: capture a mostly static screen (low bitrate, well under 5 MiB
      per minute) for at least two minutes, then stop. The upload completes and
      the backend log shows no `EntityTooSmall` on CompleteUpload.
- [ ] Recording: capture a static screen for about a minute, then kill the tab
      (not a reload) and reopen the app. Recovery completes the recording with
      only the last few seconds missing.
- [ ] Recording: record as user A, log out, log in as user B in the same
      browser and record again. The file lands in B's own `Recordings` folder
      (no `Permission denied: view on folder`), the first-use consent modal
      shows once for B, and B's recent list starts empty.
- [ ] Recording: open the recording right after stopping, while the
      transcode is still running. The viewer shows "Preparing this video for
      playback" instead of a player error, and the player appears on its own
      once the transcode completes, without a reload. Download stays disabled
      until then.
- [ ] Recording: keep the `Recordings` folder open while a recording is
      processed. The card swaps its icon for a real frame thumbnail within a
      few seconds of the thumbnail job finishing, and the download button
      enables when the transcode finishes, both without a reload.
- [ ] Files: rename a video to a Cyrillic name such as `1ф.mp4`. It still
      plays in the viewer and downloads with that name (the media and file
      routes used to 500 on a non-Latin `Content-Disposition`).
- [ ] Files: rename a file in list and grid view. The extension sits outside
      the input as a fixed suffix and cannot be edited; renaming through the
      API to a different extension is rejected with "The name has to keep its
      .mp4 extension". Folders rename as before.
- [ ] Mobile: rename a file from the item sheet. The extension shows as a
      fixed grey tail inside the field and the keyboard edits only the stem.
      A failed rename (e.g. offline) shows a "Rename failed" alert instead of
      silently closing. Folders show no tail.

## Authenticated assets (cookie read-path)

Images/video/audio are served same-origin and authenticated by the `asset_read` cookie (Secure/HttpOnly,
set on login/refresh). There is no service worker auth proxy. Run these in a SECURE context (https or
`localhost`) - over a plain-http non-localhost host the browser disables service workers AND may drop the
Secure cookie, so several of these cannot be exercised there.

- [ ] Log in, then hard-reload a page with an embedded image (a note with a pasted image, or `/files`).
      The image renders - the cookie is present on first paint. (DevTools: the `<img>` request has no
      `Authorization` header and a `Cookie` carrying the asset token; response is `200`.)
- [ ] Open a video attachment and scrub the timeline. Seeking works - DevTools shows `206 Partial Content`
      with `Content-Range` on `/api/media/...` requests.
- [ ] Log out, then request an asset URL directly (paste `/api/files/{org}/{file}` in a new tab while
      logged out). It returns `401` - the cookie was cleared on logout.
- [ ] Leave a page with images open well past the cookie TTL (default 60 min) idle, then trigger a new
      image load. It recovers (the `onError` handler refreshes the cookie and retries) rather than staying broken.
- [ ] Self-hosted over plain http on a LAN: set `ASSET_COOKIE_SECURE=false`, confirm images still load
      (with it left `true`, the browser drops the cookie over http and assets `401`).
- [ ] Mobile / native client: assets (thumbnails, chat images, avatars, PDF/audio previews) load via the
      asset cookie sent as an explicit `Cookie` header (delivered in auth response bodies). Verify a chat
      image request carries `Cookie: ...uniffy_asset=...` and no `Authorization` header.
- [ ] Mobile: leave the app backgrounded past the access-token TTL (default 15 min), reopen it. Queries and
      images recover without a logout (foreground refresh + 401 retry).
- [ ] Mobile: revoke the device's session from the web app (Settings > Sessions). The next interaction in
      the mobile app lands on the login screen instead of browsing empty screens.
- [ ] Mobile: log in on an MFA-enabled account (TOTP) and on a forced-enrollment org. After both flows,
      images/avatars render immediately (VerifyMfa / ConfirmEnrollment deliver the asset cookie too).
- [ ] Mobile: log out. Cached content is gone - reopening the app shows the login screen and no stale
      images flash from the expo-image disk cache after logging in as a different user.
- [ ] Mobile, user in two orgs: pick org A, browse, then switch to org B (select-org). No org-A content
      (lists, images) surfaces in B, and the app keeps working after the switch (the switch mints a new
      session; the old one shows as revoked under web Settings > Sessions).
- [ ] Enable push notifications (Settings), confirm the dedicated `/notification-worker.js` registers and a
      test notification displays + click-through focuses the app. (The media worker is gone; push is its own worker.)
- [ ] Push click routing, both paths: with the app open in a tab, a push click focuses that tab and lands on the
      content (chat mention -> the message, note share -> the note). With every tab closed, the same click opens a
      window on the content, not on the dashboard. Unresolvable targets land on `/notifications`.
- [ ] A user who had the OLD `media-stream-worker` installed loads the app once: it is unregistered on boot
      (Application > Service Workers shows it removed) and assets still load via the cookie.

## Attachments - staging privacy and parent-derived access

Editor/chat uploads land in the personal Attachments staging folder as `OWNER_ONLY` and are linked in
place on attach; readers reach the bytes only through the parent they can view.

- [ ] Paste an image into a private (owner-only) note. As a second org member: the note is denied, the
      image's `/api/files`, `/api/thumbnails`, and `/api/media` URLs all return 403, and the filename
      appears nowhere in global search or mention lookup.
- [ ] Share that note as Viewer with the second member: the embedded image renders and its byte routes
      return 200 for them, without any share on the file itself. Revoke the note share: bytes 403 again.
- [ ] Send a file into a private chat channel. A non-member cannot fetch the attachment bytes; a channel
      member can. The attachment chip in the message resolves for members and shows Restricted for others.
- [ ] Attach the same uploaded file to an org-visible (OPEN_TO_ORG) note: the file moves to the
      Organization Attachments folder, becomes org-searchable, and the note's embedded URL keeps working.
- [ ] Permanently delete a note with pasted images (trash, then empty trash): the attachment rows, file
      rows, and bytes are gone (owner's byte route 404s). Deleting a channel does the same for its
      message attachments. Removing an image from a note and saving detaches that image's staged file.
- [ ] An explicit BLOCKED grant on the attachment file itself denies the bytes even for someone who can
      view the parent.

## Sharing surfaces - calendar events, rooms, automations

- [ ] Event detail modal shows Share for the organizer (manage role); the access dialog lists members and
      offers Owner only / Specific people but NOT "Everyone in org" (events are invite-only; the backend
      also rejects it). A shared-in Viewer sees the event; revocation removes it.
- [ ] Rooms: the room detail panel and the rooms table row offer Share to the owner/manager; Edit/Delete
      row actions are hidden without the matching role. A shared Viewer can see/book per role.
- [ ] Agent automations (`/agents/automations`): the task detail header offers Share to the task owner.
      Transferring ownership repoints the execution identity (the task runs as the new owner).
- [ ] Sharing an agent to a member makes it appear in their chat agent picker without a reload;
      BLOCKED/unshare removes it live from an already-open picker.

## Calls: screen-share quality

The screen-share ceiling is layered: env default (`CALLS_DEFAULT_SCREEN_SHARE_QUALITY`) ->
org policy cap (admin) -> per-user pick, clamped to the cap. Simulcast stays on, so viewers
downshift per network; the ceiling only sets the top rung. A 1:1 direct call defaults to MAX.
Needs two browsers on two machines/networks to exercise the adaptive downshift.

- [ ] Share a screen in a 1:1 DM on a Retina/high-DPI display. The other side, viewing the
      focused tile large, sees the full native layer (crisp text) - not the ~720p downscale.
- [ ] Throttle the DM viewer's network (DevTools > Network > slow profile). Its share tile
      steps down to a lower rung and stays smooth rather than freezing.
- [ ] Start a channel call (3+ people). Its default ceiling is BALANCED (not MAX) - the sharer's
      quality menu shows Balanced selected under Auto.
- [ ] In the in-call controls, open the screen-share quality menu (caret next to the screen
      button). Pick a tier; start a share; confirm it applies. Pick Auto; it follows the cap.
- [ ] As an org admin, open `/admin/calls`, set the max screen-share quality to Balanced, save.
      Back in a call the user's quality menu no longer offers High/Max, and a DM share is clamped
      to Balanced (the org cap wins over the DM MAX default).
- [ ] Change the quality pick, reload the page, rejoin a call - the pick persisted (redux-persist).
- [ ] Self-host sanity: with `CALLS_DEFAULT_SCREEN_SHARE_QUALITY` unset, a channel call defaults
      to BALANCED and a DM defaults to MAX with no admin action.

## Calls: TURN relay mode (k8s/STUNner)

Relayed media path: with `TURN_SERVER_URLS` + `TURN_SHARED_SECRET` set, join-shaped RPCs return
per-user ephemeral TURN credentials and a RELAY transport policy. With the env unset (VM/compose
direct media), nothing changes anywhere.

- [ ] On a k8s/STUNner deployment, join a call. It connects and `chrome://webrtc-internals` shows
      selected candidate pairs of type `relay` (not `srflx`/`host`).
- [ ] stunnerd logs show the TURN username as `<expiry-unix>:<user_id>` for the joining user, and
      two different users show two different usernames.
- [ ] Leave and rejoin: the new connection uses a fresh username (new expiry timestamp).
- [ ] VM/compose mode with TURN env unset: calls still connect via LiveKit's embedded TURN,
      responses carry no ice_servers, and webrtc-internals shows the usual candidate mix.

## Calls: mobile client

The phone carries the controls a phone can reasonably offer. Needs a dev build on each platform
(the Android screen-share service and the iOS broadcast extension are native changes, so a JS
reload is not enough), a second participant on web for the screen-share and roster halves, and a
Bluetooth or wired headset for the routing steps. (both products)

Screen sharing

- [ ] Android: share the screen from the in-call controls: the system capture consent dialog
      appears, the other participant sees the screen, and the ongoing-capture notification is in
      the shade.
- [ ] Android: declining the consent dialog leaves the call running with no error modal.
- [ ] Android: stopping the share from the notification shade updates the button and the roster,
      not just the remote side.
- [ ] iOS: share the screen from the in-call controls: the system broadcast picker lists Uniffy,
      Start Broadcast starts the share, the red status pill appears, and the other participant
      sees the screen within a few seconds.
- [ ] iOS: dismissing the picker without starting publishes nothing: the button stays off and the
      roster shows no share (the control waits for the extension to report it started).
- [ ] iOS: stopping from the red status pill, or from the button, updates the button and the
      roster; the system shows "Screen sharing stopped" rather than an error.
- [ ] Backgrounding the app while sharing keeps the share and the audio alive; the camera stops.
- [ ] As an org admin, drop the max screen-share quality in `/admin/calls`, rejoin, and confirm
      the picker (long-press the share button) offers no tier above the cap.
- [ ] Deliberate difference: the cap limits what the phone PUBLISHES (bitrate and simulcast
      layers), not what it captures - React Native's getDisplayMedia takes no capture constraints.
- [ ] A dev client built without the native pieces (the Android permission, the iOS extension)
      shows no share button at all rather than a broken one.

Before joining

- [ ] The pre-join replaces the current screen rather than sliding up as a sheet (the camera
      preview cannot paint inside a native modal on iOS); the header back returns to where you
      were, and so does the Android back button.
- [ ] The pre-join shows a live camera preview when the camera is on, mirrored for the front
      lens, and the front/back switch flips it. The lens chosen here is the one the call opens
      with.
- [ ] Leaving the pre-join with the camera on releases the camera (the OS indicator clears).
- [ ] Tapping Join with the camera on releases the preview before the call opens its own camera:
      the call comes up with video rather than listen-only.
- [ ] The audio-output row lists the real routes (Android: speaker, phone, wired headset,
      Bluetooth; iOS: Automatic and Speaker, plus a More outputs row that opens the system
      picker for AirPods, Bluetooth and AirPlay); choosing one is remembered and applied on the
      next call.
- [ ] iOS: after the system picker closes, the camera preview still paints (nothing is stacked
      over the pre-join by the app itself; the system sheet is the one exception to verify).
- [ ] Deliberate difference: there is no microphone picker - on a phone the input follows the
      selected audio route.
- [ ] The preview opens in Fit (the whole captured frame, letterboxed); the chip beside the flip
      switches to Fill (edge to edge, sides cropped) and the choice sticks into the call and the
      next one. Pinch magnifies, double tap returns to the start.
- [ ] Deliberate difference: this is presentation only. The lens has no zoom control - the WebRTC
      layer exposes no zoom constraint - and remote participants always receive the full captured
      frame regardless of the local setting.
- [ ] While in a call, tap the live pill of a different channel on the chat list: the pre-join
      says to leave the current call first, Join is disabled, and closing it leaves the running
      call's audio untouched.

While the call runs

- [ ] Minimise the call: the banner carries mute, camera, and hang up, and using them does not
      expand the call.
- [ ] Connect a headset mid-call: it appears in the route sheet (iOS: through More outputs) and
      selecting it moves the audio.
- [ ] A shared screen on the stage pinches to zoom and pans; double tap returns it to fit.
      Ending the share resets the zoom.
- [ ] The participants button in the call header opens a roster; as host, a remote row offers
      Mute microphone and Remove from call without a long press.

Recovery and state

- [ ] Force-stop the app mid-call and reopen it: a prompt offers to rejoin, and Rejoin puts you
      back in the call muted with the camera off.
- [ ] Dismissing that prompt does not offer it again on the next launch.
- [ ] Lose the network mid-call until "Lost connection to the call" appears, restore it, and tap
      Rejoin: the call reconnects with the lens you had before.
- [ ] Open a channel with a call already running, straight from a cold start: the live pill is
      there on first paint rather than after the chat stream reconnects.
- [ ] Tap the live pill on a chat-list row: the pre-join opens for THAT channel and the list does
      not navigate.
- [ ] Accept a ring: the pre-join opens for the ringing call, and Join lands in that call.
- [ ] Against a backend with LiveKit unconfigured, the call button stays put and tapping it says
      why instead of the button silently disappearing.

Accessibility

- [ ] With TalkBack or VoiceOver on, every in-call control is named, participant tiles read as
      "<name>, camera off, muted", and the host actions are reachable without a long press.
- [ ] The reconnecting and second-device banners are announced when they appear.

## Calendar inline event editing

The event detail modal is the only event surface and edits every field in place; there is no
separate edit modal, no right-sidebar mode, and no view-mode toggle in the header. Needs the
organizer (A) and an attendee who is not the organizer (B).

- [ ] As A, click an event. Title, date, times, repeat, reminders, location, meeting mode, room,
      category, tags and focus time are all editable in place. No pencil button anywhere.
- [ ] Each committed change fires exactly ONE `UpdateEvent`. Typing in the title or location does
      NOT fire per keystroke - the write lands on blur or Enter.
- [ ] Escape in a text field reverts the draft and does not close the modal.
- [ ] Move the start past the end: the end shifts by 30 minutes and both ride one request.
- [ ] On a recurring event, changing title / time / location / category / focus opens the scope
      dialog once. Picking a scope applies it; cancelling discards the change.
- [ ] On a recurring event, changing the channel binding, room, tags, reminders or attendees does
      NOT prompt for scope - those are series-level and the backend ignores a per-occurrence
      scope for them. Bind a channel on a recurring event: no dialog, and "Join meeting" appears.
- [ ] Open the description editor, type, and close it (Done, Escape, or backdrop). One write, and
      re-opening with no edits writes nothing.
- [ ] The modal scrolls internally - long descriptions do not overflow it, and the delete confirm
      and recurrence-scope dialogs render ABOVE the modal, not behind it.
- [ ] Escape closes the innermost surface first: with the scope dialog open it cancels the dialog
      and leaves the modal open; pressing it again closes the modal.
- [ ] Closing the modal (X, backdrop, Escape) clears the selection - reopening any event starts
      clean and the page behind never scrolls while the modal is open.
- [ ] At 375px and 768px the modal still fits: it slides up from the bottom edge on mobile and no
      right-hand panel appears at any width.
- [ ] As attendee B, open the same event. Every field is read-only text, the delete button is
      gone, and the description has no Edit affordance. The RSVP buttons still work.
- [ ] Remove B's access entirely, then have B open a stale tab and try to edit: the write is
      rejected and the global error toast explains it.

## Calendar: mobile period rail label

Day view on the phone. The swing reproduced on iPhone-width screens with Wed 2 Sep 2026
selected, where the centred rail sits on the Aug/Sep pill boundary.

- [ ] Select a day within three days of a month boundary on either side: the month beside
      the rail settles once and stays; it never alternates between two months.
- [ ] Scrub the rail slowly across a month marker in both directions: the label changes only
      once a few points of the new month's first pill are showing.
- [ ] The label sits at the same distance from the screen edge as the view title above it,
      with the divider hugging it, on every screen width.
- [ ] Step onto a day whose leftmost pill is in another year: the label gains the year and the
      pills stay where they are; the next tap on a pill re-centres it as usual.

## Calendar activity log

Every event carries an activity log at the bottom of the detail modal: field edits, attendee
changes, and RSVP responses, newest first. Needs the organizer (A) and an attendee (B).

- [ ] Create an event. Open it: the log shows "created this event" by A.
- [ ] Rename it, move the start time, change the location, and edit the description. Each lands as
      its own entry with the new value inline; the description entry does NOT print the body.
- [ ] Add attendee B and save. One "invited B" entry. Remove B: one "removed B" entry. Adding two
      people at once produces ONE entry naming both.
- [ ] As B, RSVP Accept. As A, reopen the event: the log shows "B accepted the invite" with a green
      check and the time. B changes to Decline: a second entry, red, both kept in order.
- [ ] Clicking the same RSVP answer twice adds nothing - only real changes are recorded.
- [ ] With more than 6 entries, only the newest 6 render behind a "Show N earlier entries" toggle
      that expands and collapses.
- [ ] On a recurring event, open any occurrence: the log is the SERIES log (same entries from every
      occurrence). Cancel one occurrence and edit another: each adds a distinct recurrence entry
      naming the date.
- [ ] As B (viewer), the log is visible and read-only. Remove B's access: `ListEventActivities`
      is denied and the modal surfaces the error rather than an empty log.
- [ ] Delete an event permanently: its activity rows go with it (no orphans in
      `calendar_activities`).

## Calendar meetings (channel-bound)

An event can bind to a chat channel as a Uniffy online meeting. Join rides the existing calls
stack through the global pre-join modal; the calendar copies nothing into channel membership.
Needs user A (organizer + channel member), user B (attendee to add), and user C (non-member).

- [ ] As user A, open the event detail, switch the meeting section to "Uniffy meeting", pick a
      private channel A belongs to. The detail panel shows a "Join meeting" button.
- [ ] Flip the section to "Link": the channel binding clears and the URL input returns. Flip to
      "None": both the URL and the binding clear.
- [ ] Add an attendee (B) who is NOT in the picked channel. The picker shows "N attendees cannot
      access <channel>". Add B to the channel; the warning drops.
- [ ] As attendee B (a channel member), open the event and click "Join meeting". The global
      pre-join modal opens and join lands in the channel's call.
- [ ] As non-member C (event shared, no channel access), open the event. Join is disabled with a
      "You do not have access to this channel" note (`GetChannel` is denied for C).
- [ ] While A is in the call, B's detail panel and today list show a "Live" badge with the
      participant count. It clears when the call ends.
- [ ] Bind a recurring event's master to a channel. Every expanded occurrence, and any edited
      single occurrence, inherits the binding.
- [ ] Delete the bound channel. The event silently becomes a non-meeting event (FK SET NULL) with
      no error on the detail panel.
- [ ] Send both a meeting URL and a channel_id on one event via the API: the backend rejects with
      a validation error (the detail panel already enforces one mode).
- [ ] Mobile: open a channel-bound event. The meeting row offers a join action that opens the
      pre-join sheet, and reads "Join live meeting" while a call is running in that channel.
      An external meeting URL opens in the browser instead.
- [ ] In the editor's Uniffy-meeting mode, click "Create a meeting room from attendees". A PRIVATE
      channel named after the event is created with the attendees as members and auto-selected.
- [ ] Add an attendee to that auto-created-room event and save: the attendee appears in the channel
      (realtime member-added). Remove one: they leave the channel and are kicked from any live call.
- [ ] Confirm a PICKED channel (not auto-created) is never mutated when attendees change - only
      auto-created rooms sync.
- [ ] Delete a channel-bound event: the channel and its history remain (FK SET NULL only fires when
      the channel itself is deleted).
- [ ] `@`-mention a channel-bound event in a note or chat message. The expanded card shows a "Join
      meeting" button. Start a call in that channel: it turns rose with a live dot and "Join live
      meeting (N)"; clicking it opens the pre-join modal.

## Timezone preference + UTC pipeline

Settings > Appearance > Date & time holds the display timezone; Automatic
follows the browser. All backend storage stays UTC regardless of the choice.

- [ ] With Automatic selected, behavior matches the browser zone everywhere
      (calendar grid, chat timestamps, task due dates).
- [ ] Pick `Pacific/Auckland` on a European browser. The calendar header offset
      label updates, the grid re-renders, and an event created by double-clicking
      the 09:00 cell shows 09:00. Verify in the DB (`db shell`) that
      `start_time` is the UTC instant for 09:00 Auckland.
- [ ] Drag an event to another day in Month view: it keeps its displayed
      wall-clock time and lands on the dropped day.
- [ ] Chat: day separators agree with the timestamps rendered next to messages,
      and both follow the selected zone.
- [ ] Task due dates: a task due today is NOT overdue; the due chip shows the
      picked calendar date in any zone.
- [ ] Agents: ask "what's on my calendar today" in a channel. No request
      timezone rides chat, so the agent answers in the stored preference's zone.
- [ ] The timezone picker lists Browser Time and Coordinated Universal Time on
      top, then zones grouped by region with city, abbreviation and UTC offset.
      Searching by city, region or abbreviation filters the list.
- [ ] Week start: switch to Sunday. The calendar week and month grids, the mini
      calendar and every date picker start their weeks on Sunday; switch back to
      Monday and they follow.
- [ ] Automations: the Create task modal defaults its timezone to the effective
      display zone, not UTC.
- [ ] Mention hover local time: set a profile timezone for a second user
      (People > their profile, or Settings > Account for them) that differs
      from yours, then hover their `@` mention in chat or a note. The card's
      meta row shows "It's HH:MM for {first name}". Same zone offset as the
      viewer, or no profile timezone, shows no time row. Changing the profile
      timezone updates an already-visible card without a refresh.
- [ ] Clear back to Automatic: browser-zone behavior returns after reload.
- [ ] The preference follows the account: log in from a second browser with a
      different OS zone and see the same selected zone. (both products)
- [ ] Backend UTC smoke: start the backend with `TZ=America/New_York` on a local
      stack; permission grant expiries, audit export windows and chat mutes
      behave identically to a UTC host. (both products)

## Calendar event states and privacy

Event status (confirmed/tentative/cancelled), private events, free/busy
transparency, and out of office. Needs the organizer (A), an attendee (B),
and a member who is neither but holds a VIEWER share grant on the event (C -
grant via the event's Share dialog). (both products)

- [ ] A marks an event tentative: the grid chip fades for everyone; the detail modal shows the
      Tentative state; the mention card shows a "Tentative" badge.
- [ ] A cancels an event (Status -> Cancelled): it stays on every calendar struck through and
      faded, the detail modal shows a "Cancelled" badge, and B receives a CALENDAR_CANCELLED
      notification (in-app toast + email with mailcatcher). A does not receive one.
- [ ] The cancelled event stops blocking time: the conflict warning disappears from an
      overlapping draft in the quick-create modal, and the agent tool `calendar.get_free_busy`
      no longer returns its interval.
- [ ] B opens the cancelled event: the RSVP buttons are gone; `UpdateAttendeeStatus` via the
      notification inline buttons returns "Cannot respond to a cancelled event".
- [ ] Un-cancelling (Status -> Confirmed) restores reminders for non-declined attendees
      (check `calendar_event_reminders` rows in `db shell`).
- [ ] Recurring: cancel a single occurrence with scope "this event" - only that occurrence
      renders struck through; the rest of the series is untouched; B is notified with the
      occurrence date in the title.
- [ ] A marks an event "Free": it renders lighter on the grid, raises no conflict warnings,
      and never appears busy in free/busy answers.
- [ ] A creates an out-of-office period: it renders with the hatch + airplane treatment on the
      grid and blocks time even when all-day.

**Private event leaks nothing on every surface.** A creates "Dentist" as Private with a
location, description, attendees (B), and a booked room, then C is granted VIEWER via Share.

- [ ] C's calendar grid shows only "Busy" at the right time - no title, location, or category
      color anywhere (week, day, month, agenda, today panel, dashboard agenda).
- [ ] C deep-links `/calendar/<event-id>`: the modal shows "Busy", the time range, and a
      privacy note - no description, attendees, activity log, or referenced content. The
      `GetEvent` response carries `details_hidden=true` and empty title/location/meeting
      fields (verify in devtools).
- [ ] C searches "Dentist": no hit. A and B still find it by title.
- [ ] A message containing an `@`-mention of the event: C's chip resolves without title,
      location, or meeting URL in the `ResolveUrns` response; A retitles the event and C's
      open chip receives no title patch.
- [ ] C opens the booked room's schedule: the busy slot shows no event title.
- [ ] C asks an agent to list their calendar for that day: the tool output reads
      "Busy ... [private]" with no title. `ListEventActivities` as C returns permission denied.
- [ ] B (attendee) still sees every detail on all of the above surfaces; so does A.
- [ ] Known limit: a mention typed by A while the title was visible keeps that label inside
      the author's own Markdown - flipping the event private later redacts chips and previews,
      not other people's stored text.

## Calendar scheduling assistant

Needs an organizer (A) and two attendees (B, C) in three timezones: set A's timezone
preference to UTC, B's to Europe/Sofia, C's to America/New_York (Settings > Appearance >
Date & time), and give B custom working hours (Settings > Appearance > Working hours).
(both products)

- [ ] Working hours round trip: B sets 10:00-16:00 and drops Friday; reloading Settings
      shows the saved values; A's suggestion results change accordingly.
- [ ] A creates an event, adds B and C, opens "Find a time": the grid shows one row per
      person, non-working time dimmed per each person's own clock, an "Everyone required"
      row, and each row's label carries the person's zone and current local time.
- [ ] Suggested times all fall inside every attendee's working hours in their own timezone
      (with the three zones above, slots cluster in the shared afternoon-UTC overlap).
- [ ] A busy event on B's calendar blocks that span in B's row and pushes suggestions.
- [ ] A private event on B's calendar contributes a busy block that reveals no title
      anywhere in the panel (devtools: `GetFreeBusy` carries only intervals).
- [ ] A "Free (doesn't block time)" event does not appear as busy; a cancelled one neither.
- [ ] An out-of-office period renders hatched and no suggestion overlaps it.
- [ ] Pick a room on the event: the grid gains a room row; book the room from another
      account for a slot and confirm no suggestion proposes it.
- [ ] Toggle C to Optional on their grid row: suggestions may now overlap C's busy time but
      list "Without C"; C's row in the people section shows the Optional tag.
- [ ] "Use this time" sets the event's start and end in one action (on a recurring event the
      scope dialog appears first).
- [ ] Add more than 20 attendees: the panel shows the inline cap message, no red toast.
- [ ] Ask an agent to find a meeting time for A+B+C without naming hours: the suggestions
      respect each person's saved working hours; passing explicit hours overrides them.

## Calendar meeting polish and reminder deep links

Needs an organizer (A) and an attendee (B), and an event bound to a chat channel as a Uniffy
meeting (event editor > Online meeting > Uniffy meeting). Reminders fire from the per-minute
worker, so set a reminder offset that lands within a few minutes. (both products)

- [ ] A creates a bound meeting with a reminder and is an attendee of their own event: when
      the reminder fires, A receives it. (The organizer used to be filtered out silently.)
- [ ] Clicking that reminder in the notification panel opens the pre-join modal for the
      meeting and does NOT navigate away from the current page.
- [ ] A reminder for an event with no channel binding still opens the event at
      `/calendar/{id}`.
- [ ] Visiting `/chat/{channelId}?call=join` opens pre-join once and the URL loses the
      `call` parameter; reloading afterwards does not re-open it.
- [ ] Turn on email for "Event reminder" (Settings > Notifications) and confirm the delivered
      mail's action link is `/chat/{channelId}?call=join` for a bound meeting. With email left
      at its default the reminder arrives in-app only, never twice.
- [ ] B joins the meeting call: A's calendar grid chip for that event shows a live indicator
      with the participant count, in week/day and in month view; it clears when the call ends.
      On a chip too short for the label the indicator is a bare dot and the count is in its
      tooltip.
- [ ] Mark the event private (details hidden) or cancel it: no live indicator appears on the
      chip even while the call is running.
- [ ] Open the bound channel: the header shows a next-meeting strip with the title and a
      countdown, and a Join action; while the call is live it reads "Join now" with the live
      badge.
- [ ] The strip is absent in a channel with no upcoming bound meeting, and disappears once
      the meeting's end time passes.
- [ ] Bind a recurring event to a channel: the strip counts down to the next occurrence, not
      to the series master's original start.
- [ ] Mobile: tapping that same reminder in the notifications list opens the bound channel with
      the pre-join sheet already up. Dismiss it, leave the channel and come back - the sheet
      stays closed.
- [ ] Mobile: a reminder for an unbound event still opens `/calendar/{id}`.

- [ ] Mobile: from that reminder's channel, start the call leaving the mic toggle OFF. The call
      connects and the app stays up. Unmute during the call and it keeps running.

Mobile push reminders are not testable yet - the mobile app has no push channel, so the
notifications list above is the only mobile entry point.

## Calendar mobile parity

The mobile calendar carries the web feature set. Needs two mobile-reachable accounts
(organizer A, invitee B), at least one bookable room, one tag, and one event template.
(both products)

Respond to an invitation

- [ ] B opens A's invite from the event screen: Going / Maybe / Decline save and reflect in
      the attendee list.
- [ ] B answers straight from the notifications list: the calendar-invite row carries inline
      Going / Maybe / Decline buttons; tapping one saves without opening the event and marks
      the row read.
- [ ] On a cancelled event the RSVP bar is gone from the event screen, and answering from a
      stale notification surfaces the server's refusal.

Reminders

- [ ] Creating an event with reminder chips picked stores them; with no chips picked the
      server's defaults apply (the hint under the chips says so).
- [ ] The event screen lists reminders; an editor taps the row, changes the set, saves.
- [ ] Deliberate difference: the last reminder on an event cannot be removed (the wire cannot
      express "clear all"); the sheet keeps one chip selected.

Recurrence

- [ ] A recurrence rule can be CREATED on the create screen (pattern, interval, days, day of
      month, ends never / after N / on a date) - not only scoped when editing a series.
- [ ] Editing a series still asks for scope, and the rule can be changed or cleared
      ("Does not repeat").

Rooms

- [ ] The room picker on create/edit lists active rooms with location, capacity and
      amenities; rooms busy for the picked slot read "Busy" but stay selectable (the server
      rejects a real clash).
- [ ] The event screen shows the booked room's name, location, capacity, and amenity chips -
      for every viewer, not only editors.

Creation parity

- [ ] Attendees, tags, focus time, reminders, recurrence, room, and the state options
      (tentative / private / free / out of office) can all be set while creating; they all
      round-trip when the event is reopened.
- [ ] Deliberate difference: attendee changes on an EXISTING event stay on the event screen
      (Invite more people / attendee picker), not on the edit screen, so roles and responses
      survive.

Agenda

- [ ] The "List" view mode groups the next 30 days from the selected day under Today /
      Tomorrow / dated headers with time, location, attendee count, and a recurring glyph.

Live meetings

- [ ] While a bound channel's call runs, the event carries a red live dot in day, week, and
      month, and a "Live" pill in the agenda; cancelled and details-hidden events never
      show it.

Conflicts

- [ ] Overlapping timed events are flagged in day view (red border + warning glyph), week
      view (red border), and month view (red dot on the day cell). Cancelled and "free"
      events do not count as conflicts.

Multi-day

- [ ] A three-day event appears on all three days in day, week, month, and agenda; in week
      view the title renders only on the first day of the span.

Move by dragging

- [ ] Long-press an event in day view and drag: it snaps in 15-minute steps and saves on
      release; a recurring occurrence asks for scope first.
- [ ] Deliberate difference: drag-to-move is day-view only (week and month blocks are below
      touch-target size); a non-editor's long-press does nothing.

Filters

- [ ] The filter sheet matches web: categories (with an Uncategorised row), tags (AND
      semantics), focus-time only, and title/description search; Clear resets everything.

Templates

- [ ] "Save as template" on an event's action sheet stores it; "Use a template" on the
      create screen applies title, duration, location, meeting link, and category.

Event states on mobile

- [ ] A details-hidden event renders "Busy" / "Out of office" instead of a blank title on
      every mobile surface - the four calendar views, the event screen, and the home
      Upcoming list - with no description, location, or attendees leaking.
- [ ] Cancelled events render struck through and faded, tentative faded, free events sit
      lighter on the grid, and out of office carries its glyph and badge.
- [ ] An event-cancelled notification shows the calendar icon in the danger tone.

Activity

- [ ] "Activity" on the event screen expands to the change log with actor names and
      relative times.

Period rail

- [ ] The rail's pills follow the view: days in day view, weeks ("24 - 30") in week view,
      months in month and agenda. Switching views swaps the unit and centres the current
      period.
- [ ] Tapping a pill keeps your place in the period: the same weekday in another week, the
      same date in another month (clamped, so 31 Jan -> Feb lands on the 28th or 29th).
      Agenda is the exception and lists from the 1st, or from today in the current month.
- [ ] The pinned label at the left names what the pills cannot: the month in day and week
      views, the year in month and agenda. It follows the leftmost visible pill while
      scrolling, spells out a year outside the current one ("Jan 2028"), and rollovers are
      also marked inline between the pills.
- [ ] Scrolling the rail alone changes nothing - no refetch, no view change - until a pill
      is tapped.
- [ ] "Today" from a distant period returns and recentres the rail.
- [ ] With the largest system font size at 360dp, no pill or marker clips.
- [ ] Flipping the week-start preference between Monday and Sunday reshapes the week pills
      and the day letters.

## Calendar access gates, templates, room details, and reminders

The RSVP path and the template direct read follow the membership and grant model; a
template fills the create form; room details reach editors; reminders can be set while
creating. Needs an organizer (A), an attendee (B), a third member (C), an org admin, and
`db shell`. (both products)

- [ ] A invites B to an event. The admin deactivates B from the members admin page while
      B's session is still open: responding from the notification inline buttons or from
      `/calendar/<event-id>` returns permission denied, B's row in `calendar_event_attendees`
      stays `PENDING`, and A receives no RSVP notification.
- [ ] The admin reactivates B: the same response succeeds and A is notified.
- [ ] A creates a template from the sidebar, then in `db shell` sets its `access_mode` to
      `EXPLICIT_MEMBERS` (the web form offers no access control yet). C's sidebar does not
      list it and `GetEventTemplate` with its id as C returns permission denied. Grant C
      VIEWER through `MembersService.AddMember` (content type CALENDAR_EVENT, the template
      id): the sidebar lists it and the direct read succeeds. A BLOCKED row denies it again.
- [ ] A clicks a template carrying a title, description, category, location, meeting link,
      and a 45 minute duration: the create form opens with every field filled, the meeting
      mode on "Link", and the end time 45 minutes after the start.
- [ ] A books a room on an event and reopens it: the room picker shows the room AND the
      details card below it (name, location, capacity, amenities), and the name opens the
      room viewer. B (view only) sees the same card.
- [ ] Settings -> Notifications -> Default reminders set to 30 min and 1 day. Open the create
      form: those two chips are preselected. Switch to 1 hour only and create: the event
      carries exactly one reminder row per attendee in `calendar_event_reminders`.
- [ ] Clear every chip and create: the event stores `reminders = []` and has no reminder
      rows, even though the member has defaults. In the detail modal of an event with
      reminders, deselect the last chip: every row disappears and reopening shows none
      selected. On mobile, editing an event now allows removing the last reminder too.
- [ ] Creating a template no longer logs a Redux serializability error in the console.

## Chat synced drafts

Unsent composer text syncs across devices per channel and per thread. Needs one user logged in
on two clients (web tab A, web tab B or mobile) plus a second user for the send checks.

- [ ] Type in a channel composer, navigate to another channel and back: text and mention chips
      restore exactly (canonical Markdown round-trip).
- [ ] Type on web, wait ~2s, open the same channel on mobile: the draft appears (and the reverse
      direction).
- [ ] Edit the draft on device B while device A's composer is untouched since its last save:
      A updates live without focus or caret jumps.
- [ ] With unsaved local edits on device A, save a different draft from device B: A keeps its
      local text (last-write-wins guard), and A's next pause overwrites the server.
- [ ] Send the message from device A: the composer and pencil indicator clear on device B within
      a second (server-side clear on send).
- [ ] A thread draft and a channel draft in the same channel stay independent; each restores in
      its own composer.
- [ ] Open "Reply in thread" on a message with NO replies yet, type, pause ~2s: the draft syncs
      to the other device (first-reply thread drafts precede the thread row; regression for the
      FK bug).
- [ ] Mobile: with a synced channel draft present, long-press a message, Edit, then cancel (and
      again with saving the edit): the unsent draft text and mention chips come back in the
      composer, and the other device keeps showing the draft (nothing deleted).
- [ ] Pencil indicator shows in the web sidebar (channels + DMs) and the mobile channel list for
      any channel holding a draft (thread drafts count); it disappears after send or clearing the
      composer.
- [ ] Log out and back in: drafts are still there (server persistence; the logout path clears
      only the local slice).
- [ ] Enter edit-message mode, change text, cancel: no draft was created or overwritten.
- [ ] Kill the network, type, restore the network: the next debounce saves silently (no error
      toasts at any point).

## Team mention fanout

`@Team` notifies the team's members wherever a user mention already does. Needs a team with a
member inside a private channel and a member outside it, plus a team above 10 members for the
composer guard (`(both products)`).

- [ ] Mention a team in a members-only channel: only team members who hold a channel membership
      get the notification, titled "Mentioned {team} in #{channel}".
- [ ] The team member who is NOT in that channel sees nothing anywhere: no bell entry, no toast,
      no sidebar badge, no unread bump.
- [ ] Mention the same team in a PUBLIC channel: every active team member is notified.
- [ ] Mention a user directly AND their team in one message: they get one notification, the
      "Mentioned you" one, never a duplicate team event.
- [ ] Mention a user who is not a member of a members-only channel: they get NO notification
      (a mention must not preview a channel they cannot open).
- [ ] The recipient's sidebar mention badge increments live on send and clears when they read
      the channel.
- [ ] Add a user to a mentioned team AFTER the message was sent, then reload: the unread team
      mention now counts toward their badge (badges are membership-relative at read time; the
      notification row is a send-time snapshot and is deliberately not backfilled).
- [ ] Compose a mention of a team with more than 10 members: a "Notify team members?" dialog
      appears before the message is sent. Cancel keeps the composer text, chips, and pending
      attachments intact, and the synced draft survives. Confirm sends normally.
- [ ] A team of 10 or fewer sends with no dialog at all.
- [ ] Mention a team in a note, a task, and a calendar event: team members who can see that
      content get "Mentioned {team} in: {title}"; a member without access gets nothing.
- [ ] Edit the note/task/event without changing the team mention: no second notification
      (delta semantics). Adding a second team mention notifies only the new team.
- [ ] Mention a team in a calendar event where some team members are already attendees: the
      attendees get only the invite, not a duplicate mention notification.

## Mention chip display + flat look

`mentionDisplay` drives the default everywhere; the manual caret toggle is remembered per
surface (chat / notes / calendar / ...) per URN. Sweep in dark AND light, at 1024px and 375px
(`(both products)`).

- [ ] Setting `expanded`: expandable mentions render the full card in notes AND chat, capped
      at `max-w-md`; a mid-sentence card breaks out as a clean block splitting the lines (no
      ragged gaps, no orphaned punctuation, no inline island).
- [ ] Setting `compact`: everything renders as a flat pill; hovering an expandable pill shows
      the full-size preview card; the popover never covers the pill or its expand caret,
      including when it opens upward near the bottom of the viewport.
- [ ] Collapse a card in chat via the hover-reveal caret; the same URN mentioned in a note
      still shows a card (per-surface memory). Re-expand in chat; a reload preserves both.
- [ ] Editor: arrow-key navigation across the mention node works; click navigates; the
      expand/collapse buttons still work (capture-phase mousedown keeps skipping buttons).
- [ ] Thread/reply previews stay compact pills regardless of setting.
- [ ] Live update: rename the mentioned note in a second tab; the pill label and an open card
      both update without refresh.
- [ ] No tinted halo anywhere: cards carry the `shadow-edge` ring with no CSS border, pills a
      solid tint; the only glow is the temporary live-update pulse.

## Mention people tokens + container previews

USER/AGENT/TEAM render as Slack-style `@Name` text tokens; folders, folder-notes, and rooms
carry live container stats. Sweep in dark AND light (`(both products)`).

- [ ] User, agent, and team mentions render as `@Name` tokens in chat AND notes: primary tint,
      no border, no avatar; the line height next to plain text does not change.
- [ ] Hover a user token: card shows avatar, presence, email, status, team, job title. Hover an
      agent token: agent card. Hover a team token: member count.
- [ ] A mention of YOURSELF renders with the stronger wash than a mention of someone else.
- [ ] Editor: token click navigates; Cmd/Ctrl+click opens a new tab; token color survives the
      editor typography overrides (stays primary, not foreground).
- [ ] Folder mention: pill shows the file-count suffix; expanded card shows
      "N files · M folders · size" with the parent breadcrumb. Upload a file into that folder
      in a second tab: the count ticks without refresh. Move the file out: it ticks back.
- [ ] Note-folder mention shows "N notes"; creating/deleting a child note updates it live.
- [ ] Room mention card shows room type, seats, building, floor, and the amenities line;
      editing the room in admin updates an open card live; deleting the room tombstones it.
- [ ] Deleted user/agent/team mentions still render the tombstone chip, not a token.
- [ ] No `<div> cannot appear as a descendant of <p>` warnings in the console on chat or notes
      pages containing task cards with assignee stacks.
- [ ] Chat `@` popup: users, agents, and teams always sit above content results; the people
      group matches on names only (a query hitting everyone's shared email domain, e.g. "uni",
      must NOT flood the list with users), and it steps aside when an explicit `note:`/`file:`
      filter is typed.
- [ ] Mobile: typing `@` in a channel composer AND a thread composer raises the inline
      suggestion bar above the composer (people first, names only; bare `@` lists people);
      tapping a row inserts `@Label`, keeps the keyboard up, and the sent message renders the
      mention; the `@` tool button still opens the full-screen reference overlay.
- [ ] Mobile: user, agent, and team mentions render as `@Name` tokens (violet tint, no box,
      no icon) in chat messages, thread replies, note bodies, event and task descriptions, and
      comments; a mention of yourself carries the stronger wash; tokens wrap mid-sentence with
      the surrounding text instead of breaking onto a chip row; content mentions (notes, files,
      folders) keep the boxed chip and still navigate on tap.

## Chat notification deep links

Chat notifications name the channel as their source; the message they were raised for rides in
metadata. Needs two users, one channel, one thread.

- [ ] User B mentions A in a channel. A clicks the notification in the bell dropdown: the channel
      opens AND the mentioned message is scrolled to and highlighted, not just the channel.
- [ ] Same for the live toast, the `/notifications` list view, and the grouped view.
- [ ] B replies in a thread A follows. A clicks the notification: the channel opens, the thread
      panel opens on the right at the correct root, and the reply is highlighted.
- [ ] While already sitting in that channel, A clicks a second chat notification for a different
      message in it: the view jumps to the new message (regression for the one-shot hash guard).
- [ ] Mobile: a thread-reply notification opens the thread screen for the right root; mention and
      DM notifications open the channel.

## Notification DND, quiet hours, sound, and toasts

DND and quiet hours suppress browser push and the web chime; in-app notification rows always
arrive. Needs two users, browser push granted for the receiver, and a second browser for the
sender.

- [x] With sounds enabled (Settings -> Notifications -> Play Notification Sounds) and the app
      window unfocused or on another channel, an incoming mention plays the chime once and shows
      the toast.
- [x] Sitting in the channel with the window focused: no chime, no toast, no bell row for a new
      message notification in that channel.
- [x] Turn the sound toggle off: the toast still appears, no chime. Turn toasts off and sound on:
      chime without toast (the two settings act independently).
- [x] Receiver sets status to Do Not Disturb: no chime; the bell badge and notification row still
      appear. Back to Online restores sound.
- [ ] On a secure origin with browser push subscribed, Do Not Disturb suppresses browser push while
      the bell badge and notification row still appear.
- [x] Enable Quiet Hours: the toggle seeds 22:00 to 08:00. Set a window covering the current time
      in the receiver's profile timezone: no chime and bell rows still arrive. Unit coverage proves
      same-day and overnight boundaries.
- [ ] On a secure origin with browser push subscribed, a quiet-hours window covering the current
      profile-local time suppresses browser push while the bell row still arrives.
- [x] Set start equal to end: the settings page shows a validation error and does not save.
      Clearing a time field shows an error instead of submitting a half pair.
- [x] Disable Quiet Hours: sound resumes immediately, both fields clear server-side, and a reload
      keeps the toggle off.
- [ ] On a secure origin with browser push subscribed, disabling Quiet Hours restores push.
- [x] Add the receiver to a private channel: an "Added you to" notification reaches the bell and
      toast. Remove the receiver: a "Removed you from" notification reaches both surfaces. Delete
      the temporary channel afterward.

## Chat broadcast mentions

@channel/@here ping a whole channel at once. Needs two users in a private channel
(one of them online in a second browser), plus an org admin for the policy checks.

- [ ] Type `@cha` in the channel composer: the popup offers `@channel` with a Broadcast badge;
      selecting inserts a violet token, and the sent message shows the washed token for every
      member (no hover card, no navigation).
- [ ] User B has notification level MENTIONS on the channel: an `@channel` send still notifies B
      and lights the mention badge. A muted member gets the badge but no notification.
- [ ] `@here`: only the member with an open session gets the "Mentioned everyone active" bell
      notification; the offline member still sees the mention badge after coming back.
- [ ] In a channel with more members than the confirm threshold (admin page value, default 25) the
      composer asks for confirmation before sending; cancel leaves the composer intact.
- [ ] Admin sets "Who can send broadcast mentions" to admins only (`/admin/chat`): the broadcast
      entries disappear from a plain member's typeahead, and a hand-typed
      `[[[@channel|urn:uniffy:broadcast:channel]]]` markup send is rejected server-side. A channel
      admin and an org admin can still send.
- [ ] Mobile: typing `@` in a channel composer offers `@channel`/`@here` rows (Broadcast badge);
      sending inserts the token and other members are notified. The received message renders the
      washed token. In a 1:1 DM and an agent DM the rows do not appear.
- [ ] Mobile: broadcast into a channel larger than the confirm threshold asks via a native alert;
      cancel leaves the composer intact. With the admin-only policy a plain member gets no
      broadcast rows.

## Chat message forwarding

Run with two users in isolated browsers. User A belongs to a private source channel and both users
can read the target channel.

- [ ] User A forwards a source message with an optional comment. The target shows the comment,
      source channel link, source sender and timestamp, Markdown body, and attachment links.
- [ ] User B sees the comment and a restricted-forward placeholder in the target. The source
      channel name, source message id, sender, timestamp, content, filenames, and file ids are not
      present in the page or `GetMessages` response.
- [ ] User B cannot open the private source channel after the forward. Forwarding did not add a
      source membership or change any source access setting.
- [ ] From a 1:1 or group DM, a participant forwards a message into a shared channel. An org owner
      or chat admin who is not a participant sees only the restricted placeholder; moderator status
      does not expose the DM name, participants, content, timestamps, or attachments in the card.
- [ ] Reload both browsers. User A still sees the snapshot and User B still sees only the
      restricted placeholder.
- [ ] Add User B to the source channel and reload the target: the full snapshot is visible. Remove
      User B from the source while the target remains open: the loaded card becomes restricted.
- [ ] Delete the source message: authorized target cards become restricted live and remain so
      after reload. Delete the verification forwards and channels afterward.

## Chat edit window and edit history

Run with an org admin and an ordinary member in isolated browsers. Policy lives in
`/admin/chat`; defaults are a 60-minute window with history visible to the sender and admins.

- [ ] Member edits their own fresh message: the change lands, the "(edited)" marker appears, and
      clicking it shows the current version plus the original with timestamps.
- [ ] A second edit adds a second prior version; revisions list oldest-last with the original
      labeled. Saving the composer with unchanged content records no new revision.
- [ ] Admin sets the edit window to 5 minutes. A message older than that loses the Edit action in
      the hover menu, and a direct `UpdateMessage` call is rejected with `invalid_argument`
      "Edit window has expired".
- [ ] Admin sets the window to "Editing disabled": the Edit action disappears for fresh messages
      too, and the server rejects an edit attempt with `permission_denied`. "Unlimited" re-enables
      editing of old messages.
- [ ] With history visibility "Sender and admins": the member cannot open another sender's edit
      history (the "(edited)" marker still renders but degrades from a button to a plain span, and
      a direct `GetMessageRevisions` call is denied); the org admin and the channel admin can.
      Switching to "Everyone in the channel" makes another member's marker clickable and the RPC
      succeed.
- [ ] Policy changes persist across reload. A non-admin member cannot reach `/admin/chat`; the
      admin route gate redirects them to `/`.
- [ ] Editing a message in a DM behaves the same. Under "Sender and admins" the other participant
      cannot open the sender's history; under "Everyone in the channel" they can.

Mobile (dev client):

- [ ] With the window at 5 minutes, long-pressing an old own message shows no "Edit message" row
      in the action sheet; a fresh message still shows it. "Editing disabled" hides it everywhere.
- [ ] Tapping "(edited)" on an own message opens the edit-history sheet with the current version
      and prior versions; on another sender's message the tag is inert under "Sender and admins"
      and tappable under "Everyone in the channel". Org admins and channel admins can always tap.

## Library (bookmarks + tags)

`/library` is the one recall surface: the Bookmarks tab holds the user's private bookmarks, the
Tags tab holds the shared taxonomy, and the Knowledge Graph tab draws the mention network across
them. Run with two users in isolated
browsers; User B needs a private channel User A is initially a member of.

- [ ] User A saves one item of each kind: a note (tree context menu), a file and a folder (card
      actions), a calendar event (detail modal), and a chat message (hover menu > Save message).
      Every item appears on the Bookmarks tab newest-first with the right type badge, and each card
      navigates to the content using the server URL (the chat message lands on the exact message).
- [ ] The user menu shows a single Library entry; the dashboard Bookmarked widget shows resolved
      titles and its "View all bookmarks" link opens `/library` (not a search URL).
- [ ] Type ribbons sync to `?types=`: pick Messages, reload the page, and the filter is still
      active. The chat sidebar Saved entry opens `/library?types=chat_message`.
- [ ] With more than 50 bookmarks, "Load more" appends the next page without duplicates.
- [ ] Save the same item twice from two devices at once: one bookmark row results and neither
      client sees an error. Saving via a non-canonical URN spelling (uppercase or dashless UUID)
      resolves to the same single card rather than a duplicate.
- [ ] Removing a bookmark from the page updates the localized affordances (tree indicator, card
      icon, hover menu label) without a reload, and vice versa.
- [ ] User A saves a message in User B's private channel, then User B removes User A from the
      channel. The saved card disappears from User A's Bookmarks tab; re-adding User A restores the
      same card without re-saving.
- [ ] Delete a saved note. Its card becomes a generic "This item was deleted" card with no title,
      snippet, source, or URL anywhere in the page or the `ListBookmarkItems` response, and the
      Remove action still works.
- [ ] Tags tab: searching and the type ribbons narrow the chip cloud and the selected tag's
      content. Selecting a chip routes to `/library/tags/:slug` and the content renders as cards
      grouped by type. Tag edit (hover pencil) still opens the edit dialog. There is no Filters
      drawer and no saved filters on this surface: an inherited `?owners=`/`?sources=`/`?access=`
      URL is stripped rather than applied.
- [ ] Knowledge Graph tab: nodes render in one Unity Violet to Belonging Pink sweep with hue by
      content type, hovering a node dims the rest and highlights its edges, and clicking navigates
      to the content. On a large org a `role=status` notice reports the bounded view. "Show in
      graph" from a note, task, or event mention focuses that node; when the target is outside the
      bounded view the surface says so instead of silently ignoring the `?focus=` parameter.
- [ ] Return to the Library graph tab after five minutes away: exactly one `GetContentGraph`
      request fires on refocus, not two.
- [ ] Existing links redirect with their query intact: `/bookmarks?types=chat_message` opens the
      filtered Bookmarks tab, `/tags/{slug}` opens the tag detail, and tag chips/mentions across the
      app land on `/library/tags/{slug}`.
- [ ] Notes and Files sidebars no longer show a Bookmarks section, Calendar quick access no longer
      shows a Bookmarked filter, yet all Save/Unsave actions on the content itself still work.
- [ ] Mobile: see "Library: mobile" below.

## Agents in threads

An agent answering inside a thread is a first-class reply: it moves the thread's counters, can be
stopped from the thread, and reads that branch only. Needs one agent with a working key, one
channel, and a second thread on the same channel for the isolation checks.

- [ ] Reply in a thread on an agent's message (or @-mention the agent inside a thread). While it
      streams, the thread panel shows the working wave with a **Stop** control; clicking it ends
      the run and the trigger message shows the stopped marker.
- [ ] When the answer lands, the root message's footer counter includes it and the agent's avatar
      joins the participant stack, live, with no reload.
- [ ] Reload the page: the counter and the avatar stack are the same (the count is persisted, not
      a client-side tally).
- [ ] The counter moves by one per answer even when the turn ran tools - tool cards and results in
      the thread do not each count as a reply.
- [ ] Stop a turn before any text streams: no blank bubble is left and the counter does not stay
      inflated.
- [ ] Run two threads in the same channel with the same agent. Ask a question in thread B whose
      answer would be wrong if thread A's content leaked: the answer stays inside B's topic.
- [ ] Ask the agent in the channel (not in a thread) about something only said inside a thread: it
      does not have it. Branches are separate conversations.
- [ ] In a 1:1 agent DM, ask inside a thread "what are we talking about here": the agent names the
      thread's own topic, not the DM at large.
- [ ] Mobile: the same thread shows the new reply count and the agent avatar after the answer.

## Agents: OpenRouter and xAI provider keys

Both flows need a real key for the provider under test. Run as an org
admin; the same steps must pass on cloud-style and self-hosted deploys
(`(both products)`).

- [ ] OpenRouter: Settings -> AI -> Add Key (or `/admin/agents` -> Keys
      for an org-visible key) with provider
      `OpenRouter` and a real `sk-or-...` key -> Validate succeeds and the
      key shows valid -> the curated OpenRouter models (slugs like
      `anthropic/claude-sonnet-5`) appear in the agent model pickers ->
      send one message to an agent on an OpenRouter model -> the run log
      shows token usage and a non-null cost.
- [ ] xAI: same flow with provider `xAI (Grok)` and a real `xai-...` key
      -> Grok models appear in the pickers -> send one message on a Grok
      model -> token usage and cost are logged.

## Agents: provider key add path

Run as an org admin at `/admin/agents` -> Keys (`(both products)`).

- [ ] The add form has Provider, Label and API Key only - there is no
      credential-type picker and no visibility picker anywhere - and the
      API Key field carries the write-once note plus the "we probe the
      provider on save" note.
- [ ] The saved key's header has Enable, Validate and Remove only; there
      is no Share control and no per-key visibility icon in the list.
- [ ] As a plain org member, open a chat agent DM: the model picker lists
      models from every enabled org key.
- [ ] Paste a key with a deliberately odd shape (e.g. an OpenRouter key
      under provider `Anthropic`, or a key with no known prefix): the save
      is NOT blocked by a format check. The key lands, the detail panel
      opens on it, Status reads "Rejected by provider" and the red banner
      shows the upstream error text.
- [ ] Paste a real key for the selected provider: Status reads Valid and
      the Available Models list for that key populates.
- [ ] Reopen the saved key: only the masked hint is shown, there is no
      way to read the credential back, and the hint line says so.

## Agents: reasoning display + model parameters

Needs one agent per provider under test on a reasoning-capable model
(`(both products)`).

- [ ] Agents tab -> Overview -> Model settings -> parameters: set
      Reasoning effort on
      a reasoning model (e.g. Opus 4.8 at `xhigh`) -> ask a multi-step
      question in the agent test drawer -> a "Thinking..." pane streams
      reasoning ABOVE the answer, never interleaved with it, then flips to
      "Thought for Ns" and auto-collapses when the answer starts.
- [ ] Same agent mentioned in a chat channel: the pane streams on the
      chat message too; markdown in the reasoning (bold section headers)
      renders formatted, not as raw `**`.
- [ ] Reload the page after the reply finishes: the collapsed "Thought
      for Ns" pane is still there on the historical message (test drawer
      AND chat channel) with the same duration.
- [ ] Reload MID-stream: the live view reconnects via run replay and the
      thinking pane content survives.
- [ ] Switch the agent's primary model to a non-reasoning model: the
      Reasoning effort control disappears and stale knob values are
      dropped without an error; switching to a model that rejects
      temperature (Opus 4.8, gpt-5.x) hides the temperature/top_p
      sliders.
- [ ] Per provider (anthropic, openai, google, openrouter, xai): one
      reasoning-enabled message answers correctly with tools enabled (the
      OpenAI path must exercise a tool call - it rides the Responses
      API).
- [ ] Mobile chat: mention the reasoning agent -> the pane streams,
      collapses on answer start, and shows "Thought for Ns" when done.

## Chat: per-DM model + parameters

Agent DM channel, agents-in-chat enabled (`(both products)`).

- [ ] The composer of an agent DM shows a model control reading
      `Default (<primary model>)`; group channels and human DMs show no
      control.
- [ ] Pick another model -> send a message -> the agent run log records
      the picked model, not the agent's primary.
- [ ] Set Reasoning effort in the picker's parameters section -> next
      reply streams a thinking pane; the agent's own Overview tab config
      is unchanged.
- [ ] Switch to a model that rejects the tuned knobs -> stale values are
      stripped silently (no failed run) and the params form re-renders
      for the new model's schema.
- [ ] "Agent default" clears both overrides; the next run uses the
      agent's primary model again.
- [ ] Second device / reload: the picker shows the persisted override
      after reload (no live sync expected mid-session).
- [ ] Mobile: the sheet lists models, saves a pick, tunes a parameter,
      and clears to default; the next run reflects each change.

## Chat: mobile transcript with the keyboard up

Fresh agent chat on the phone (empty transcript), keyboard open before the first send.

- [ ] Open a new agent chat, tap the composer so the keyboard is up, send the first message:
      the message row, the "Today" separator and the agent's thinking pill sit directly above
      the composer, and the reply lands under them without dismissing the keyboard.
- [ ] Close the keyboard, then reopen it: the rows stay pinned above the composer in both
      states (nothing slides off the top of the screen).
- [ ] Open a channel that already has messages with the keyboard closed, then focus the
      composer: the newest rows stay above the composer, exactly as before.

## Chat: mobile channel list density

Chat tab on the phone, All view, with at least one unread channel, one DM and one agent
chat.

- [ ] Every channel, agent chat and DM is a single line: glyph or 24dp avatar, name, and
      nothing else at rest; a screen at the default font size shows a dozen rows.
- [ ] Unread rows read bold with a bright glyph and carry the count badge (red when the
      count includes a mention); read rows are regular weight with a dim glyph.
- [ ] A DM row shows the peer's avatar with the presence dot; a draft shows the pencil; a
      live call shows the green pill and tapping it opens the pre-join, not the channel.
- [ ] Sections are separated by a hairline rule, not the rows; folders under Agent Chats
      still indent their chats. The Threads tab and Browse rows keep their two-line layout.
- [ ] From another account, send three messages into a channel the phone has not opened, the
      last one mentioning the phone's user: the badge climbs 1, 2, 3 live without waiting for a
      poll, and turns red on the mention.
- [ ] Open a channel and its details sheet: the line under the name reads
      "Public channel · N members · Created <date>", the date gaining a year once it is not the
      current one. DMs and agent chats show their own type label with the same suffix.

## Home: mobile overview density

Home tab on the phone with a few events this week (one already over today), five notes
and four projects.

- [ ] Each section is one rounded surface with hairline-separated rows, not a card per item;
      at the default font size the first screen shows the greeting, five upcoming events
      and four notes.
- [ ] Upcoming lists only what is still ahead: this morning's finished event is gone, an
      event in progress stays. Rows sort by start time.
- [ ] The first event of each day carries the day stamp (weekday over the day number); later
      events that day leave the column empty. Today's number sits in an accent circle. The
      rule within a day starts at the text; the rule before a new day runs edge to edge.
- [ ] An event row reads title over "start · duration · location", "All day" replacing the
      time; cancelled titles are struck and tentative ones faded, as on the calendar. The day
      stamp beside a faded event keeps full strength.
- [ ] A note row shows its emoji or the note glyph, title over a one-line snippet, and the
      age on the right. A project row is a single line: glyph in the project colour, name,
      "done/total tasks". Unread chats, when any, match the project row with the count badge.
- [ ] Raise the system text size: rows grow with the text and nothing clips.

## Library: mobile

Home tab on the phone. The header button beside notifications is the Library (the same
books glyph as the web user menu); the old bookmark and tag addresses redirect into it.

- [ ] The Library opens on Bookmarks: a rail of notched ribbons hangs from the header and drops
      in with a stagger on first open, evenly spaced, each in its own hue from violet (Notes)
      towards pink (Rooms); "All" is the accent. Under the rail, the Bookmarks and Tags tabs
      carry the web sidebar's bookmark and tag glyphs, filled on the active tab.
- [ ] Tapping a ribbon grows it to full height and fills it solid; tapping another adds it (the
      set is multi-select); tapping "All" clears. The list narrows to the chosen types.
- [ ] Bookmarks group under "TODAY", "YESTERDAY", "PAST WEEK", "PAST MONTH", "EARLIER" rules with
      counts, newest first; each card shows the tinted type box, title, "type · age" under it,
      and a one-line snippet with mention markup stripped. The filled bookmark at the corner
      unsaves; a deleted item shows the generic card with Remove in the corner.
- [ ] A saved message card reads "sender in #channel" under its title and opens the channel; a
      folder card opens that folder in Files. Scrolling to the end loads the next page.
- [ ] Tags tab: search, then the chip cloud in each tag's colour with its count under an
      "ALL TAGS" rule; the ribbons narrow the cloud to tags carrying those types. "+" in the
      header creates a tag; long press on a chip offers Edit and Delete.
- [ ] Tapping a chip pushes the tag screen: "#name" with the item count, the ribbons, a summary
      line (chip, name, count, description), then cards grouped by type largest first with the
      title, snippet and age resolved live, about eight to a screen; Back returns to the cloud.
- [ ] With reduce motion on, ribbons and cards appear in place with no drop or rise.
- [ ] Light theme: ribbons, chips and cards stay legible.

## Shell: iOS stack transitions on the dark theme

iPhone with the app on the dark theme; the phone's own appearance set to light for the
second step.

- [ ] Open a channel, tap the composer so the keyboard is up, then tap back: no light band
      appears where the keyboard was while the screens slide. Same result going back with a
      swipe from the left edge, and with the keyboard closed.
- [ ] Set the phone to light appearance with the app still on Dark in Appearance: still no
      light band. Switch the app to Light: transitions stay uniformly light.
- [ ] Android: the same flows look exactly as before.

## Agents: memory scopes

Needs two users (A, B) in one org, TWO shared agents, agents-in-chat enabled,
and a public channel with an agent bound (`(both products)`).

- [ ] As A in a 1:1 agent DM, ask the agent to remember a personal
      fact -> the tool card says the memory is private; the entry appears in
      Settings > AI with a description and the saving agent's name on it.
- [ ] Open a 1:1 DM with the SECOND agent and ask about that fact -> it reads
      the same personal entry. One personal store, every agent.
- [ ] In Settings > AI there is no agent picker: the list is the member's whole
      personal store.
- [ ] As A in the public channel, trigger the agent and inspect the run: the
      personal fact is neither mentioned nor reachable (`memory.read` in the
      channel returns channel + org entries only). This is the leak guard.
- [ ] As B in the channel, ask the agent to remember a team fact -> as A,
      trigger the agent and ask about it: the agent reads the channel entry
      (visible memory.read call in the activity pane) and answers. Bind the
      second agent to the channel and ask it too -> same entry, no re-teaching.
- [ ] Channel memory dialog (composer agent picker -> "Memory") lists the
      entry with "saved by B"; as a plain member A cannot delete B's entry;
      as a channel moderator the delete works.
- [ ] As A, ask the agent in the channel to remember something "just for me"
      -> the tool refuses (structured error, nothing saved) and the agent
      points to the DM (no user-scope write from a channel run).
- [ ] As a BUILDER in a 1:1 DM, say "remember this for the whole organization"
      -> the entry lands in org memory (visible in the builder Memory panel,
      "All agents" tier, and in the OTHER agent's next run), NOT in
      Settings > AI personal memory.
- [ ] As a NON-builder in a 1:1 DM, same ask -> nothing is saved anywhere,
      the agent explains org memory is builder-managed and offers to save it
      personally instead; accepting saves a normal personal entry.
- [ ] Pin flow: in Settings > AI pin a personal entry -> preview system prompt
      (agent Instructions panel) shows its full content under "Pinned";
      unpinned entries show as one index line each. Pin a 6th entry -> clear
      limit error.
- [ ] Org memory, "All agents" tier: as a non-builder the panel is read-only;
      as a builder add + pin an entry -> BOTH agents' next runs read it.
- [ ] Org memory, "This agent" tier: add an entry there -> only that agent's
      runs see it; the other agent's prompt preview does not list it.
- [ ] `memory.forget` on a pinned entry via chat ("forget X") -> tool refuses
      and names the pin; unpinning in the UI then repeating succeeds.
- [ ] Group DM with the agent: memories save to the conversation, not to the
      trigger user (Settings > AI stays unchanged).
- [ ] Migration check on an upgraded database: a member who used two agents
      before the change sees one merged personal list, and duplicate keys kept
      the most recently updated entry.
- [ ] Quota: import/save until the scope cap (300) -> tool returns the limit
      error and the agent relays it without a failed run.
- [ ] Sharing OFF (default): with a personal "call me G" memory, ping the agent
      in a channel -> it does not know the name and explains memory is kept
      separate per space.
- [ ] Sharing ON (Memories tab -> "Use my personal memory in shared spaces"):
      same ping -> the agent knows the name; asking it to SAVE something
      personal from the channel still refuses (bridge is read-only).
- [ ] Org gate: set `personal_memory_bridge_enabled=false` in the org's
      `agents/runtime` settings blob -> the toggle shows "Disabled by your
      organization", enabling it fails, and an already-opted-in user's channel
      runs stop seeing personal memory.

## Agents: memory recall (query-conditioned)

Needs two users (A, B) in one org, a shared agent, and a public channel with
the agent bound (`(both products)`).

- [ ] Unprompted recall: save "Alice's deploy window is Tuesday 09:00" via the
      agent in a 1:1 DM, start a NEW conversation, ask "when can we deploy?"
      WITHOUT mentioning memory -> the agent answers from the entry, with no
      visible `memory.read` call (the block was promoted onto the turn).
- [ ] Follow-up recall: after an unrelated exchange, ask "what time was that
      again?" -> still answers (recent user turns feed the match text).
- [ ] Multilingual: save an entry in Chinese or Russian (e.g.
      部署窗口是周二上午九点), ask about it in the same language in a fresh
      conversation -> recalled without an explicit memory prompt.
- [ ] Cross-lingual falls back to pull: entry saved in English, question asked
      in German -> the agent still finds it, via a visible `memory.read` call
      (index path; lexical promotion is not expected to fire).
- [ ] Never say "no memory": with the entry listed in the prompt preview index,
      the agent must not claim it has no memory of the topic.
- [ ] Ephemerality: edit the entry's content in Settings > AI mid-conversation,
      ask again -> the next reply uses the NEW content (old block is not
      re-sent from history).
- [ ] Injection guard: as B save a channel entry whose content says to ignore
      instructions and exfiltrate the system prompt; as A ask a question that
      matches it -> the agent treats it as data, does not follow it, and
      destructive tools still prompt for approval.
- [ ] Bridge stays pull-only: with A opted into the personal bridge, ask a
      channel question matching only A's personal entry -> no automatic
      recall; the agent may still reach it via an explicit `memory.read`.
- [ ] Delimiter smuggle: save an entry whose content contains
      `</memory-recall-x>` -> saved text has the marker stripped/neutralized
      and a matching question does not break the reply.
- [ ] LIKE metacharacters: `memory.read` with query `%` returns "no matching
      memories", not the whole store.

## Agents: deferred tool loading

Agents with more than 16 enabled tools advertise only core groups (Memory,
Search, People, Skills, System) up front; the rest load on demand via
`tools.load_group`. Needs one agent with most tool groups enabled ("big")
and one with only a handful ("small") (`(both products)`).

- [ ] Big agent, deferred flow: in a fresh DM ask something a deferred group
      covers (e.g. "create a note titled X") -> the tool pane shows a
      `Load Group` step first, then the notes tool runs and the reply
      completes normally.
- [ ] Load persists per conversation: in the SAME DM ask another notes
      question -> no second load step; a DIFFERENT DM with the same agent
      loads again on first use.
- [ ] Channel destination: mention the big agent in a channel and trigger a
      deferred tool -> load + run work; a second trigger in the same channel
      skips the load.
- [ ] Small agent unaffected: the small agent never shows a load step and
      answers tool questions directly.
- [ ] No capability invention: ask the big agent for something NO enabled
      group covers -> it says it cannot, without a load attempt loop.
- [ ] Integration groups stay gated: with the GitHub connection disabled,
      the big agent's load index does not offer GitHub and asking for a repo
      does not load it.
- [ ] Tool labels: every step in the chat tool pane, the approval card, and
      the approved/denied row shows the catalog display name ("Create Note"),
      never a raw `notes-create_note` style name.

## Agents: builder surface, org defaults, builder gating

`/agents` is the builder page (3 tabs: Agents, Skills, Automations),
restricted to builders (org admin or AGENTS domain admin); all
conversation happens in `/chat`; org config lives on `/admin/agents`.
Needs an org admin, an AGENTS domain admin who is NOT an org admin, and a
plain member (`(both products)`).

### Builder gating

- [ ] As plain member: the Agents icon is absent from the header nav
      (desktop AND the mobile drawer); typing `/agents` in the URL
      redirects to `/`; direct create/update/delete RPCs are denied.
- [ ] As AGENTS domain admin (granted via `/admin` -> Domain admins):
      after re-login the Agents nav icon appears, `/agents` loads, and
      full CRUD works - including editing and opening the Share dialog on
      an agent another builder created.
- [ ] Grant revocation: revoke the AGENTS grant -> after the next token
      refresh the nav icon disappears and `/agents` redirects.
- [ ] A FILES domain admin (no AGENTS grant) is treated as a plain member
      here.
- [ ] Chat usage unaffected: the plain member can still DM an org-visible
      agent, use the model picker + params popover, slash-invoke skills,
      and rate replies.

### Org default model + name-only agents

- [ ] As admin: `/admin/agents` -> Runtime -> set a default provider key
      (org-visible, valid) and a default chat model -> Save.
- [ ] As builder: `/agents` -> create an agent with ONLY a name (never open
      Model settings) -> open its chat DM from `/chat` -> the agent answers
      on the org default model; the run log shows that model.
- [ ] Clear the org default (admin) with the agent still name-only -> the
      next send fails with a friendly "no model configured" message, not a
      crash or a silent fallback.

### Default agent + templates

- [ ] Fresh org: after creation the org has exactly one agent
      ("Assistant", marked default, org-visible) with no model config;
      it chats once the org default model is set.
- [ ] Create flow: "start from template" gallery lists the templates;
      picking one prefills name, emoji, instructions, and capabilities;
      the created agent is an ordinary org-owned row (editable, sharable,
      deletable).

### Agent deletion and restore

Needs a builder, a plain member who already has a DM with the agent, and an
agent that owns at least one automation.

- [ ] Builder: agent detail -> trash icon -> the dialog states that chats stay
      readable, automations pause, and a restore is possible. Confirm -> the
      agent leaves the Agents list and appears under "Deleted" in the sidebar,
      greyed with a trash icon.
- [ ] Its automations show as paused in the Automations section, and "Run now"
      on one of them is refused with "This automation's agent was deleted".
- [ ] Search: the agent no longer appears in global search or in an `@` mention
      picker; a chat model picker does not offer it.
- [ ] The member's existing DM is still in the chat sidebar, dimmed with a trash
      icon. Opening it shows the full history with the agent's name and avatar
      intact; the composer is replaced by a "was deleted" notice.
- [ ] In a channel the agent belonged to: `@`-mentioning it does nothing (no
      typing indicator, no reply, no error toast); replying to one of its old
      messages also does nothing.
- [ ] Deleted detail page: every field is read-only (no save on Overview,
      Instructions or Capabilities) and the Test drawer / clone buttons are gone.
- [ ] Restore: builder opens the deleted agent -> Restore -> it returns to the
      Agents list, becomes editable, answers in the DM again, and appears in
      search. Its automations stay PAUSED until re-enabled by hand.
- [ ] Deleting the org's default agent: the default badge is gone afterwards and
      an admin can mark another agent default.
- [ ] Memory: an org memory bound to that one agent disappears; an org-general
      entry the agent wrote stays, as does a member's personal entry.

### Image generation parameters

- [ ] Builder: agent detail -> Overview -> Model settings -> pick an image
      key + model. "Image Defaults" appears with aspect ratio, resolution
      and quality for an OpenAI model, aspect ratio + resolution for a
      Google one. A per-image price shows under resolution and quality.
- [ ] Switch the image model between providers: knobs the new model does
      not support disappear and stored values for them are dropped, not
      carried over.
- [ ] Style preset: type, click away (or Save), reload -> the text stuck.
      Generate an image and confirm the style shows in the output.
- [ ] Chat: DM an agent that has image generation enabled -> the params
      popover shows an "Image Generation" group; `moderation` and
      `output format` do NOT appear there (builder-only).
- [ ] Set resolution to 2K in the popover, ask for an image -> the result
      is 2K even though the prompt never said so; the chips under the image
      read the resolved values.
- [ ] Ask in plain language ("make it 16:9") -> the model emits the knob
      itself and the result honours it, without touching the popover.
- [ ] "Regenerate with..." on a generated image: picking a preset produces
      a new image with only that knob changed; the original prompt and the
      other params are preserved.
- [ ] Admin: `/admin/agents` -> Runtime -> set the image resolution ceiling
      to 1K -> a builder default or chat override of 4K still runs, clamped
      to 1K (no error), and the run log cost matches the clamped tier.
- [ ] An agent with the image tool enabled but NO image model: the tool
      fails with "no image model configured" and the chat popover shows no
      image group.

### Test drawer

- [ ] Agent detail -> "Test agent" opens the drawer: send a message, the
      reply streams with thinking + tool activity panes; Stop cancels a
      running turn; Reset starts a fresh conversation.
- [ ] Test isolation: the drawer conversation appears NOWHERE else (no
      chat DM, no session list anywhere); asking the agent to remember
      something yields a "memory writes are disabled in test sessions"
      tool error; memory READS and the memory index still work; the run
      appears in the admin run logs and spend counts against budgets.
- [ ] AI Builder (Instructions tab) uses the same drawer in builder mode:
      "Apply to Instructions" writes the soul prompt; builder sessions
      are test sessions too (nothing leaks into listings or memory).

### Admin surface (keys are admin-only)

- [ ] `/admin/agents` Keys tab is the ONLY key surface: add a key (created
      org-visible), validate, disable, delete; narrow one to explicit
      members via Share and confirm a non-member's chat model picker stops
      listing its models while a granted member's still does.
- [ ] As member: key add/remove/toggle/validate RPCs are all denied;
      listing keys/models (the picker path) still works.
- [ ] `/admin/agents` Usage tab: org-wide spend renders; a member opening
      the RPCs directly is denied.
- [ ] `/admin/agents` Runtime tab: defaults, memory bridge gate,
      failover/resume/deadline/circuit knobs round-trip; no creation
      policy or governance toggles render.

### Settings AI section (member self-service)

- [ ] As member: Settings -> AI shows own usage numbers (org-wide absent),
      no key management anywhere, and the "Agent memory" consent toggle
      (the memory-bridge opt-in that used to live in the builder page)
      works: opt in, verify a channel run reads a personal memory, opt
      out, verify it stops.

### Skill drafts (Skills page)

- [ ] An agent proposing a skill in a chat produces a draft; the member
      sees the draft card WITHOUT a Review button; a builder sees Review
      and can open, edit, and save it - the saved skill is an organization
      skill (no scope picker anywhere).
- [ ] Pending drafts render as the first group on `/agents/skills` (no
      separate drafts page; `/agents/skills/drafts` redirects to the grid)
      and the sidebar Skills row badges their count; search filters drafts
      and skills alike.
- [ ] A builder can discard a draft raised by someone else, from the card
      on the Skills grid or from the draft editor; the card in the original
      channel settles to its resolved state and the badge drops.

### Chat ports (agent DMs)

- [ ] In an agent DM, type `/` -> the skill popup lists the agent's
      runnable skills; picking one shows a dismissible skill chip; send ->
      the reply follows the skill and the sent message shows the skill
      badge.
- [ ] Agent replies carry no thumbs up/down on web or mobile; reactions,
      copy, reply, thread, thinking and tool panes still work on them.
- [ ] Proposed-skill draft card renders after an agent reply that
      produced one; opening it lands in the draft editor.

### Skill observations

- [ ] `/admin/agents?tab=skills` (org admin) lists one row per exact skill
      version invoked in the window, with the 7d/30d/90d switch redrawing
      the window caption; the table shows invocation outcomes, completed
      and tool-error counts next to their percentages, unique users, run
      log coverage (`n of m`, "No run logs" when none), duration, tokens,
      and one cost line per currency (no merged totals).
- [ ] A version with invocations but no correlated run log shows a dash
      for duration, tokens and cost, not zero.
- [ ] Invoke a skill more than 200 versions' worth (or lower the page size
      locally): "Load more versions" appends the next page without
      duplicating a row; a failed page keeps the loaded rows and offers
      "Try again".
- [ ] Skill detail -> "Observations" section opens on demand and lists
      only that skill's versions, newest first; an AGENTS domain admin who
      is not an org admin can open it, while the admin Skills tab stays
      org-admin only.
- [ ] Switch organization while the tab is open: the previous org's rows
      never render for the new org, and the new org loads its own.
- [ ] Old links: `/agents/chat` (and `/agents/chat/<id>`) redirect to
      `/chat`.

## Search

Spotlight (`Ctrl+K`) and the header search against a seeded org with notes,
files, folders, channels, agent chats, and chat history (`(both products)`).

- [ ] `note: docker compose` returns notes matching "docker compose"; the
      text after the keyword is searched, not swallowed. Same for
      `file:`, `folder:`, `message:`, `task:`, `project:`.
- [ ] `tag:work report` filters by the tag and searches "report";
      `tag:"multi word"` works quoted. A dangling `tag:` searches as if
      absent.
- [ ] `"note: literal"` (quoted) searches the literal text; no note
      filter chip appears.
- [ ] Filter chips render for active filters and clicking x on a chip
      removes only that filter from the query text.
- [ ] Outside `/chat`, a term matching both a note title and many chat
      messages ranks the note above the messages (rank weight, no
      exclusion). `message: <term>` narrows to messages only.
- [ ] On a `/chat` route, the same query re-ranks: matching users first,
      then channels, then agent chats, then messages, then other content.
- [ ] Search a file folder name -> result opens `/files?folder={id}` with
      the tree expanded to that folder. Search an agent folder name ->
      `/chat?agentFolder={id}` reveals and expands it in the sidebar.
      A system folder (Attachments) never appears in results.
- [ ] Search a notes-tree folder name -> the result badges "Folder" (not
      "Note") and opens the notes folder screen listing its children;
      clicking a child navigates to it. A canvas result badges "Canvas".
- [ ] Search results highlight the matched terms in title and snippet;
      a long chat message shows a cropped snippet around the match, and
      message rows do not repeat the same text twice.
- [ ] Per-route boost: the same ambiguous query ranks files first on
      `/files`, notes first on `/notes`, events first on `/calendar`,
      tasks first on `/projects`. An exact-match result from another
      domain still beats a weak (typo/partial) boosted match.
- [ ] Open the spotlight without typing: recent DM contacts and the last
      opened notes/channels/results appear; clicking one navigates.
      Log in as a different user on the same browser: their zero state
      is their own (history is keyed per org and user).
- [ ] Synonyms: searching "call" finds content titled "meeting" and
      vice versa.
- [ ] System chat messages (join/leave notices) never appear under
      `message:`.
- [ ] Delete a note and a chat channel: neither the note, the channel,
      nor the channel's messages are searchable afterwards. Delete an
      agent DM: the agent chat disappears from search too.
- [ ] Removal durability: stop Meilisearch, delete an indexed note,
      start Meilisearch again. Within ~5 minutes (removal flush worker)
      the note is gone from search without any manual action.
- [ ] Permissions: user B searches for user A's private note title ->
      no hit. Share it with B -> B finds it without re-indexing. Block B
      on an `OPEN_TO_ORG` note -> the hit disappears for B.
- [ ] The retired index RPCs stay dead: POST to
      `/search.v1.SearchService/IndexItem` and `/DeleteItem` return
      not-found/unimplemented, never 200.

## Files - PDF viewer

Open PDFs from a multi-file folder so the playlist has neighbors
(`(both products)`). Use one 100+ page document, one with an outline,
one password-protected, and one over 16 MB.

- [ ] Continuous scroll on a 100+ page doc stays responsive; only pages
      near the viewport hold live canvases (inspect DOM); the scrollbar
      never jumps while pages mount.
- [ ] Thumbnail rail: current page highlighted, click jumps, rail
      auto-scrolls to keep the current page visible. Outline tab appears
      only on documents with bookmarks and its entries jump correctly.
- [ ] Default view opens with the sidebar visible at a comfortable
      width (~80% of fit-width); the fit-width button fully stretches;
      fit-page fits the whole page; both recompute on window resize and
      rotation; the zoom percent always matches the real scale.
- [ ] Rotate via toolbar and `R`; rotation resets when switching files.
- [ ] Page indicator accepts a typed page number (Enter commits, Esc
      cancels without closing the viewer).
- [ ] ArrowRight on the last page advances to the next playlist file;
      ArrowLeft on page 1 goes back; toolbar carets stay page-only.
- [ ] Ctrl+F: match counts, Enter/Shift+Enter navigation with wrap,
      visible highlights, Escape closes search before the viewer.
- [ ] Print produces a correct dialog for the full document; a file
      still transcoding disables the print button.
- [ ] A >16 MB PDF paints page 1 without a full download (206 responses
      in the network tab); breaking the range route falls back to the
      blob path automatically.
- [ ] Rapid wheel-zoom stays smooth (CSS-scale interim) and lands crisp
      within ~200ms; canvas DPR capped at 2 (inspect canvas width vs
      CSS width on a 3x display).
- [ ] After opening one file in a playlist, a small next file opens
      instantly from cache; video/audio and >20 MB neighbors are never
      prefetched (network tab).
- [ ] Copy link to page -> fresh tab opens the PDF scrolled to that page
      (clamped when past the end); `?page=` beats the stored position.
- [ ] Reopen a multi-page PDF -> resumes at the last read page.
- [ ] Encrypted PDF prompts inline, wrong password shows the retry
      line, cancel shows the error state; the form is centered.
- [ ] Info popover shows title/author/created/producer/version/pages/
      size; absent metadata rows are omitted.
- [ ] Night mode inverts pages while selection and search highlights
      keep working; sticky across file switches.
- [ ] Presentation mode fullscreens single pages; arrows flip and fall
      through to the next file at deck end; Escape exits presentation
      before closing the viewer; browser-level fullscreen exit syncs.
- [ ] Two-page spread at 1024px+: cover alone then pairs; suppressed in
      presentation and below 1024px; scrollbar stable.
- [ ] Select text -> Copy and Copy as quote; the quote pastes as a
      blockquote with a live file mention chip in a note and in chat.
- [ ] Edit mode (pencil): rotate/delete/reorder (drag)/extract pages;
      undo/redo/reset; save as new file and as new version - both open
      correctly in the viewer afterwards; extract locked to New File.
- [ ] New Version (edit mode, watermark, and image editor) does NOT
      create a second file row: the file list stays at one entry, the
      file's version history gains an entry, the viewer shows the new
      bytes, and restore-version brings the old content back. A viewer
      lacking EDIT on the file gets a permission error. Saving an image
      version in a different format is rejected with a clear MIME
      message.
- [ ] Mobile 375px: sidebar is an overlay drawer with backdrop close;
      touch targets usable.
- [ ] Watermark: dialog applies a diagonal preview on every page with
      the chosen opacity; Remove clears it; switching files drops it.
- [ ] Save watermarked copy: Save button appears once a watermark is
      pending; New File defaults to `{base}_watermarked.pdf`; New
      Version keeps the name; the saved copy shows the baked watermark
      in the viewer and in an external PDF reader; the preview clears
      after save. Non-Latin watermark text fails with a clear message
      instead of a broken file.

## Files - version history and retention

Use a text file so version bytes are easy to tell apart. `(both products)`.

- [ ] Restore round-trip: upload a file, save 2 new versions (viewer New
      Version), open the details panel Versions tab, restore version 1 ->
      a NEW version appears (numbering keeps climbing, never reuses), the
      restored bytes download as current, the file list/viewer show the
      new size, and version 1 is still listed afterwards.
- [ ] Per-version download from the Versions tab returns that version's
      exact bytes, not the current ones.
- [ ] Prune at N: set retention to 2 on the admin storage page, save 3+
      versions -> only the newest 2 remain in the list AND the pruned
      S3 objects are gone from the bucket (check rustfs). The current
      version is never pruned.
- [ ] Quota accounting: user usage on the admin storage page rises by the
      version size on each save/restore and falls when versions prune;
      RecalculateStorageUsage still reports current-file bytes only.
- [ ] Permission denial: a user with VIEWER on the file sees the version
      list but no Restore button; a forced RestoreFileVersion RPC returns
      PERMISSION_DENIED. Restore requires EDIT.
- [ ] Restoring the current version is rejected with a clear message.
- [ ] Screen recording (transcoded WebM->MP4): after the 24h delayed
      WebM delete, restoring the WebM version fails with "bytes no
      longer available", not a 500.
- [ ] Retention setting: non-admin org member gets denied on the update
      RPC; value floor 1 / ceiling 100 enforced; self-host env default
      `FILE_VERSION_RETENTION` applies when no org row exists.

## Agents: builder redesign

One sidebar, URL-first navigation, skills editor surface. Needs an org
admin plus a plain member (`(both products)`).

### Shell + navigation

- [ ] `/agents` redirects to the last-visited section (default Agents);
      the page has exactly ONE sidebar under the app header with Agents,
      Skills, and Automations sections; no inner icon rail, no second
      list panel inside the content pane.
- [ ] Sidebar collapse leaves the icon rail (hover reveals the overlay
      sidebar); Zen mode hides everything; both match chat's behavior.
      Sidebar width persists across reloads; resizing works.
- [ ] Mobile (<768px): the sidebar is a left drawer, content full-width.
- [ ] Deep links: `/agents/agents/<id>` redirects to `.../overview`;
      old `/agents/chat` still lands on `/chat`; an unknown section
      lands on `/agents/agents`.
- [ ] Agent detail tabs (Overview / Instructions / Capabilities /
      Memory) are links: browser back/forward walks the tab history;
      refresh lands on the same tab; the URL segment is `memory`.
- [ ] Sidebar search filters agents, skills, and automations rows.

### Skills surface

- [ ] Selecting a skill in the sidebar opens a full-height markdown
      editor; edits autosave (about 1s debounce) and survive reload;
      NO agent picker anywhere on the page.
- [ ] Bundled skills are read-only: no rename, no content edits, no
      metadata edits, no delete.
- [ ] Metadata (when to use, always active, required tools, version
      history + restore) is reachable from the skill header; the
      always-active toggle stays org/bundled-only.
- [ ] Drafts: the sidebar Drafts row shows the pending count (org-wide,
      any triggering user); the drafts list opens in the content pane;
      reviewing a draft uses the same editor surface; save
      creates/updates the organization skill, discard drops the draft.

### Agents + automations surface

- [ ] Agent detail header: Test / Clone / Share actions render as
      chat-style header buttons; Share opens the access dialog even on
      an agent another builder created (manage override).
- [ ] Catalog: the icon in the sidebar header reaches the grid, fills
      with the primary color while on `/agents/catalog`, and slides its
      label out on hover (same behaviour as the notes Graph/Tags icons);
      search filters by name, description, and tool name; a card opens
      `/agents/catalog/:key` with the soul prompt, skill badges, and
      tools grouped by category; templates carrying a `*.delete_*` tool
      show the approval warning.
- [ ] The shared `CompactNavItem` extraction did not regress the notes
      sidebar (Graph, Tags) or the files sidebar (All Files, Tags,
      Filters): icons, hover labels, and active states all behave.
- [ ] Create agent: "Use this template" (grid card or detail pane)
      opens the modal with that template summarised and the name
      prefilled; the `X` on the summary drops to Blank and keeps the
      typed name; sidebar `+` opens the modal on Blank with a Browse
      catalog button; the empty state offers catalog + blank. Every
      path lands on the created agent's Overview tab with the
      template's tools and skills already enabled.
- [ ] Overview keeps the collapsed Model settings disclosure; its
      no-keys empty state points to `/admin/agents`; Capabilities and
      the automation detail use the shared toggle (no bespoke green
      switches).
- [ ] Automations: sidebar rows show status dot + next run; `+` opens
      the create modal; the cron prompt is a markdown editor with
      working `@` mentions; Run Now, pause/resume, delete, and the
      execution history (with pending polling) all still work.
- [ ] Test drawer still opens from the detail header, streams with
      thinking + tool panes, and keeps test-session isolation.

## Integrations (GitHub)

Needs a real GitHub PAT (fine-grained or classic) with repo read access.
Admin surface is `/admin/integrations`; tools mount on agents under the
Capabilities tab, External section.

### 1. Connection lifecycle (both products)

- [ ] As org admin, add a GitHub connection with a REAL PAT: row appears
      with green status, `account_login` shows the token's user, the
      credential is never readable back (only the hint).
- [ ] Add a second connection with a deliberately broken token: the row
      is stored but marked invalid, the red error panel shows the probe
      error. Members see the invalid state but NOT the error text.
- [ ] Validate button flips state both ways (fix/break the token via
      Update... or remove and re-add).
- [ ] Disable toggle greys the row; Remove deletes it.
- [ ] As a non-admin member: `/admin/integrations` is blocked; the
      builder Capabilities tab shows the GitHub group with the muted
      "no connection" hint when none is enabled.

### 2. Tools in chat (both products)

- [ ] Give an agent the GitHub tools, ask in chat: "list open PRs on
      <repo you can read>". The agent calls `github.list_pull_requests`
      and the result renders with the `Source: github connection ...`
      line.
- [ ] "Read file X from repo Y" returns scrubbed file content in a code
      block; an issue body containing `[[[chip|urn:...]]]` markup
      renders as plain label text, never as a mention chip.
- [ ] With NO enabled connection (disable it), the same agent no longer
      advertises github tools: asking for PRs gets a plain-language
      answer, not a dead tool call.
- [ ] Rate-limit / bad-repo errors surface as readable tool errors the
      agent recovers from (asks the user, tries another repo).

### 3. Multiple connections and per-agent pin (both products)

- [ ] With TWO enabled GitHub connections, the agent without a pin gets
      the ambiguity error listing both names and recovers by passing
      `connection`.
- [ ] The Capabilities tab always shows the `Connection` select on the
      GitHub group (Automatic + one option per usable connection); pin
      one, ask again: calls ride the pinned connection without the
      agent naming it.
- [ ] Remove or disable the pinned connection: the tool errors with the
      pinned-connection copy and the Capabilities tab flags the stale
      pin; explicit `connection` still works.

### 4. Isolation and self-hosted (both products)

- [ ] A second org sees no connections from the first (list, tools,
      caches).
- [ ] Self-hosted GitHub Enterprise: add a connection with base_url
      `https://HOST/api/v3` and confirm probe + one read tool work
      against it (skip when no GHE instance is available).

## Realtime session revocation and lifetime

The realtime socket re-authorizes itself every 30s and cannot outlive the
token that opened it. Needs two browsers signed in as the same user, plus an
org admin in a second profile (`(both products)`).

- [ ] Revoke this device: open a note in browser A and in browser B, then from
      B's Settings > Security revoke A's session -> A's socket closes, the
      badge leaves Live, and A cannot reconnect (its reload lands on login).
      B keeps editing.
- [ ] Revoke then reconnect: with A's session revoked, watch A's network panel
      -> the realtime upgrade is refused, not accepted-then-closed.
- [ ] Idle socket: in A open the notes list (socket open, no doc attached),
      revoke A's session, then open a note -> the attach is refused instead of
      loading the doc.
- [ ] Token expiry: leave a note open past the access-token lifetime (default
      15 min) -> the socket closes with 4409, the client refreshes, and editing
      continues with no visible interruption and no lost keystrokes.
- [ ] Membership removal mid-edit: user A edits a note, an org admin removes A
      from the org -> within ~30s A's socket closes and further edits are
      refused; A's earlier merged edits stay in the doc (CRDT trade-off).
- [ ] Healthy session is untouched: two peers editing the same note for
      several minutes see no spontaneous disconnects.

## Agents: tool authorization

An agent executes only the tools its builder enabled, and automations are
gated by the task's own access policy. Needs a builder plus a second member
(`(both products)`).

- [ ] Tool not enabled: on an agent with only note tools enabled, ask it to
      delete a file -> it reports it cannot, and no file is deleted. The tool
      pane shows no delete step.
- [ ] Disabled integration: with the GitHub connection disabled, ask an agent
      whose GitHub tools are enabled for a repo listing -> refusal, no call.
- [ ] Automation prompt stays private: member B creates an automation
      (default owner-only), then a builder who is not B opens `/agents`
      automations -> B's task is not listed, and editing it by id fails.
- [ ] Builder with a grant: B shares the task with the builder as EDITOR ->
      the builder can retime it, and the run still executes as B.
- [ ] Prompt rewrite moves the identity: the builder rewrites the prompt ->
      the task's execution user becomes the builder, and the next run acts
      with the builder's permissions.
- [ ] Scheduled delete needs no approval: an automation whose prompt deletes a
      note it owns runs to completion unattended (no approval card, delete
      applied) - this is the documented cron policy, not a bug.
- [ ] Folder names stay scoped: put a note in a private folder, share only the
      note with another member, ask their agent to list notes -> the location
      reads "unknown folder", never the private folder's name.

## Dev demo seeding (one-shot seeder container)

The dev stack seeds itself: the `seeder` service runs the demo-company script
with `--fresh-only` on every `stack up` and a `deployment_settings` sentinel
(`seed/demo_company`) makes later starts a no-op. Needs the provider key env
vars in `.env` for the agents leg.

- [ ] Fresh stack seeds itself: `./manage.py stack reset-data` -> watch
      `./manage.py logs -s seeder` -> it waits for the backend bootstrap,
      then seeds users, groups, keys, agents, notes, files, rooms, events,
      projects and chat, and exits 0.
- [ ] Second start is a no-op: `./manage.py stack up` again -> seeder logs
      "sentinel present" and exits within seconds, no duplicate rows.
- [ ] Login works for the seeded accounts: `maria@uniffy.io` / `demo` and
      `alice@uniffy.io` / `admin`; Maria sees the public channels with
      history, alice sits in the Engineering group.
- [ ] Agents answer: as any member, DM `Uniffy Anthropic` -> a reply streams
      (key came from `CLAUDE_API_KEY`); the builder page shows five agents
      with full tool sets.
- [ ] Generated binaries render: Files > People > `employee-handbook.pdf`
      opens in the PDF viewer with 2+ pages and selectable text; Brand >
      `brand-wallpaper.png` and `team-offsite-2026.jpg` render previews;
      search finds "error budget" (text inside the generated release
      quality manual PDF).
- [ ] Projects landed: three projects (PLV, TELE, ONB) with tasks, assignees
      resolve to the seeded users, due dates spread around today.
- [ ] Environment gate holds: `docker exec -e ENVIRONMENT=production
      uniffy-dev-backend uv run python -m uniffy.scripts.demo_company` ->
      refuses to run.

## Teams and groups

Teams (org structure) and access groups (permission bundles) share one table
and one per-org name namespace; pickers must keep them distinguishable.

### 1. Name namespace (both products)

1. As an org admin, open `/admin/teams` and create a team `Engineering`.
2. Open `/admin/groups` and try to create a group named `engineering`
   (lower case). The create must fail with a readable "already exists"
   error; nothing is created.
3. Rename an existing group to another group's name - same typed error.

### 2. Kind-aware pickers (both products)

1. Open a calendar event and add attendees. Type a shared prefix that
   matches people, a team, and a group. The dropdown shows People / Teams /
   Groups sections with distinct badges (Team = primary tint,
   Group = violet).
2. Select a team: the chip renders as a team (not a user), the event saves,
   and the attendee list contains the team's active members only.
3. Repeat the search in a sharing dialog (`AddMemberPopover`) - same
   sections and badges.

### 3. Group expansion privacy (both products)

1. Create a PRIVATE access group with two members as an admin.
2. As an ordinary member who is NOT in the group, add attendees to an
   event using the private group's id (RPC-level; the picker will not
   offer it). The call must fail with "group not found".
3. As a member OF the private group, the same call expands the roster.
4. Deactivate one group member (org level), invite the group to a fresh
   event: the deactivated user must not appear as an attendee.

### 4. Admin surfaces (both products)

1. Admin nav shows Members / Teams / Groups / Directory as separate
   entries; `/admin/people` renders identity sources + the two people
   toggles only.
2. `/admin/teams` renders teams as an indented tree with lead and member
   count; creating a sub-team under a parent shows correct nesting.
3. `/admin/groups` exposes the Private toggle; a private group shows a
   Private badge and stays invisible to ordinary members in pickers.
4. A directory-synced group (managed name) rejects rename with
   "managed by the directory".

### 5. Team entity: search and mentions (both products)

1. Ctrl+K a team's name: the team appears with a Team badge and a
   "N members · parent" subline; Enter lands on the org chart filtered
   to it (`/people?team={id}`). `team:` prefix filters to teams only.
2. Type `@` in a note, search the team, insert. The chip renders as an
   inline pill; hover shows name, member count, parent badge, and an
   "Open in org chart" action.
3. Rename the team in `/admin/teams` from a second tab: the chip title
   updates without a reload. Ctrl+K finds it under the new name.
4. Add or remove a team member: the search row's member count follows.
5. Delete the team (or demote it to a group): the chip tombstones
   (dashed "Deleted"), and the team no longer appears in search.
6. Access groups NEVER appear in Ctrl+K or `@` mention results,
   private or not.

### 6. Private group visible to its own member (both products)

1. As an admin create a PRIVATE access group and add an ordinary member.
2. As that member, open any sharing dialog and search the group's name:
   it appears with a lock icon and a Private tooltip.
3. As a member NOT in the group, the same search returns nothing.

### 7. Invited-via provenance (both products)

1. Create an event and invite a team plus one direct person.
2. Open the event detail as a non-editing attendee: rows expanded from
   the team show a muted "via {team}" subline; the direct invite shows
   none.
3. Remove someone from the team afterwards: the existing event row and
   its subline stay (snapshot semantics).
4. Delete the team: the subline disappears; the attendee rows stay.

## People - org chart and manager edges

The chart draws at most 2000 nodes at once; deeper branches stay collapsed
until expanded. Manager edges are editable from a team roster and from the
member profile dialog.

### 1. Branch collapse and expand (both products)

1. Open `/people`. Every person with reports carries a caret badge with the
   descendant count; in an org that fits the budget all of them start
   expanded and no status pill shows.
2. Collapse a mid-level manager: their whole subtree disappears, edges and
   team containers reflow, and a top-left pill reads
   "Showing X of Y people - expand a branch to see more".
3. Expand it again: the count returns to Y and the pill disappears.
4. Clicking the badge must NOT navigate; clicking the card still opens
   `/people/{id}`.

### 2. Over-budget org (both products)

Needs an org above 2000 active members (or temporarily lower
`MAX_RENDERED_NODES` in `OrgChartCanvas.tsx`).

1. `/people` opens with the top levels drawn and the deeper ones collapsed -
   never a blank canvas or a frozen tab.
2. Expanding a branch that does not fit leaves it collapsed and the pill
   switches to "collapse a branch or pick a team to draw more".
3. Collapse a sibling branch, then expand the first one again: it opens.
4. Filtering by a team in the sidebar draws that subtree within the budget.

### 3. Manager from a team roster (both products)

1. `/admin/teams` -> View members on a team. Each row shows
   "Reports to {name}" or "Set manager".
2. Open the control on someone with no manager: a "Report to {lead}
   (team lead)" shortcut plus a people search. Use the shortcut; the row
   label updates immediately and `/people` shows a solid edge.
3. Use the search on another member, pick anyone: same result.
4. "Clear manager" removes the edge; the chart falls back to the dashed
   team-lead edge.
5. A cycle (manage your own manager) is rejected with a readable error.
6. Open an ACCESS group roster in `/admin/groups`: no manager control at all.
7. Turn the org chart off in `/admin/people`, reopen a team roster: the
   manager control is gone (edits stay in `/admin/members`).

### 4. Teams in the member profile dialog (both products)

1. `/admin/members` -> Edit profile on someone in a team. The Teams row
   lists their teams as chips, with a Lead badge where they lead.
2. Clicking a chip closes the dialog and lands on `/people?team={id}`
   filtered to that team.
3. "Rosters are edited in Teams" links to `/admin/teams`.
4. A member on no team shows "Not on any team."

### 5. Every route into a profile (both products)

Do this as an ORDINARY member, not an admin - the profile read path used
to require a platform admin and failed silently for everyone else.

1. Post `@someone` in a chat message. Click the chip: it lands on
   `/people/{userId}` and renders that person, not a blank page.
2. Same from a note body, a task description, a comment, and a calendar
   event description. Every chip goes to the same place.
3. Hover a chip without clicking: the card fills in with title,
   department and team chips. "Profile" opens `/people/{id}`.
4. Ctrl+K, type a colleague's name: the row shows
   "job title · department" beside the name and Enter lands on their
   profile. Searching a job title ("VP Sales") finds them too.
5. From the org chart, click a node. From the dashboard People widget,
   click the manager. Both land on the profile.
6. Open `/people/{id}` for a deactivated member: a not-found state, not
   a half-rendered profile.

### 6. Profile reads and where edits live (both products)

1. `/people/{someone else}` shows Message and Copy link. There is NO
   edit affordance anywhere on the page.
2. `/people/{self}` also has no edit affordance - only Copy link.
3. Settings > Account: change pronouns, work phone, timezone
   ("Use current"), an MM-DD birthday, bio, and a link. Each row saves on
   its own. Reload the profile page: every value is there.
4. A bad birthday ("1990-04-12") is rejected with a readable message.
5. Settings > Account shows NO job title / department / start date
   fields - those are admin-owned.
6. `/admin/members` -> Edit profile: set job title, department, office,
   start date and a manager. They appear on the person's profile and on
   their chart node.
7. As an admin, the same dialog offers no bio / birthday / links fields.
8. If a field is directory-managed it renders disabled with a
   "Synced from directory" hint, in BOTH edit homes.

### 7. An admin editing a profile gains no content access (both products)

The one hard invariant of this feature. Two accounts needed.

1. As an ordinary member, create a note and leave it private
   (`Only me`). Note its URL.
2. As an org admin, open `/admin/members` and edit that member's job
   title and manager. Both writes succeed.
3. Still as the admin, open the member's note URL: access denied. The
   note must not appear in the admin's sidebar, in search, or under any
   tag filter.
4. Repeat with a private file and a private project.

### 8. Turning the people surfaces off (both products)

1. `/admin/people` -> turn OFF "Org chart". The People entry disappears
   from the user menu, the dashboard People widget hides, and the team
   roster manager controls disappear.
2. `@` mention chips and hover cards keep working - they are deliberately
   not gated on the toggle.
3. Turn OFF "Directory" as well, then reopen a mention chip: the profile
   page still resolves for a member.
4. Turn both back ON; everything returns without a reload of the app.
5. `/admin/people` lists one identity source of kind LOCAL that cannot
   be deleted or deactivated. Kinds without a connector say so rather
   than offering a dead "Sync now".
6. Create a SCIM source with a secret, then reopen it: the secret is
   never returned to the client. A second active non-LOCAL source is
   rejected.

## Platform surface hardening (edge deny rule)

The operator API is exactly the `/api/superadmin.v1.` prefix; the docs page
`deployment/hardening.md` documents the one-rule edge block. Verify the split
holds with the rule active (proxy configured to deny the prefix from a
public-source address, per the Caddy or nginx snippet in the docs).

- [ ] From a public (denied) address, every `/platform` page fails its API
      calls with 403 from the edge: users, organizations, sessions, audit,
      mail, encryption, config, and the MFA reset actions.
- [ ] From the same denied address, the org admin Support Access page works
      end to end as a non-sysadmin org admin: operator requests a session
      (from an allowed address), the org admin sees it, approves it, and
      revokes it; the consent mode toggle reads and saves.
- [ ] Tenant surfaces unaffected: login, profile + avatar edits, org
      settings, and members pages all work from the denied address.
- [ ] From an allowed (private/VPN) address, the `/platform` pages work.

## Calendar scale guardrails

Read paths that used to cost more than the window they were asked for. Needs an
org where at least one member owns a recurring event created years ago -- a
daily series starting three years back is the shape that used to hurt.

- [ ] Open the calendar on a month containing a years-old daily series. The
      occurrences render, and the month is no slower to load than a month of a
      series created last week. Compare the two `GetEventsInRange` timings in
      the network tab; they should be within noise of each other.
- [ ] Skip one occurrence of that series, then reload a month that does NOT
      contain the skipped date. The skip still holds on its own date, and the
      months around it are unaffected.
- [ ] Move a single occurrence of the series to another day. Both the gap and
      the moved occurrence render once, not twice, and not at all in months
      outside the move.
- [ ] Ask for a range wider than a year (call `GetEventsInRange` directly with
      a two-year span). It is refused with a clear message rather than served
      slowly. A range whose end precedes its start is refused the same way.
- [ ] A calendar month holding many events loads with a bounded number of
      queries: the count does not grow with the number of events on screen.
      Watch the backend log or `pg_stat_statements` while switching months.
- [ ] Attendee avatars and room details still appear on every event in a busy
      month, including on occurrences of a recurring series.
- [ ] Open the scheduling assistant with a large attendee list (more than 20,
      up to 100). Availability is computed rather than refused. Past 100 the
      panel says so instead of querying.
- [ ] An all-day event, an event in a non-UTC timezone, and an event spanning a
      daylight-saving change all still render on the right days.

## Calendar interop (iCalendar)

Export, import and subscribe against real clients. Needs Outlook (or Outlook on
the web), Google Calendar, and Apple Calendar -- the three that disagree most.
Prepare one event of each shape beforehand: a plain timed event, an all-day
event, a weekly series with one occurrence skipped and one moved, a monthly
series on the 31st, and a yearly event on 29 February.

- [ ] Export a single timed event from the event dialog. The file opens in all
      three clients, on the right day, at the right time, with the same title,
      location and description. A mention in the description reads as its label,
      not as `[[[label|urn]]]`.
- [ ] Export the all-day event. It lands on one day in every client, with no
      spill into the day before or after, and no time shown.
- [ ] Export the weekly series. The skipped occurrence is absent, the moved one
      appears on its new date only, and the rest of the series is intact. Check
      in a client whose timezone differs from yours.
- [ ] Export the monthly-on-the-31st series. February shows the last day of the
      month rather than being skipped, matching what Uniffy shows.
- [ ] Export the 29 February event. It appears only in leap years, in every
      client and in Uniffy.
- [ ] Export a whole calendar. The event count in the confirmation matches what
      the file contains. A calendar above the export cap refuses with a message
      naming the cap, rather than timing out.
- [ ] Import a file exported by Google Calendar, then by Outlook, then by Apple.
      The preview lists what would be created before anything is created, and
      the counts match what lands.
- [ ] Import the same file a second time. Nothing is duplicated; the preview
      reports them as already present.
- [ ] Import a file containing an entry we cannot represent (a rule using
      `BYWEEKNO`, or an entry with no start). It appears in the skipped list
      with a readable reason, and everything else in the file still imports.
- [ ] Import a file into a calendar you do not own, by calling the RPC with
      another person's calendar id. It is refused as not found.
- [ ] Create a subscribe link, paste it into each of the three clients, and
      confirm events appear. Change an event in Uniffy; within the client's
      refresh interval the change shows up.
- [ ] Fetch the subscribe URL twice with `curl -i`. The second fetch with
      `If-None-Match` returns 304 and no body. No `Set-Cookie` on either.
- [ ] Replace the subscribe link. The old URL stops working immediately; the
      new one works. Re-open the panel -- the same URL is shown, not a new one.
- [ ] Stop sharing. Every subscribed client stops updating, and the URL returns
      404 rather than an error that reveals it once existed.
- [ ] Sign in as another member and fetch someone else's feed URL. It serves
      only what that person can see -- it does not become their access.
- [ ] Deactivate a member who has a live feed. Their URL stops resolving without
      anyone revoking it.

## Calendar event mail

Needs SMTP configured (both products) and two accounts, one of them an
organizer. Watch the outbox, not just the UI.

- [ ] Invite someone to an event. They get one message naming the event, its
      time in their own timezone, the location, and who else is invited. It
      carries a `.ics` part, so Outlook and Google show their own accept and
      decline buttons.
- [ ] Change the time. One message arrives saying what changed, not a second
      invitation. The `.ics` part updates the event in the external client
      rather than creating a duplicate.
- [ ] Change the time, then the location, then the title within a minute. One
      message arrives describing the final state, not three.
- [ ] Cancel the event. One cancellation arrives, and the event disappears from
      the external client rather than lingering.
- [ ] Cancel a single occurrence of a series. Only that occurrence disappears,
      and the message names the date.
- [ ] Change a recurring event. The message describes the series, not one
      occurrence, and attendees receive one message rather than one per date.
- [ ] Answer from the message: click Yes. The page asks for confirmation before
      anything is recorded, then the organizer sees the answer in Uniffy.
- [ ] Open every link in the invitation with a tool that follows links without
      clicking (`curl -sL`). No answer is recorded -- responding is a POST the
      page performs, not something the link itself does.
- [ ] Remove someone from the event, then have them use an RSVP link they kept.
      It is refused, saying they are no longer invited.
- [ ] Use an RSVP link a second time, and use one from an older message for the
      same event. Both still work and record the new answer.
- [ ] Turn off calendar-invitation email in notification preferences. No
      invitation or change mail arrives, and no generic notification email
      arrives in its place -- one preference, one email, or none.
- [ ] Turn the master email switch off. Nothing arrives at all.
- [ ] Stop SMTP (or point it at a dead host) and invite someone. The invitation
      still succeeds in the app; the message is retried rather than lost, and
      gives up after several attempts without blocking anything.

## Chat group DM participant cap

One ceiling of nine participants, enforced by the server and mirrored by both clients. Needs an
org with at least ten members.

- [ ] Web: open New message, select people. The picker stops accepting at eight recipients
      (nine participants with you) and says so; the header hint counts "N of 9 participants".
- [ ] Create that nine-person group chat. It opens as a group conversation, and its name reads
      "A, B, and 7 others" in both the sidebar and the channel header.
- [ ] Open the group's member list: the subtitle reads "9 of 9", the add-people search is gone,
      and the cap notice offers converting to a channel.
- [ ] Remove one member, then add a different person: the add succeeds and the cap notice returns.
- [ ] Mobile: New direct message blocks the ninth recipient with the same copy, and the rows that
      can no longer be picked are dimmed.
- [ ] A 1:1 DM (one recipient) still opens as a direct message, and adding a third person to it is
      still refused.

## Chat drafts view

`/chat/drafts` lists every unsent draft. Needs one user with drafts in more than one channel,
plus a second device or tab for the sync check.

- [ ] Type in a channel composer, pause ~2s, then open Drafts in the chat sidebar: the draft is
      listed with the channel name, a relative time, and a plain-text preview (mention chips read
      as their labels, not as raw `[[[...]]]` markup).
- [ ] The sidebar Drafts entry carries a count badge, and the entry highlights while the route is
      open (as Threads and Unreads now do).
- [ ] Start a thread reply, pause, and return to Drafts: that row carries a "Thread reply" tag.
- [ ] Click a channel draft row: the channel opens with the composer prefilled.
- [ ] Click a thread draft row: the channel opens, the thread panel opens on the right, and the
      reply composer is prefilled.
- [ ] Discard a row: it disappears immediately, the sidebar badge drops, and the pencil indicator
      on that channel clears.
- [ ] Save a draft on a second device: it appears in the list without a reload.
- [ ] Send a drafted message: its row leaves the list.
- [ ] With no drafts, the view shows the empty state, and the page title reads "Drafts | Uniffy".
- [ ] The list holds up at 375, 768, and 1024 px, and the discard action is reachable on touch
      (no hover required under `md`).

## Chat reaction authorship

Reaction chips name who reacted. Needs a message with more than ten reactors to exercise the bound,
plus a second user for the live checks.

- [ ] Hover a reaction chip: a card opens naming the reactors, with "You" first when you are one of
      them, and the count in the header matching the chip.
- [ ] On a message with more than ten reactors, the card names ten and ends with "and N more"; the
      chip count still shows everyone.
- [ ] Tab to a chip with the keyboard: the same card opens on focus and closes on blur.
- [ ] React and un-react yourself: the count moves by exactly one each way, and the number after a
      reload matches what the chip showed live.
- [ ] React from a second browser: the first browser's count and name list update without a reload.
- [ ] Un-react from a second device signed in as the same user: the first device drops the chip's
      highlight and count once, not twice.
- [ ] Mobile: long-press a reaction chip: a sheet lists the same names with the same "and N more"
      tail, and each row is at least 44 px tall.
- [ ] Open a 200-message channel with reactions throughout: reaction reads stay one query per page
      (watch the backend log), and scrolling stays smooth.

## Chat channel archive and restore

Archiving is reversible: archived channels stay listed under their own section and an owner or
admin can put one back. Needs a channel you own plus a second browser signed in as another member.

- [ ] Right-click a channel you own in the sidebar: the menu offers "Archive channel", and the
      confirm explains members keep the history.
- [ ] Archive it: the row leaves the channel groups, and the open channel navigates away.
- [ ] Expand the sidebar's Archived section: the channel is listed there (the section only loads
      when first opened).
- [ ] The second browser, signed in as an ordinary member, sees the channel disappear from its
      sidebar without a reload, and its Archived section lists it with no restore action.
- [ ] Restore it from the Archived section: it returns to its category in your sidebar, and the
      second browser gets it back live without a reload.
- [ ] Sending into the restored channel works; sending into an archived one is still refused.
- [ ] `/admin/audit` filtered to `chat_channel.unarchived` shows the restore, with the channel
      name in the details.
- [ ] An ordinary MEMBER and a channel ADMIN see no Archive entry in the context menu, and the
      restore action is absent on their archived rows.
- [ ] A default channel offers no archive action.
- [ ] Mobile: the chat list carries a collapsed Archived section with the same restore action, and
      restoring there moves the channel back into the list.

## Chat unread cursor: jump to first unread and mark as unread

The read cursor is anchored on a message, so the divider, the badge, and the jump all agree.
Needs a channel with more than one page of history and a second browser signed in as the same user.

- [ ] Have another member send several messages to a channel you are not looking at, then open it:
      the "New messages" divider sits directly above the first message you had not seen, not
      counted back from the bottom.
- [ ] Leave the channel and have that member send more than one page of messages (past 100 is
      ideal). Reopen: the divider carries a "Jump to first unread" action, and using it loads the
      older page and lands on the first message you missed.
- [ ] With unread under one page, the divider reads "New messages" with no jump action, since it
      already sits at the first unread.
- [ ] Right-click a channel with unreads in the sidebar: "Jump to first unread" opens it at the
      same place. A channel with no unreads does not offer the entry.
- [ ] Open a message's overflow menu and choose "Mark as unread": the sidebar badge appears while
      you are still standing in the channel, and it survives new messages arriving, switching tabs
      away and back, and the window losing focus.
- [ ] The second browser, signed in as the same user, shows the same badge without a reload.
- [ ] Leave the channel and reopen it: the badge clears and the cursor moves to the newest message.
- [ ] Mark the very first message in a channel unread: every message reads as unread and the badge
      shows the full count (capped at 100).
- [ ] Send a message in a channel you had marked unread: the badge clears, matching how the cursor
      advances on send.
- [ ] Open the Unreads view and use "Mark read" on a channel you have never opened: the row clears
      and stays cleared after a refresh.
      "Mark all read" clears every listed channel the same way.
- [ ] Mobile: entering a channel with unreads lands on the divider rather than the newest message,
      and the action sheet's "Mark as unread" leaves the badge set for the rest of the visit.

## Chat: also send a thread reply to the channel

A reply sent with the toggle on writes two rows: the reply in the thread, and a separate root message
in the channel that links back. Needs a channel with at least one thread and a second member.

- [ ] The "Also send to #channel" toggle appears in the thread composer only; the channel composer
      never offers it.
- [ ] Send a reply with the toggle on: it lands in the thread, and a copy appears in the channel
      carrying a "Replied to a thread" caption with a preview of the root message.
- [ ] Tap or click that caption: the thread opens on the right root.
- [ ] The thread's reply count goes up by one, not two, and the root's "N replies" line agrees.
- [ ] The toggle resets to off after sending; the next reply stays in the thread unless you set it
      again.
- [ ] The second member sees the channel copy arrive live, already captioned, with no reload.
- [ ] Search for the text of a broadcast reply: exactly one result comes back, and opening it lands
      on the channel copy rather than the thread reply.
- [ ] Send a broadcast reply that @-mentions an agent: the agent answers once, not twice.
- [ ] Mobile: the same toggle sits beside the send button in the thread composer, and the channel
      copy renders the caption and opens the thread on tap.

## Pre-release sweep

- [ ] All linters green: `./manage.py lint`.
- [ ] Full backend test suite green: `./manage.py test`.
- [ ] No new env vars without a matching line in `.env.example` and an
      admin UI surface (cloud operators do not edit env).
- [ ] No new feature works on self-hosted but breaks on multi-tenant
      (or vice versa) -- see the "Two Product Targets" section of
      `CLAUDE.md`.
