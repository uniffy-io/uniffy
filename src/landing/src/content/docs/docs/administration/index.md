---
title: Administration Guide
description: Manage an organization on Uniffy. Members, permissions, encryption, audit, email, agents, rooms, storage.
sidebar:
  label: Overview
  order: 0
---

This guide is for org owners and administrators. It covers everything inside `/admin/*` — one tenant, your tenant.

For cross-tenant operations (managing multiple orgs from a single deployment), see the Platform Guide.

## How the admin panel is organized

The `/admin` sidebar groups pages by intent. The docs follow the same grouping so a page in the app maps directly to its doc page.

| Group | Pages | What it covers |
|-------|-------|----------------|
| Access | Members, Groups, Domain Admins | Who is in the org and what role they hold |
| Security | Default Permissions, Authentication, Encryption, Audit Log | How access is granted, proven, encrypted, and recorded |
| Workspace | Agents, Rooms, Storage, Email | Org-scoped infrastructure and integrations |

## Who can use the admin panel

Any user whose org role is `OWNER` or `ADMIN`. The route gate (`AdminRoute`) redirects everyone else to the app home.

A few pages have finer gates inside them — for example, only `OWNER` can transfer ownership, and `Domain Admins` can self-manage their own domain from this panel without holding `ADMIN` on the whole org.

## Audit, everywhere

Every mutation made from `/admin/*` writes an audit row. The Audit Log page is the source of truth for what changed, by whom, and when. When in doubt about whether an action was performed, check the log first.
