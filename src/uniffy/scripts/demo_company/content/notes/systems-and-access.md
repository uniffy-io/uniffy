---
title: Systems and Access
slug: uniffy-systems-and-access
folder: Onboarding
tags:
  - onboarding
---

# Systems and Access

Who gets what, and how it is requested. Access is role-based; nobody gets an account
"just in case".

## Core systems

| System | Purpose | Owner | Typical access |
| --- | --- | --- | --- |
| Workspace | Notes, files, chat, calendar, agents | Head of IT | Everyone |
| Code repository | Source, reviews | SRE lead | Engineering, QA read-only |
| CI and deploy | Pipelines, releases | SRE lead | Engineering |
| Production, cloud.uniffy.io | Tenant infrastructure | SRE lead | On-call engineers, audited |
| Support desk | Customer tickets | Support lead | Support, engineers read-only |
| Observability | Metrics, logs, alerts | SRE lead | Engineering, support read-only |
| Finance system | Invoicing, payroll | Finance | Finance, managers read-only |

Support access to a customer workspace is not a system grant at all: it goes through a
time-bound, audited support session the customer approves, per
[Customer Data Protection Policy](customer-data-protection-policy.md).

## Requesting access

The line manager raises the request, the system owner approves, IT provisions. Requests
name the role, not the person's curiosity. Temporary access carries an end date at the
moment it is granted.

Contractor accounts are created with an expiry equal to the contract end. They are
never extended by editing the expiry without a new approval.

## Leavers and movers

Leaving: accounts are disabled on the last working day, before the exit conversation
ends. Devices, badge and keys are returned to the office manager the same day and struck
off [the device register](file:IT/device-asset-register.csv).

Moving between roles: the old access is removed at the same time the new access is
granted. Accumulated access from three previous roles is the most common finding in our
internal audits.

## Reviews

System owners review their access lists quarterly. The review is recorded; an unreviewed
list is treated as a control failure under
[Information Security Policy](information-security-policy.md).

## Getting help

IT support is reachable in #it-support during office hours, and by the on-call number
outside them. Anything touching production availability is handled immediately, at any
hour.
