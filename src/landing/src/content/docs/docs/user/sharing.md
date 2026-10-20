---
title: Sharing and privacy
description: Everything you make in Uniffy is private until you share it. How sharing works, what each role can do, and who can and cannot see your work.
sidebar:
  order: 1
---

Everything you make in Uniffy is private until you decide otherwise.

When you create a note, upload a file, start a project, or build an agent, it belongs to you and only you. Nobody else can open it, find it in search, or see it in their sidebar. That stays true until you share it.

This holds all the way up. A teammate cannot see it, a team lead cannot see it, and your organization's [admin cannot see it either](/docs/administration/security/access-model/). On cloud, neither can we. We wrote down [why](/docs/principles/).

## Sharing something

Every item has a share button. Open it and you choose who gets in. There are three settings.

- **Only owner** keeps it to yourself. This is where everything starts.
- **Invited people** opens it to the exact people and groups you add, and nobody else.
- **Everyone in org** lets anyone in your organization in, at a starting role you pick.

## What people can do

When you let someone in, you give them a role. The role decides how far they can go.

- A **viewer** can read it.
- A **commenter** can read it and leave comments.
- An **editor** can change it.
- An **admin** can change it and manage who else has access.

You stay the **owner**. There is one owner per item, and the owner can do everything. If you want to hand something off for good, you can transfer ownership to someone else.

## Sharing with a team or group

You can share with a whole set of people instead of one person at a time. A [team](/docs/user/people/) is an organizational unit like Engineering. A group is a sharing list an admin made, like Release Approvers. Both show up in the picker, labeled so you can tell them apart.

Add the Design team as an editor and everyone in it can edit. Add a new person to that team next month and they inherit the same access automatically. Take them out and the access goes with them.

## Keeping one person out

Sharing runs the other way too. Say a note is open to everyone in your organization, but there is one person you want kept out. You can block that person on that note. A block always wins, even over access they would get from a group.

## Shared with me

**Shared with me** lists what other people opened to you by name, directly or through a team or group. It is a subset of what you can reach.

Notes and files that are open to everyone in your organization sit under **Organization** instead, even when the owner also invited you by name. Calendars work the other way. A calendar someone invited you to stays under Shared with me, and calendars open to the whole organization start out hidden under Organization.

Projects have no Shared with me section. A project shared with you appears under All Projects.

So when something is missing from Shared with me, check Organization before you assume nobody let you in.

## Who can let people in

Only you and anyone you gave the admin role on that item can open your work to someone else. There is no admin override and no back door.

Check whether your current tool works this way before you trust it with anything personal.
