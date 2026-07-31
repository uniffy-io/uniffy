---
title: Information Security Policy
slug: vitalis-information-security-policy
folder: Handbook/Policies
tags:
  - policy
  - compliance
---

# Information Security Policy

Applies to everyone with a Vitalis account, including contractors and locum clinicians.
Owner: Head of IT. Reviewed every 12 months, last review March 2026.

## Accounts and access

- Access is granted by role, requested by the line manager, approved by the system owner.
- Multi-factor authentication is mandatory on every system holding patient data.
- Shared logins are forbidden. A shared login makes an audit trail worthless, which is a
  regulatory problem before it is an IT one.
- Access is reviewed quarterly. Leavers are disabled the same day, per
  [Systems and Access](systems-and-access.md).

## Devices

Clinic workstations are managed, encrypted and auto-lock after 5 minutes. Personal
devices may access email and the workspace, never the clinical record system. Lost or
stolen devices are reported to IT within one hour, at any time of day.

Nothing clinical is stored on local disks. If a file has to leave a system, it leaves
through the workspace, not through a USB stick.

## Passwords and secrets

Password managers are provided and mandatory. API keys and service credentials live in
the secret store, never in notes, chat or code. A secret pasted into chat is treated as
compromised and rotated, no exceptions and no embarrassment.

## Email and phishing

We are targeted mostly through fake NHIF and supplier invoices. Report anything
suspicious with the Report Phish button; the security team answers every report, even
the false alarms.

## Incidents

Suspected breach, ransomware, or unauthorised access to patient data: call the IT
on-call number immediately, then write it up. A data breach has a 72-hour regulatory
clock attached to it, so speed matters more than certainty. The patient-facing side of
that duty is in [Patient Data Protection Policy](patient-data-protection-policy.md).

## Consequences

Deliberate circumvention of these controls is a disciplinary matter. Honest mistakes
reported quickly are not.
