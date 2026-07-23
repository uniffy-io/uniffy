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

## Agents: memory scopes

Needs two users (A, B) in one org, one shared agent, agents-in-chat enabled,
and a public channel with the agent bound (`(both products)`).

- [ ] As A in a private agent session, ask the agent to remember a personal
      fact -> the tool card says the memory is private; the entry appears in
      the agent's Memories tab under "My memory" with description + provenance.
- [ ] As A in the public channel, trigger the agent and inspect the run: the
      personal fact is neither mentioned nor reachable (`memory.list` in the
      channel shows channel + org entries only). This is the leak guard.
- [ ] As B in the channel, ask the agent to remember a team fact -> as A,
      trigger the agent and ask about it: the agent reads the channel entry
      (visible memory.read call in the activity pane) and answers.
- [ ] Channel memory dialog (composer agent picker -> "Memory") lists the
      entry with "saved by B"; as a plain member A cannot delete B's entry;
      as a channel moderator the delete works.
- [ ] As A, ask the agent in the channel to remember something "just for me"
      -> the agent must decline and point to the DM (no user-scope write from
      a channel run).
- [ ] Pin flow: in "My memory" pin an entry -> preview system prompt (agent
      editor) shows its full content under "Pinned"; unpinned entries show as
      one index line each. Pin a 6th entry -> clear limit error.
- [ ] Org memory: as a non-manager the Org segment is read-only; as the agent
      owner add + pin an org entry -> both A's and B's next runs can read it.
- [ ] `memory.forget` on a pinned entry via chat ("forget X") -> tool refuses
      and names the pin; unpinning in the UI then repeating succeeds.
- [ ] Group DM with the agent: memories save to the conversation, not to the
      trigger user ("My memory" stays unchanged).
- [ ] Quota: import/save until the scope cap (200) -> tool returns the limit
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

## Pre-release sweep

- [ ] All linters green: `./manage.py lint`.
- [ ] Full backend test suite green: `./manage.py test`.
- [ ] No new env vars without a matching line in `.env.example` and an
      admin UI surface (cloud operators do not edit env).
- [ ] No new feature works on self-hosted but breaks on multi-tenant
      (or vice versa) -- see the "Two Product Targets" section of
      `CLAUDE.md`.
