---
title: Members
description: Invite, promote, demote, and remove people in your organization. Manage outstanding invitations and per member agent quotas.
sidebar:
  order: 1
---

The Members page is where the people in your organization live. It is the list of who has access to your tenant, what role they hold, and which invitations are still in flight.

## Where to find it

In the admin pages, under the **Access** group, on the **Members** page.

## Who can use it

Anyone with the org role owner or admin. Regular members see their own profile in their account settings, but they cannot reach this page.

A few things are off limits even to admins.

The **owner** badge is read only. You transfer ownership from the Security pages, under Authentication. You do not do it by editing a role.

You cannot change your own role. The dropdown is disabled on your own row.

You cannot remove the owner. The remove icon never shows on the owner row.

## What it looks like

![Members page showing the roster, role dropdowns, and the invitations table below](/docs/admin/members.png)

## The header strip

Three counters sit above the table. They reflect the whole org, not the filtered view, so they stay put while you search.

| Card | Counts |
|------|--------|
| Total Members | Every active membership, whatever the role |
| Administrators | Owners and admins together |
| Regular Members | Members only |

## Filtering the roster

Two controls sit above the table.

Search by name or email matches on display name and primary email. It runs on the server, a moment after you stop typing.

The role filter offers All roles, Owners, Admins, or Members. It runs as a server query, not a slice of what is already loaded.

Filters compose. When filters are active and nothing matches, the table says "No members match your filters" instead of showing the empty state.

## The roster table

| Column | Shown when | Meaning |
|--------|-----------|---------|
| Member | Always | Avatar, display name, email. A `(you)` tag on your own row. |
| Role | Always | A dropdown, Admin or Member, on normal rows. A static Owner badge on the owner. |
| Status | Tablet and up | Active in green, or Inactive. An account goes inactive when a platform operator deactivates it. The row stays so the audit trail stays intact. |
| Actions | Always | Three icons, described below. |

### Per row actions

On desktop these show when you hover a row. On touch devices they are always visible. All three are hidden on the owner row and on your own row.

| Icon | Action | What happens |
|------|--------|--------------|
| Wallet | Set agent spend quota | Opens a dialog to cap how much the member can spend on agents each month, across every agent in the org. The cap is enforced on the server. |
| Hard drives | Invalidate local caches | Forces the member's app to drop what it has cached and reload everything from the server on the next request. Use it when a member reports stale data after a big change, or when you suspect their cache is out of date. |
| Trash | Remove from organization | Asks you to confirm, then removes the membership. The person keeps their Uniffy account, but they lose access to everything in this org. Content they created stays with the org. Ownership does not fall back to anyone. |

### Changing a role

Pick Admin or Member from the dropdown. The change applies right away, with no extra confirmation. To make someone an owner, the current owner uses **Transfer ownership** in the Security pages. Not this dropdown.

Promoting someone to admin gives them everything the admin pages expose. The same access you have. There is no limited admin tier. If you want to hand out a narrower scope, use **domain admins** instead.

## Inviting a new member

Click **Invite member** at the top right. It asks for two things.

The email is the address that receives the invitation link. The role is Admin or Member, and the person joins with that role when they accept.

The invitation goes out through whatever mail configuration is active. Your own if you set one up, the deployment default otherwise. See [Email](/docs/administration/workspace/email/) for how that resolves. If no mail is configured at all, the dialog still creates the invitation. You can copy the link from the Invitations table below.

Invitations expire after a window the deployment sets. The default is 7 days.

## The Invitations table

It sits below the roster. It lists every invitation, whether it is **pending**, **accepted**, **expired**, or **revoked**. Filter by status with the dropdown at the top right.

| Column | Meaning |
|--------|---------|
| Recipient | The invited email. |
| Role | The role they receive when they accept. |
| Expires | An absolute timestamp. After it, the link says "expired" and you need a new invitation. |
| Status | Pending, Accepted, Expired, or Revoked. |
| Actions | **Revoke** kills a pending invitation right away. **Resend** makes a fresh link with a new expiry and sends a new email. It works on pending and expired rows. |

Accepted invitations stay in the table for the record. You cannot resend or revoke them.

## What lands in the audit log

Every change on this page writes an audit row. Search the Audit Log by action name.

| Action | When it fires |
|--------|---------------|
| `organization.member_added` | A direct add, which is rare. Invitations are the normal path. |
| `organization.member_added_via_invite` | An invitation is accepted and the membership is created |
| `organization.member_role_changed` | The role dropdown changes |
| `organization.member_removed` | The remove icon is confirmed |
| `organization.member_invited` | A new invitation is created |
| `organization.invitation_revoked` | A pending invitation is cancelled |
| `organization.invitation_resent` | A new link is generated and the email is sent again |

Each row records who did it, which is you, the target user or email, the old and new role where it applies, and the timestamp.

## Troubleshooting

The invitation email never arrived. Open the Email page and look at **Deliveries**. If the row shows bounced or complained, that address is suppressed and Uniffy will not retry it. Fix the problem at the source, remove the suppression, then resend.

You cannot change your own role. The dropdown is disabled on purpose. Have another admin make the change, or transfer ownership first.

A removed member still shows up in @ mentions or shares. Caches lag for a few seconds. If it sticks, use **Invalidate local caches** on any device still seeing them. The index refreshes.

The quota dialog will not open. Quotas need agents turned on for the org. Open the Agents page first.

## See also

- [Groups](/docs/administration/access/groups/): bundle members for permission grants.
- [Domain Admins](/docs/administration/access/domain-admins/): narrower admin scopes per feature area.
- [Default Permissions](/docs/administration/security/default-permissions/): what new content inherits when a member creates it.
- [Audit Log](/docs/administration/security/audit-log/): the full event history for member changes.
