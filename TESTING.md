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
- [ ] Push click routing, both paths: with the app open in a tab, a push click focuses that tab and lands on the
      content (chat mention -> the message, note share -> the note). With every tab closed, the same click opens a
      window on the content, not on the dashboard. Unresolvable targets land on `/notifications`.
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

### Skill drafts (builder inbox)

- [ ] Member thumbs-down in an agent chat produces a draft; the member
      sees the draft card WITHOUT a Review button; a builder sees Review
      and can open, edit, and save it - the saved skill is an organization
      skill (no scope picker anywhere).
- [ ] A builder can discard a draft raised by someone else; the card in
      the original channel settles to its resolved state.

### Chat ports (agent DMs)

- [ ] In an agent DM, type `/` -> the skill popup lists the agent's
      runnable skills; picking one shows a dismissible skill chip; send ->
      the reply follows the skill and the sent message shows the skill
      badge.
- [ ] Thumbs on an agent chat reply: rate up, reload -> the thumb is
      still filled; click again -> cleared; thumbs-down feeds the skill
      analyzer (draft may appear later).
- [ ] Proposed-skill draft card renders after an agent reply that
      produced one; opening it lands in the draft editor.
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

## Pre-release sweep

- [ ] All linters green: `./manage.py lint`.
- [ ] Full backend test suite green: `./manage.py test`.
- [ ] No new env vars without a matching line in `.env.example` and an
      admin UI surface (cloud operators do not edit env).
- [ ] No new feature works on self-hosted but breaks on multi-tenant
      (or vice versa) -- see the "Two Product Targets" section of
      `CLAUDE.md`.
