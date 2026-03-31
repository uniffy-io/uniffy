# Sharing and Permissions

## Table of Contents

- [Quick Reference](#quick-reference)
- [Visibility](#visibility)
- [Permission Levels](#permission-levels)
- [Permission Resolution Order](#permission-resolution-order)
- [Sharing Content](#sharing-content)
- [Temporary Access](#temporary-access)
- [Organization Roles](#organization-roles)
- [Default Settings](#default-settings)
- [Groups](#groups)
- [Domain Admins](#domain-admins)
- [Audit Trail](#audit-trail)

---

## Quick Reference

| Visibility | Who Can Access |
|------------|----------------|
| Private | Only you (and people you explicitly share with) |
| Group | Members of linked groups |
| Organization | All organization members |

| Permission Level | Can View | Can Edit | Can Delete | Can Share | Can Move |
|------------------|----------|----------|------------|-----------|----------|
| View | Yes | No | No | No | No |
| Edit | Yes | Yes | No | No | No |
| Admin | Yes | Yes | Yes | Yes | Yes |
| Owner | Yes | Yes | Yes | Yes | Yes |

| Organization Role | Content Access |
|-------------------|----------------|
| Member | Follows normal permission rules |
| Domain Admin | Full access within assigned domains (Chat, Files, etc.) |
| Admin | Full access to all organization content |
| Owner | Full access to all organization content |

---

## Visibility

Every piece of content has a visibility setting.

- **Private** (default) - Only you can see it unless explicitly shared.
- **Group** - Accessible to members of one or more linked groups.
- **Organization** - All organization members can access it.

---

## Permission Levels

When sharing content, you choose what the recipient can do:

- **View** - Read only.
- **Edit** - Read and modify.
- **Admin** - Full control: view, edit, delete, share, and move.
- **Owner** - Same as Admin. Automatically assigned to the creator. Can transfer ownership.

---

## Permission Resolution Order

Permissions are evaluated in this order:

1. **Ownership** - Content creators always have full access.
2. **Organization role** - Org admins and owners can access all content.
3. **Domain admin** - Domain admins have full access within their assigned domain.
4. **Explicit permissions** - Individual grants override visibility. A private note can be shared with specific people without changing its visibility.
5. **Group membership** - If content is linked to a group you belong to, you have access.

---

## Sharing Content

**With individuals:** Pick a user, choose a permission level (view/edit/admin), and optionally set an expiration date.

**With groups:** Share with an entire group at once. New members joining the group automatically gain access; members who leave lose it.

**Organization-wide:** Set visibility to Organization. Default permission levels for org-wide content are configured by admins.

---

## Temporary Access

Set an expiration date when sharing. The permission is automatically revoked after that date. Useful for contractors, review periods, or time-sensitive projects.

---

## Organization Roles

- **Member** - Access own content, explicitly shared content, group content, and org-wide content (based on defaults).
- **Admin** - Full access to all organization content.
- **Owner** - Same as Admin, plus org settings, billing, and deletion.

---

## Default Settings

Org admins can configure default permission levels per content type for organization-visibility content. Example:

- Notes: view and edit
- Files: view only
- Calendar events: view and edit

These defaults do not affect private or group content.

---

## Groups

Groups are collections of users within an organization (teams, projects, departments).

**Group roles:**

- **Member** - Standard access.
- **Admin** - Can manage group membership and settings.

**Content linked to a group:**

- All current members can access it.
- New members get access automatically.
- Leaving the group removes access.
- Content can be linked to multiple groups.

---

## Domain Admins

Domain admins have elevated access within a specific area of the application (Chat, Files, Notes, Calendar, Projects, or Agents) without being a full organization admin.

**Who can assign domain admins:** Organization admins and owners.

**What domain admins can do:**

| Domain | Elevated Access |
|--------|----------------|
| Chat | Create and delete any channel, manage categories, moderate messages, add and remove members across all channels |
| Files | Manage shared folders and storage (future) |
| Notes | Manage all notes across the organization (future) |
| Calendar | Manage shared calendars and org-wide events (future) |
| Projects | Manage all projects and assign across teams (future) |
| Agents | Manage all agents and provider keys (future) |

**What domain admins cannot do:**

- Access other domains they are not assigned to.
- Change organization settings, billing, or member roles.
- Override organization admin decisions.

**How it works:**

- A user can be a domain admin for one or more domains at the same time.
- Domain admin is a simple on/off assignment, there are no sub-levels.
- Org admins and owners already have full access everywhere, so domain admin is for regular members who need elevated access in a specific area.

**Managing domain admins:** Go to Admin > Domain Admins to assign or revoke domain admin roles. Domain admin badges also appear on the Members page.

---

## Audit Trail

All permission changes are tracked: who granted what, when, and any updates or revocations.
