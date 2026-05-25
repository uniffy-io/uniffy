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
   `{FRONTEND_BASE_URL}/auth/accept-invite?token=...` link.
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
   `{FRONTEND_BASE_URL}/auth/reset-password?token=...` link, branded
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

## Pre-release sweep

- [ ] All linters green: `./run.sh lint`.
- [ ] Full backend test suite green: `./run.sh test`.
- [ ] No new env vars without a matching line in `.env.example` and an
      admin UI surface (cloud operators do not edit env).
- [ ] No new feature works on self-hosted but breaks on multi-tenant
      (or vice versa) -- see the "Two Product Targets" section of
      `CLAUDE.md`.
