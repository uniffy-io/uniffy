---
title: Admins and Operators
description: The two admin jobs in a Uniffy deployment. What an org admin runs, what the platform operator runs, the wall between them, and whether to hold both roles in one account.
sidebar:
  label: Admins and Operators
  order: 8
---

Uniffy has two different admin jobs, and running your own deployment means you probably hold both. This page says what each job is, where the wall between them stands, and how to set up your own accounts so the wall protects you too.

## The org admin

An org admin runs one organization: members and their roles, teams and groups, workspace defaults, the audit log, mail settings, agents. Every organization has one **owner** and any number of admins, and the whole surface lives in the admin pages.

What the role does not carry is access to member content. An admin is not a master key: a member's private note stays private, does not appear in the admin's search, and promoting yourself changes nothing. The [Administration Guide](/docs/administration/) covers the job in full, and [Access and privacy](/docs/administration/security/access-model/) covers that boundary, because it surprises people coming from other tools.

On the hosted cloud, this is the only admin job a customer ever holds.

## The platform operator

The platform operator runs the deployment itself, across every organization on it: creating and suspending organizations, the cross tenant user directory, system mail, system configuration, deployment encryption, the platform audit feed, and operator two factor resets. It is a flag on a user account, the platform pages are its surface, and two factor authentication is required for it by default.

Its entire API lives under one path prefix, which is what makes [Harden the Edge](/docs/deployment/hardening/) a one value job: lock that prefix to your private network and the operator surface is off the internet.

On the hosted cloud, we hold this role. On your deployment, you do.

## The wall between them

The platform operator has no access to tenant content. Not to notes, not to files, not to chat. The only path in is a **support session**: the operator requests access to one organization, the org owner approves it, it is time bound, every action under it is audit logged, and the owner can watch it live and revoke it.

This is not a cloud courtesy that self hosted skips. It is the same code, and it is worth honoring on your own deployment for the same reasons: a compromised operator account is an infrastructure breach but not a content breach, a curious admin leaves a trail instead of a silence, and when someone asks "who can read our documents", the answer is a short list that does not include "whoever runs the servers".

## One account or two

The bootstrap settings decide this. Leave `INITIAL_PLATFORM_ADMIN_EMAIL` unset and the first admin is one combined account: org owner and platform operator in one login. Set it to a distinct address and the two jobs start as two accounts.

Three deployments, three right answers.

A founder self hosting for their own small team starts combined. One human, one login, both hats. The wall still works: even as the operator, reading another member's private content takes a support session that the org owner, also them, approves and that lands in the audit log.

A company where IT runs the deployment splits from day one. The operator account belongs to infrastructure, sits behind the VPN with the operator API, has two factor enrolled, and is not used for daily work. The org owner account belongs to whoever runs the workspace.

A cloud tenant does none of this. They hold an org role, we hold the operator role, and the only place the two meet is a support session request waiting for their approval.

If you started combined and the deployment grew, split late rather than never: create the operator account, grant the flag from the platform pages, and demote the daily account to org owner only.

The question this page answers is the one your security review will ask: who can do what to whom, and what stops them. Two roles, one wall, and a support session as the only gate through it.
