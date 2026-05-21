# Sharing and Permissions

[[[toc|min=1|max=4|style=flat|bullets=none]]]

---

## Quick Reference

| Access Mode | Who Can Access |
|-------------|----------------|
| Owner only | Only the owner. No one else can be added until the mode is widened. |
| Explicit members | The owner plus the people and groups you add. Nothing is open to the rest of the organization. |
| Open to organization | Everyone in the organization gets a baseline role you choose. You can still elevate or block specific people. |

| Role | Read | Comment | Edit | Delete | Manage members | Transfer ownership |
|------|------|---------|------|--------|----------------|--------------------|
| Viewer | Yes | No | No | No | No | No |
| Commenter | Yes | Yes | No | No | No | No |
| Editor | Yes | Yes | Yes | No | No | No |
| Admin | Yes | Yes | Yes | Yes | Yes | No |
| Owner | Yes | Yes | Yes | Yes | Yes | Yes |
| Blocked | No | No | No | No | No | No |

| Organization Role | What it Grants on Content |
|-------------------|---------------------------|
| Member | Whatever the access mode and role assignments above describe. |
| Domain admin | Full admin access within the assigned domain (Notes, Files, Calendar, Projects, Agents, Chat, Rooms). Bypasses Blocked. |
| Admin | Full owner access on every piece of content in the organization. Bypasses Blocked. |
| Owner | Same as Admin, plus organization settings, billing, and deletion. |

---

## Access Modes

Every piece of content has an access mode that determines who can reach it before any explicit membership is considered.

- **Owner only.** The owner is the only person with access. No members can be added in this mode. Use this for personal drafts and private notes.
- **Explicit members.** The owner plus the people and groups listed in the members panel. Nothing is shared with the wider organization. Use this for closed teams and confidential projects.
- **Open to organization.** Every member of the organization automatically receives the baseline role you pick (Viewer, Commenter, Editor, or Admin). You can still add specific people with a different role, and you can block individuals who should not see it. Use this for shared knowledge bases, team calendars, and org-wide projects.

The access mode and the baseline role are stored on the content itself. Each item picks its own setting independently, so two projects in the same organization can have completely different access shapes.

---

## Content Roles

Roles are the same six values across every content type. Each role includes the abilities of the roles below it.

- **Viewer.** Read access only.
- **Commenter.** Read access plus the ability to comment.
- **Editor.** Read, comment, and modify the content.
- **Admin.** Everything an editor can do, plus delete the content, change the access mode, change the baseline role, and add or remove members.
- **Owner.** Everything an admin can do, plus transfer ownership to someone else. Each content item has exactly one owner. The creator is the initial owner.
- **Blocked.** An explicit deny. A blocked user cannot see the content even if they would otherwise have access through the baseline role or a group membership. Blocked is a real role you assign just like the others, and it shows in a dedicated section of the members panel so it is never invisible.

---

## How Access is Decided

When a user opens a piece of content, the system answers "what role does this user have here?" in the following order. The first match wins.

1. **Organization admin or owner.** Treated as Owner on every piece of content. Bypasses Blocked.
2. **Domain admin.** Treated as Admin on every piece of content inside their assigned domain (for example, a Files domain admin has Admin on every file and folder). Bypasses Blocked.
3. **Content owner.** The owner always has Owner role. Owners cannot be blocked or demoted by other members; ownership only changes through Transfer Ownership.
4. **Explicit member row.** Direct grants and group grants are evaluated together. If any source says Blocked, the user is blocked. Otherwise the highest applicable role wins.
5. **Baseline role.** If the access mode is Open to organization and the user is a member of the organization, they get the baseline role. Otherwise they have no access.

---

## Managing Members

Anyone with the Admin or Owner role on a piece of content can manage its members. The members panel lives on each content item's settings or detail screen.

From the members panel you can:

- Change the access mode (Owner only, Explicit members, Open to organization).
- Pick the baseline role for Open to organization mode.
- Add a person or a group with any role except Owner.
- Change an existing member's role.
- Remove a member.
- Block a person or group, or unblock them.
- Set an expiration date on any membership.
- Transfer ownership to another user.

The members panel always shows three things: the current owner, the access mode and baseline role, and the list of explicit members grouped into Members and Blocked.

### Narrowing the access mode

If you switch a content item from Open to organization or Explicit members down to Owner only, the system asks you to confirm because every existing member will be removed. Switching from Open to organization down to Explicit members preserves your existing members but removes baseline access for everyone else; the confirmation dialog summarises who will lose access.

### Widening the access mode

Switching from Explicit members up to Open to organization preserves every existing member. Their explicit roles continue to override the baseline, so a Commenter remains a Commenter even if the baseline role is Viewer.

---

## Blocking a User

Blocking is the way to remove a single person from otherwise open content without changing the access mode.

