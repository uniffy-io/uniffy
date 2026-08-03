---
title: Teams and groups
description: Model your org structure with teams, keep access groups as sharing lists, and know which admin page owns which job. Names are unique per organization.
sidebar:
  order: 2
---

Your admin pages give you four people surfaces, and each one owns exactly one job. Knowing the split saves you from hunting.

| Page | Owns |
|------|------|
| Members | Who is in the org, their role, their profile facts, their manager |
| Teams | Org structure: the team tree and each team's lead |
| Groups | Access groups, plain sharing lists |
| Directory | Identity sources and the People page switches |

Owners and admins can open all four. Members browse the People page and edit their own personal fields, and that is as far as they get.

## Teams

A **team** is an organizational unit. It has members, a lead, and optionally a parent team, so Engineering can contain Backend, Frontend, and Platform, and Platform can contain Infrastructure.

The Teams page shows the whole tree indented, with each team's lead and member count. Create a team, pick its parent, pick its lead, manage its roster. That is the entire surface.

Teams carry through the whole product. The org chart draws them as boxes. Profiles list them. Search results show a person's team next to their title. And a team works everywhere a set of people works: share a note with it, invite it to a meeting.

### Lead and manager are different things

A **lead** belongs to the team. A **manager** belongs to a person, and you set it on the Members page, in the member's profile editor.

Managers draw the solid reporting lines on the org chart. The lead steps in only as a fallback: when a person has no manager on record, the chart draws a dashed line to their team's lead. Set managers for the people whose reporting line matters, and let the lead fallback carry the rest.

## Groups

An **access group** is a named sharing list. Release Approvers. Incident Response. Security Council. You create it once, and anyone can share content with it instead of adding five people by hand. Membership changes propagate: join the group, inherit its access, leave it, lose it.

A group can be **private**. A private group is invisible to regular members. It does not appear in their pickers, and its roster is not browsable. Its grants still work. Use it when the list itself is sensitive, like a compensation review circle.

When the set of people you are about to create is really an organizational unit, do not make a group. Make a team. You get the same sharing powers plus the chart, the profiles, and the search metadata.

## One name per organization

Teams and groups draw from one pool of names, unique per organization regardless of case. If a team called Engineering exists, you cannot create a group called engineering.

This is deliberate. Both appear in the same pickers across the product. Two entries with the same name and different meanings is how the wrong twenty people get invited to a meeting. When a name is taken, the form tells you and you pick another.

## When a directory runs the show

If your organization syncs people from an identity source, some data stops being yours to edit. Synced profile fields show a lock that says so, and a synced team's name and kind reject edits the same way. The next sync would revert your change anyway, so Uniffy refuses it up front instead of silently losing it.

The Directory page also holds the two People page switches. You can turn the org chart off for the whole organization if you do not want one.

## The short version

Structure goes in teams. Sharing lists go in groups. Reporting lines go on members. If you keep those three sentences straight, the four pages never fight you.
