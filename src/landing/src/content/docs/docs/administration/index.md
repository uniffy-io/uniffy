---
title: Administration Guide
description: Manage an organization on Uniffy. Members, teams, groups, permissions, encryption, audit, email, agents, rooms, storage.
sidebar:
  label: Overview
  order: 0
---

This guide is for the people who run an organization on Uniffy. Owners and admins. It covers the admin pages, where you manage one tenant. Your tenant.

If you run a whole deployment and look after more than one organization, that is a different job. The platform pages cover it, and so does the Platform Guide.

## How the admin pages are organized

The admin pages group everything by intent. These docs follow the same grouping, so a page in the app maps straight to its page here.

| Group | Pages | What it covers |
|-------|-------|----------------|
| Access | [Members](/docs/administration/access/members/), [Teams, Groups](/docs/administration/access/teams-and-groups/), Directory, Domain Admins | Who is in the org, what role they hold, and how people are organized |
| Security | [Default Permissions](/docs/administration/security/access-model/), Authentication, Encryption, Audit Log | How access is granted, proven, encrypted, and recorded |
| Workspace | [Agents](/docs/administration/workspace/agents/), [Building agents](/docs/administration/workspace/building-agents/), Rooms, Storage, Email | Infrastructure and integrations scoped to your org |

## Who can open them

Anyone whose org role is owner or admin. Everyone else is sent back to the app home.

A few pages gate further inside. Only the owner can transfer ownership. A domain admin can manage their own area here without holding admin over the whole org.

## Everything here is logged

Every change you make from the admin pages writes an audit row. The Audit Log is the record of what changed, who changed it, and when. If you are ever unsure whether an action went through, check the log first.
