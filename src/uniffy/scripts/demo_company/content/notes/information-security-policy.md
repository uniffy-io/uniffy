---
title: Information Security Policy
slug: uniffy-information-security-policy
folder: Handbook/Policies
tags:
  - policy
  - compliance
---

# Information Security Policy

Applies to everyone with a Uniffy account, including contractors. Owner: SRE lead.
Reviewed every 12 months, last review March 2026.

## Accounts and access

- Access is granted by role, requested by the line manager, approved by the system owner.
- Multi-factor authentication is mandatory on every system, production above all.
- Shared logins are forbidden. A shared login makes an audit trail worthless, which is a
  contractual problem before it is an IT one.
- Access is reviewed quarterly. Leavers are disabled the same day, per
  [Systems and Access](systems-and-access.md).

## Devices

Company laptops are managed, encrypted and auto-lock after 5 minutes. Personal devices
may access email and the workspace, never production. Lost or stolen devices are
reported in #it-support within one hour, at any time of day.

Nothing from production is stored on local disks. If data has to leave a system, it
leaves through the workspace, not through a USB stick.

## Passwords and secrets

Password managers are provided and mandatory. API keys and service credentials live in
the secret store, never in notes, chat or code. A secret pasted into chat is treated as
compromised and rotated, no exceptions and no embarrassment.

## Email and phishing

We are targeted mostly through fake supplier invoices and fake cloud-provider billing
alerts. Report anything suspicious with the Report Phish button; the security team
answers every report, even the false alarms.

## Incidents

Suspected breach, ransomware, or unauthorised access to customer data: call the on-call
number immediately, then write it up per
[Incident Response Runbook](incident-response-runbook.md). A data breach has a 72-hour
regulatory clock attached to it, so speed matters more than certainty. The
customer-facing side of that duty is in
[Customer Data Protection Policy](customer-data-protection-policy.md).

## Consequences

Deliberate circumvention of these controls is a disciplinary matter. Honest mistakes
reported quickly are not.