- A blocked user does not see the content in any list, search result, or mention picker.
- A blocked user receives a "not found" response if they try to open the content directly.
- Blocking applies on top of any other source of access. If the user has direct Editor access, blocking them still takes precedence.
- Blocking via a group blocks every member of that group. Removing the user from the group automatically lifts the block.
- Organization admins, organization owners, and the content's domain admin cannot be blocked. The system rejects the attempt and explains why.

The blocked subsection of the members panel makes it obvious who has been removed and by whom.

---

## Transferring Ownership

Ownership only changes through the Transfer Ownership action, which is restricted to the current owner (or an organization or domain admin acting on their behalf).

When ownership is transferred:

- The new owner receives the Owner role on the content row.
- The previous owner is automatically downgraded to Admin so they keep full management access.
- If the new owner already had an explicit member row, that row is replaced.
- A row is added to the access history recording who initiated the transfer.

The new owner must already be an active member of the organization.

---

## Temporary Access

Every membership row can carry an optional expiration date and time. After that moment passes, the membership is treated as if it had been removed: the user (or every member of the group) loses whatever access that row granted. Existing baseline access is unaffected.

Temporary access is useful for contractors, audits, review periods, or time-bounded collaboration. Expirations apply to Blocked rows too, so you can block someone for a defined window without remembering to undo it later.

---

## Sharing With Groups

Members are not limited to individual users. You can add a group to any content item with any role, including Blocked.

- Every current member of the group inherits that role.
- Members joining the group later automatically gain the role.
- Members leaving the group automatically lose the role.
- Multiple groups can be added with different roles. The highest role applies, except that Blocked from any source always wins.
- Direct user membership and group membership are evaluated together for the same person, and the highest non-blocked role wins.

Groups are managed from the Groups page in the admin area. See the Groups documentation for how to create and populate them.

---

## Organization Roles

- **Member.** Standard access. Sees only content the rules above grant them.
- **Admin.** Treated as Owner on every piece of content in the organization. Bypasses Blocked. Can also manage members, groups, and organization settings.
- **Owner.** Same as Admin, plus the ability to manage billing and delete the organization.

---

## Default Settings

Organization admins control the defaults that apply to brand new content of each type. The defaults page is at Admin > Permissions and lets you pick, per content type:

- The default access mode (Owner only, Explicit members, or Open to organization).
- The default baseline role for Open to organization mode (Viewer, Commenter, Editor, or Admin).

When a user creates a new note, file, project, calendar event, agent, or other content, the new item starts with these defaults. The owner can change them immediately from the members panel; the defaults only describe the starting state.

The shipped defaults are:

| Content type | Default access mode | Default baseline role |
|--------------|---------------------|-----------------------|
| Note | Owner only | - |
| File | Owner only | - |
| Folder | Owner only | - |
| Calendar event | Open to organization | Viewer |
| Calendar | Open to organization | Viewer |
| Project | Open to organization | Editor |
| Task | Inherits the parent project | - |
| Agent | Open to organization | Viewer |
| Provider key | Owner only | - |
| Prompt | Open to organization | Viewer |
| Cron task | Owner only | - |
| Room | Open to organization | Viewer |

Child content (tasks, comments, attachments, file versions, calendar reminders, calendar event attendees) inherits the access of its parent and is not configured separately.

---

## Domain Admins

Domain admin status is a way to grant elevated access in one specific area of the application without granting full organization admin. A user can be a regular member overall but a domain admin for one or more of: Notes, Files, Calendar, Projects, Agents, Chat, or Rooms.

What a domain admin gets:

- Treated as Admin on every piece of content inside their assigned domain.
- Bypasses Blocked on content inside their assigned domain.
- Can manage members, change the access mode, change the baseline role, and delete content in that domain.
- Cannot transfer ownership of content they do not own (only the owner or an organization admin can transfer ownership).

What a domain admin does not get:

- Access to other domains they are not assigned to.
- Organization settings, billing, member roles, or domain admin assignments.
- Override of decisions made by organization admins.

Domain admin is binary: a user either is one for a given domain or is not. There are no sub-levels. Only organization admins and owners can grant or revoke domain admin status, from Admin > Domain Admins or by editing a member's domain roles on the Members page.

---

## Access History

Every change to a content item's access is recorded in an append-only history. The history is visible from the content's settings or detail screen, alongside the members panel.

Recorded actions:

- A member was added.
- A member's role was changed.
- A member was removed.
- The access mode was changed.
- The baseline role was changed.
- Ownership was transferred.

Each entry shows who performed the action, what the previous and new state were, an optional note that the actor can leave to explain the change, and the exact time. Access history is never edited or deleted, so you can always answer "who removed Alice from this project, and when?" The history continues to exist even if a user is later removed from the organization.

You can filter the history by actor, action type, and time range. Organization admins can review the access history of any content; regular members can review the history of any content they have access to.
