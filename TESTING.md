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
- [ ] A user who had the OLD `media-stream-worker` installed loads the app once: it is unregistered on boot
      (Application > Service Workers shows it removed) and assets still load via the cookie.

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

## Calendar meetings (channel-bound)

An event can bind to a chat channel as a Uniffy online meeting. Join rides the existing calls
stack through the global pre-join modal; the calendar copies nothing into channel membership.
Needs user A (organizer + channel member), user B (attendee to add), and user C (non-member).

- [ ] As user A, open the event editor, switch the meeting section to "Uniffy meeting", pick a
      private channel A belongs to, save. The detail panel shows a "Join meeting" button.
- [ ] Flip the section to "Link": the channel binding clears and the URL input returns. Flip to
      "None": both the URL and the binding clear on save.
- [ ] Add an attendee (B) who is NOT in the picked channel. The editor shows "N attendees cannot
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
      a validation error (the editor already enforces one mode).
- [ ] Mobile: open a channel-bound event. It shows a read-only "Online meeting" row with no join
      affordance (native calls are not shipped).
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

## Agents: OpenRouter and xAI provider keys

Both flows need a real key for the provider under test. Run as an org
admin; the same steps must pass on cloud-style and self-hosted deploys
(`(both products)`).

- [ ] OpenRouter: `/agents` -> Config tab -> Add Key with provider
      `OpenRouter` and a real `sk-or-...` key -> Validate succeeds and the
      key shows valid -> the curated OpenRouter models (slugs like
      `anthropic/claude-sonnet-5`) appear in the agent model pickers ->
      send one message to an agent on an OpenRouter model -> the run log
      shows token usage and a non-null cost.
- [ ] xAI: same flow with provider `xAI (Grok)` and a real `xai-...` key
      -> Grok models appear in the pickers -> send one message on a Grok
      model -> token usage and cost are logged.

## Agents: reasoning display + model parameters

Needs one agent per provider under test on a reasoning-capable model
(`(both products)`).

- [ ] Agents tab -> Overview -> Model parameters: set Reasoning effort on
      a reasoning model (e.g. Opus 4.8 at `xhigh`) -> ask a multi-step
      question in the agent session view -> a "Thinking..." pane streams
      reasoning ABOVE the answer, never interleaved with it, then flips to
      "Thought for Ns" and auto-collapses when the answer starts.
- [ ] Same agent mentioned in a chat channel: the pane streams on the
      chat message too; markdown in the reasoning (bold section headers)
      renders formatted, not as raw `**`.
- [ ] Reload the page after the reply finishes: the collapsed "Thought
      for Ns" pane is still there on the historical message (session view
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

## Pre-release sweep

- [ ] All linters green: `./manage.py lint`.
- [ ] Full backend test suite green: `./manage.py test`.
- [ ] No new env vars without a matching line in `.env.example` and an
      admin UI surface (cloud operators do not edit env).
- [ ] No new feature works on self-hosted but breaks on multi-tenant
      (or vice versa) -- see the "Two Product Targets" section of
      `CLAUDE.md`.
