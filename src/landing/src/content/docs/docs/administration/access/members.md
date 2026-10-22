---
title: Manage members and invitations
description: Invite and remove Uniffy members, assign organization roles, and set agent spend quotas. Understand inactive accounts and what membership changes affect.
sidebar:
  label: Members
  order: 1
---

On the Members page you decide who reaches your organization and what they can do once they are in. Owners and admins can open it. Members cannot.

![Members page showing the three counter cards, the search and role filter, and the roster with a role dropdown on every row](/docs/admin/members.png)

Search and the role filter both run as server queries, so they cover every member in the org rather than the rows already loaded.

## Limits that hold even for admins

You cannot change your own role. Have another admin make the change.

You cannot remove the owner, and the owner badge is read only. Ownership moves through **Transfer ownership** on the [Organization](/docs/administration/access/organization/) page, never through the role dropdown.

## Roles

Admin and Member are the only roles you assign here. A change applies immediately, with no confirmation step.

Promoting someone to admin gives them everything you have. There is no limited admin tier. When you want to hand out a narrower scope, use [domain admins](/docs/administration/security/access-model/#narrower-admins) instead.

## Removing someone

Removal takes away their access to this organization and nothing else. They keep their Uniffy account, and every other organization they belong to stays exactly as it was.

It applies on the spot, with no grace period. A note they have open stops taking their edits, a call they are in drops them, and anything else they try in this organization is refused.

Content they created stays with the organization. Ownership does not fall back to anyone, so nothing is orphaned and nothing is deleted.

Removal is reversible. Uniffy keeps the membership as history, so when you invite the same person again and they accept, they get back their own work and the shares they held. They return with the role you pick. Their domain admin scopes and chat channel memberships do not come back on their own, so grant them again where they still apply.

## Inactive accounts

An account reads Inactive when a platform operator deactivates it. That is a different thing from removing a member, and you do not trigger it from this page.

Their row stays in the roster, so the audit trail stays intact. A removed member leaves the roster instead.

## Agent spend quotas

Each member can carry a monthly cap on agent spend, counted across every agent in the organization rather than per agent.

The cap is enforced on the server, so it holds no matter which client they use. Quotas need agents enabled for the org first.

## Invalidating a member's caches

Invalidating caches forces that member's app to drop everything it has cached and reload from the server on its next request. Reach for it when someone reports stale data after a large change.

## Inviting

An invitation carries an email address and the role the person joins with. Every invitation stays pending until the person accepts it. Nobody lands in your organization because you typed their address.

Someone new to Uniffy follows the link in the mail and creates their account on the way in.

Someone who already has an account accepts signed in. The mail link asks them to sign in first and brings them back to the invitation. They can also skip the mail, because their welcome page lists every pending invitation sent to their address and their user menu shows the count.

Inviting someone who is already an active member is refused. Change their role instead. A removed member is no longer a member, so you can invite them back.

Inviting the same address again replaces the pending invitation. The earlier link stops working.

The mail goes out through whatever mail configuration is active. Yours if you set one up, the deployment default otherwise. See [Email and SMTP](/docs/deployment/configure/#email-and-smtp-optional-system-default) for how that resolves.

When no mail is configured at all, the invitation is still created. Someone who already has an account finds it on their welcome page. Someone new has no other way to reach the link, so set up mail before you invite people who are new to Uniffy.

Invitations expire after 30 days.

## Invitations after they go out

Every invitation is pending, accepted, expired, or revoked. When the person declines, the invitation reads as revoked, and the audit log records that they declined.

**Revoke** kills a pending invitation immediately. **Resend** issues a fresh link with a new expiry and sends it again, and it works on expired invitations as well as pending ones.

Accepted invitations stay for the record. You cannot revoke one to undo a membership. Remove the member instead.

## What lands in the audit log

Every change here writes an audit row. Search the Audit Log by action name.

| Action | When it fires |
|--------|---------------|
| `organization.member_invited` | A new invitation is created |
| `auth.invitation_accepted` | The invited person accepts |
| `organization.member_added` | A membership is created or restored. The row names the source, such as an accepted invitation. |
| `organization.invitation_declined` | The invited person declines |
| `organization.invitation_revoked` | An admin cancels a pending invitation |
| `organization.invitation_resent` | A new link is generated and the email is sent again |
| `organization.member_role_changed` | A role changes |
| `organization.member_removed` | A removal is confirmed |
| `organization.member_left` | A member leaves on their own |

Each row records who acted, the target user or email, the old and new role where that applies, and the timestamp.

## Troubleshooting

**The invitation email never arrived.** Open the Email page and look at Deliveries. If the row shows bounced or complained, that address is suppressed and Uniffy will not retry it. Fix the problem at the source, clear the suppression, then resend. If the person already has an account, they can accept from their welcome page while you sort out the mail.

**The invite is refused as already a member.** That person is in your roster already. Find them there and change their role if that is what you meant.

**A removed member still shows up in @ mentions or shares.** Caches lag for a few seconds. If it sticks, invalidate caches on any device still seeing them.

**The quota dialog will not open.** Quotas need agents turned on for the org. Open the Agents page first.

## See also

- [Organization](/docs/administration/access/organization/): rename the organization, transfer ownership, or delete it.
- [Teams and groups](/docs/administration/access/teams-and-groups/): bundle members for permission grants.
- [Access and privacy](/docs/administration/security/access-model/): what new content starts with, narrower admin scopes per feature area, and what no admin can see.
- [Audit Log](/docs/administration/security/audit-log/): the full event history for member changes.
