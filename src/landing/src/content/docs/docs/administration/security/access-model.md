---
title: Access and privacy
description: What an admin can and cannot see. You run the organization. You are not a key to your members' private content.
sidebar:
  order: 1
---

As an admin you run the organization. You are not a master key to everything inside it.

Being an owner or admin gives you broad control over the org. You invite and remove people, set their roles, build groups, decide what new content defaults to, and configure the workspace. The admin pages are where all of that lives.

What it does not give you is a way into your members' private content. An admin role is not a key to every note and file. This is deliberate, and it is worth saying plainly.

## What you cannot see

If a member keeps something to themselves, you cannot open it. It does not appear in your sidebar. It does not show up in your search. Promoting yourself, or anyone else, to admin changes none of that.

Three quick cases.

A member writes a private note about their own performance review. You are the org owner. You still cannot read it. It is theirs.

A member shares a project with you as an editor. Now you can see it. Not because you are an admin, but because they shared it with you.

Someone leaves the company. The notes they kept private stay private. Removing them from the org does not hand you their content.

## What you do control

You set the starting point for new content through [default permissions](/docs/administration/security/default-permissions/). If your organization wants new notes to open to everyone by default, you set that. If you want everything to start locked down, you set that instead. Members can still change the setting on their own items.

You decide who is in the org and what role they hold on the [Members](/docs/administration/access/members/) page. You bundle people into [groups](/docs/administration/access/groups/) so that granting access stays simple.

## Narrower admins

You can give someone power over one area without making them a full admin. A **domain admin** runs a single feature, like files or calendar. This is still not a window into private content. A files domain admin does not get to read everyone's private files.

## Chat is the one exception

There is a single place where moderation reaches across content, and that is chat. Channels are shared spaces, not personal documents. So org admins and chat domain admins can moderate across channels.

A private note and a chat channel are not the same kind of thing. We treat them differently on purpose.

## On cloud, neither can we

The same line holds for us. If you run on cloud, being a platform operator on our side does not let us into your organization's content. The only way we see anything is a **support session** that you approve, scope, and revoke. The [principles page](/docs/principles/) covers how that works. On self hosted, there is no us to ask.

## When you think you need access

Sometimes you will genuinely need to get into something a member owns. The answer is not an override, because there is not one. Ask the owner to share it with you, or have ownership transferred to someone who should hold it. If this is about a person leaving, transfer ownership before they go.

We made the admin role powerful over the organization and powerless over private content, on purpose. If you want a tool where an admin can quietly read anyone's notes, that is a different product. It is not this one.

## See also

- [Default Permissions](/docs/administration/security/default-permissions/): what new content inherits when a member creates it.
- [Members](/docs/administration/access/members/): who is in the org and what role they hold.
- [Sharing and privacy](/docs/user/sharing/): the same model from a member's point of view.
- [Principles](/docs/principles/): why we cannot see your workspace on cloud.
