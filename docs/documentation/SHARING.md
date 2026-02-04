# Content Sharing and Permissions in Uniffy

This guide explains how content sharing and permissions work in Uniffy, helping you understand who can access your content and how to share it with others.

---

## Overview

Uniffy uses a layered permission system that gives you control over who can see and interact with your content. Whether you want to keep something private, share it with your team, or make it available to your entire organization, Uniffy provides flexible options to match your needs.

---

## Understanding Visibility Levels

Every piece of content in Uniffy has a visibility setting that determines its default accessibility.

### Private

Your content is visible only to you by default. No one else in your organization can see it unless you explicitly share it with them. This is the default for all new content.

**Best for:** Personal notes, drafts, sensitive information, work in progress.

### Group

Content is accessible to members of specific groups you choose. When you set content to group visibility, you can link it to one or more teams or groups within your organization.

**Best for:** Team projects, department resources, collaborative work within defined teams.

### Organization

All members of your organization can access the content. This makes information broadly available while still keeping it within your company.

**Best for:** Company announcements, shared resources, organizational knowledge bases.

---

## Permission Levels

When you share content with someone, you can choose what they can do with it.

### View

The person can read the content but cannot make any changes. They can see what you've created but cannot modify, delete, or share it further.

### Edit

The person can view and modify the content. They can make changes to what you've created, but they cannot delete it or share it with others.

### Admin

The person has nearly full control. They can view, edit, delete, share with others, and move the content. This is useful when you want someone to help manage content on your behalf.

### Owner

Full control over the content. The original creator of content automatically becomes its owner. Owners can do everything, including transferring ownership to someone else.

---

## How Permissions Work Together

Uniffy evaluates permissions in a specific order to determine what someone can do.

### Ownership Always Wins

If you created the content, you always have full access to it, regardless of any other settings.

### Organization Administrators Have Broad Access

Organization owners and administrators can access all content within the organization. This ensures that administrators can help with content issues, perform audits, and maintain the organization.

### Explicit Permissions Override Visibility

Even if your content is set to private, you can share it with specific people or groups. These explicit permissions override the default visibility. For example, a private note can be shared with a colleague without changing it to organization-wide visibility.

### Group Membership Grants Access

If content is shared with a group and you're a member of that group, you automatically have access. You don't need a separate individual permission.

---

## Sharing Content

### Sharing with Individuals

You can share any content with specific people in your organization. When sharing, you choose:

- **Who** to share with (search by name or email)
- **What level** of access they get (view, edit, or admin)
- **How long** the access lasts (optional expiration date)

The person you share with will be able to find the content and access it according to the permission level you granted.

### Sharing with Groups

Instead of sharing with individuals one by one, you can share with entire groups. Everyone in the group will have access to the content. This is especially useful for:

- Team resources that the whole team needs
- Project materials for a project group
- Department documentation

When new members join the group, they automatically gain access to all content shared with that group.

### Making Content Organization-Wide

Setting content visibility to "Organization" makes it accessible to everyone in your organization. Organization-level default settings may control what members can do with this content (view only, edit, etc.), but administrators always have full access.

---

## Temporary Access

You can grant time-limited access to content. When sharing, set an expiration date, and the permission will automatically become invalid after that date. This is useful for:

- Temporary collaborators or contractors
- Time-sensitive projects
- Review periods

After the permission expires, the person will no longer be able to access the content unless you share it with them again.

---

## Organization Roles and Their Impact

Your role in the organization affects what you can access.

### Members

Regular organization members follow the normal permission rules. They can access:

- Content they own
- Content explicitly shared with them
- Content shared with groups they belong to
- Organization-wide content (based on default settings)

### Administrators

Organization administrators have full access to all content in the organization, regardless of visibility settings or individual permissions. This enables them to:

- Help users with content issues
- Ensure compliance and governance
- Recover accidentally deleted items
- Audit content access

### Owners

Organization owners have the same content access as administrators, plus the ability to manage billing, organization settings, and delete the organization if needed.

---

## Default Settings

Organization administrators can configure default permissions for different content types. These settings control what regular members can do with organization-wide content by default. For example, an administrator might set:

- Notes: Members can view and edit
- Files: Members can view only
- Calendar events: Members can view and edit

These defaults only apply to organization-visibility content and don't affect private or group content.

---

## Groups in Detail

Groups are central to how sharing works at scale in Uniffy.

### What Groups Are

Groups are collections of users within your organization. They might represent:

- Teams (Engineering, Marketing, Sales)
- Projects (Product Launch, Website Redesign)
- Departments (Finance, HR, Operations)
- Interest groups (Book Club, Running Group)

### Group Roles

Within a group, members can have different roles:

- **Member**: Regular group member with standard access
- **Admin**: Can manage group membership and settings

### How Groups Affect Content Access

When content is linked to a group:

1. All current group members can access it
2. New members joining the group automatically gain access
3. Members leaving the group lose access
4. Content can be linked to multiple groups simultaneously

---

## Audit and Transparency

Uniffy tracks who granted permissions and when. This creates an audit trail that shows:

- When a permission was granted
- Who granted it
- What permission level was given
- When a permission was updated or revoked

This helps with compliance requirements and understanding how content has been shared over time.

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
| Admin | Full access to all organization content |
| Owner | Full access to all organization content |

---

## Best Practices

1. **Start private**: Keep content private while working on it, then share when ready.

2. **Use groups for teams**: Instead of sharing individually, create groups for your teams and share with the group.

3. **Choose the right permission level**: Only grant the access level people actually need. If someone only needs to read, give them view access.

4. **Use expiration dates for temporary access**: When sharing with contractors or for short-term collaboration, set an expiration date.

5. **Review shared content periodically**: Occasionally check what you've shared and with whom to ensure permissions are still appropriate.

6. **Leverage organization visibility for common resources**: Don't individually share resources everyone needs. Set them to organization visibility instead.
