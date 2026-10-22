---
title: Organization settings
description: Rename your Uniffy organization, change its slug, transfer ownership, or delete it. Learn what a slug change breaks and how long a deleted organization can come back.
sidebar:
  label: Organization
  order: 0
---

Rename the organization, change its slug, hand it to a new owner, or delete it. These are the decisions that belong to the organization as a whole.

## Who can do what

Owners and admins open this page. Members cannot.

| Action | Owner | Admin |
|--------|-------|-------|
| Rename the organization and change its slug | Yes | Yes |
| Transfer ownership | Yes | No |
| Delete the organization | Yes | No |
| Leave the organization | No, transfer first | Yes |

Every organization has exactly one owner. That is why the owner cannot leave. Hand the organization to someone else first, or delete it.

## Name and slug

The name is what members see in their organization list and user menu. Change it whenever you like. Nothing else moves.

The slug is the short name that identifies the organization in links. Change it and those links change with it, so the old ones stop working. Nothing redirects from the old slug. Tell your members before you change it.

A slug another organization holds is refused. So is the slug of a deleted organization, until that organization is purged.

Both changes apply for everyone at once. The audit log keeps the previous slug.

## Transfer ownership

Pick an active member and confirm. They become the owner on the spot, with nothing to accept on their side, and you stay on as an admin.

You lose the owner powers the moment you confirm. You can no longer delete the organization or hand it on. Only the new owner can give it back.

With no other active member there is nobody to transfer to. Invite someone first, or delete the organization.

## Delete the organization

Only the owner can delete, and Uniffy asks you to type the slug to confirm.

Everyone loses access at once, you included. Open notes stop taking edits, calls in the organization end, and your tab lands on your welcome page. Every member keeps their Uniffy account and their other organizations.

Nothing is erased yet. The organization waits out a **purge window** of 30 days, and its slug stays taken for that time. The owner gets a mail with the purge date and another one a day before it.

A platform operator can restore the organization before the purge. You cannot do that from here. Ask whoever runs your deployment, and ask before the purge date. On `cloud.uniffy.io`, that is us.

Once the window ends, the organization and everything in it is gone for good.

## Leaving

An admin can leave from this page or from Settings. Both do the same thing. Access ends at once, and what they made stays with the organization. [Leaving an organization](/docs/user/organizations/#leaving-an-organization) in the user guide covers it from the member's side.

## What lands in the audit log

| Action | When it fires |
|--------|---------------|
| `organization.settings_changed` | The name or slug changes. The row keeps the previous slug. |
| `organization.ownership_transferred` | The owner hands the organization to another member |
| `organization.member_left` | A member or admin leaves on their own |
| `organization.deleted` | The owner deletes the organization |

Deleting is the owner's call, and undoing it is the operator's. We split it that way on purpose, so one bad click never has to be final.
