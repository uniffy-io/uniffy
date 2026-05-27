---
title: Members
description: Invite, promote, demote, and remove people in your organization. Manage outstanding invitations and per-member agent quotas.
sidebar:
  order: 1
---

The Members page is where the people in your organization live. It is the canonical list of who has access to your tenant, what role they hold, and which invitations are still in flight.

## Where

`/admin/members` &mdash; sidebar group **Access** &rarr; **Members**.

## Who can use it

Anyone with org role `OWNER` or `ADMIN`. Regular members see their own profile in their account settings but cannot reach this page.

Some actions are further restricted:

- **Owner badge** is read-only. Ownership is transferred from `/admin/security` &rarr; Authentication, not by editing a member's role.
- **You cannot modify your own role.** The role dropdown is disabled for the currently signed-in row.
- **You cannot remove the owner.** The trash icon does not render on the owner row.

## What it looks like

![Members page showing roster, role dropdowns, and the invitations table below](/docs/admin/members.png)

## The header strip

Three counters above the table. They reflect the **whole org**, not the filtered view, so they stay stable while you search.

| Card | Counts |
|------|--------|
| Total Members | Every active membership row, regardless of role |
| Administrators | `OWNER` + `ADMIN` combined |
| Regular Members | Role `MEMBER` only |

## Filtering the roster

Two controls sit above the table:

- **Search by name or email** &mdash; matches on display name and primary email. Debounced 300 ms, server-side.
- **Role filter** &mdash; `All roles` / `Owners` / `Admins` / `Members`. Applied as a server query, not a client-side slice.

Filters compose. An empty roster with filters active shows "No members match your filters" rather than the empty state.

## The roster table

| Column | Shown when | Meaning |
|--------|-----------|---------|
| Member | Always | Avatar, display name, email. `(you)` tag on your own row. |
| Role | Always | Dropdown (`Admin` / `Member`) for normal rows. Static **Owner** badge for the owner. |
| Status | `>= sm` viewport | `Active` (green) or `Inactive`. Set when an account is deactivated by a sysadmin; the row stays so audit trails remain intact. |
| Actions | Always | Three hover-revealed icons described below. |

### Per-row actions

Visible on hover on desktop, always visible on tablet/phone (touch). All three are hidden on the owner row and on your own row.

| Icon | Action | What happens |
|------|--------|--------------|
| Wallet | Set agent spend quota | Opens a dialog to cap the member's monthly LLM spend across all org agents. Quota is enforced server-side by the agents domain. |
| Hard drives | Invalidate local caches | Rotates the member's cache-key seed. Their browser/app reloads everything from the server on next request. Use when a member reports stale data after a major change, or when you suspect their local cache is poisoned. |
| Trash | Remove from organization | Confirms, then removes the membership row. The user keeps their account globally but loses access to every piece of content in this org. Content they created stays owned by the org; ownership does not transfer back to anyone. |

### Changing a role

Pick `Admin` or `Member` from the dropdown. Change applies immediately, no extra confirmation. To make someone an owner, the current owner uses **Transfer ownership** on `/admin/security`, not this dropdown.

Promoting to `ADMIN` grants the new admin everything `/admin/*` exposes &mdash; same as your own access. There is no "limited admin" tier; for narrower scopes, use **Domain Admins** instead.

## Inviting a new member

Click **Invite member** (top right). Two fields:

- **Email** &mdash; the address that receives the invitation link.
- **Role** &mdash; `Admin` or `Member`. The invited user joins with this role on acceptance.

The org sends an email through whichever SMTP config is active (per-org if configured, deployment fallback otherwise &mdash; see [Email](/docs/administration/workspace/email/)). If email is not configured at all, the dialog still creates the invitation row; the link can be copied from the Invitations table below.

Invitations expire after a deployment-configured window (default 7 days).

## The Invitations table

Sits below the members roster. Lists every invitation that is **pending**, **accepted**, **expired**, or **revoked** &mdash; filter with the status dropdown at the top right of the table.

| Column | Meaning |
|--------|---------|
| Recipient | The invited email. |
| Role | The role they will receive on acceptance. |
| Expires | Absolute timestamp. After this, the link returns "expired" and a new invitation is required. |
| Status | `Pending`, `Accepted`, `Expired`, or `Revoked`. |
| Actions | **Revoke** invalidates a pending invitation immediately. **Resend** generates a fresh link with a new expiry and dispatches a new email; valid for `pending` and `expired` rows. |

Accepted invitations remain in the table for audit reference &mdash; they cannot be resent or revoked.

## Audit actions emitted

Every mutation on this page writes an audit row. Search for them in `/admin/audit-logs` by action name:

| Action | When it fires |
|--------|---------------|
| `organization.member_added` | Direct add (rare; normally invitations are used) |
| `organization.member_added_via_invite` | Invitation accepted and membership row created |
| `organization.member_role_changed` | Role dropdown changed |
| `organization.member_removed` | Trash icon confirmed |
| `organization.member_invited` | New invitation created |
| `organization.invitation_revoked` | Pending invitation cancelled |
| `organization.invitation_resent` | New link generated and email re-sent |

Each row records the actor (you), the target user or email, the old and new role where relevant, and the timestamp.

## Troubleshooting

- **Invitation email never arrived.** Check `/admin/email` &rarr; **Deliveries**. If the row shows `bounced` or `complained`, the address is now suppressed and future sends will not retry. Resolve at the source, then remove the suppression and resend.
- **"Cannot change your own role."** The dropdown is disabled by design. Have another admin make the change, or transfer ownership first.
- **Removed member still appears in @ mentions or shares.** Caches lag for a few seconds. If it persists, use **Invalidate local caches** on any device still seeing them &mdash; the index will refresh.
- **Quota dialog refuses to open.** Quotas require the agents domain to be enabled for the org. Visit `/admin/agents` first.

## See also

- [Groups](/docs/administration/access/groups/) &mdash; bundle members for permission grants
- [Domain Admins](/docs/administration/access/domain-admins/) &mdash; narrower admin scopes per feature area
- [Default Permissions](/docs/administration/security/default-permissions/) &mdash; what new content inherits when a member creates it
- [Audit Log](/docs/administration/security/audit-log/) &mdash; full event history for member changes
