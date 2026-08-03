---
title: Incident Response Runbook
slug: uniffy-incident-response-runbook
folder: Engineering Operations
tags:
  - engineering
  - compliance
---

# Incident Response Runbook

Controlled document. Owner: SRE lead with the QA lead. Everyone can raise an incident;
nobody needs permission from a manager to do it.

## What to report

- Any customer-visible outage or degradation, however brief.
- Data incidents, including ones caught before any data left the tenant.
- Wrong org, wrong tenant, wrong recipient: content delivered where it did not belong.
- Delayed or lost customer data, including delays caused by backups or queues.
- Dependency or infrastructure failures with production consequence.
- Abuse or threats towards staff on support channels.

Near misses count. A near miss is a free lesson; a pattern of unreported near misses is
how a serious outage gets built.

## How to report

Report the same day, in the workspace, using
[the incident report template](file:Engineering/incident-report-template.md). Post the
report in #infra-ops, or in #security for suspected data incidents. Include what
happened, when, who was involved, what the immediate consequence was, and what was done
straight away. Facts only in the report; interpretation goes in the review.

Do not paste customer content into the report. Reference the org id instead, as
required by [Customer Data Protection Policy](customer-data-protection-policy.md).

## What happens next

| Severity | Response |
| --- | --- |
| SEV4, no customer impact | Logged, reviewed monthly |
| SEV3, near miss | Reviewed within 5 working days |
| SEV2, degraded and recovered | Review within 48 hours, affected customers informed |
| SEV1, outage or data incident | Immediate escalation to on-call and management |

Data incidents are notified to the Commission for Personal Data Protection within 72
hours where the regulation requires it, and to affected customers per contract. The DPO
is involved whenever personal data was part of the failure. The written review is
presented at the next [Security review board](event:Security review board).

## Being open with customers

Customers affected by an incident are told, on the status page and by mail, what
happened and what we are changing. We apologise plainly. An apology is not an admission
of liability, and withholding one is both unkind and bad practice.

## Just culture

Reviews look for the conditions that made the failure likely: alert fatigue, interface
design, deploy timing, ambiguous runbooks. Individuals are named only where there is
wilful misconduct. This is the promise that keeps reports coming in, and it is stated in
[Mission and Values](mission-and-values.md).
