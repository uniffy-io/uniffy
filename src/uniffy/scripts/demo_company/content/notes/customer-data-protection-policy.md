---
title: Customer Data Protection Policy
slug: uniffy-customer-data-protection-policy
folder: Handbook/Policies
tags:
  - policy
  - compliance
---

# Customer Data Protection Policy

Owner: Data Protection Officer. Applies to every processing of personal data at Uniffy,
on cloud.uniffy.io, in the office systems, and in what we hold about self-hosted
customers.

## Our roles

- **Processor** for customer workspace content on cloud.uniffy.io: notes, files,
  messages, recordings. The customer is the controller; we act only on documented
  instructions under the data processing agreement.
- **Controller** for staff data, billing records and support tickets.
- Self-hosted deployments hold their own workspace content entirely; we keep only the
  licence and billing records.

Telemetry is opt-in and off by default. Consent is never bundled into the contract. A
customer who declines telemetry gets exactly the same product.

## What we collect

Only what the contract requires. Nice-to-have fields are the enemy: every extra field
is a retention obligation and a breach surface. New fields in the billing or desk
systems need DPO sign-off before they ship.

The processing register is maintained in
[data-processing-register.csv](file:Compliance/data-processing-register.csv) and
reviewed twice a year. Staff refresh their obligations at the
[GDPR and customer data refresher](event:GDPR and customer data refresher).

## Access to customer content

No customer content in chat, screenshots or tickets, ever. Support access to a
customer workspace goes only through a support session the customer approves:
time-bound, audit-logged, visible to the org owner live and revocable at any moment.
There is no admin path around this.

## Retention

| Data | Retention |
| --- | --- |
| Customer workspace content | Life of the contract, deleted 30 days after termination |
| Backups | 30 days, rolling |
| Support tickets | 3 years after closure |
| Billing and tax records | 10 years, tax requirement |
| Customer call recordings | Not retained; only the ticket note survives |
| Production logs | 90 days, free of workspace content |

Deletion is a scheduled job, not a favour. Ad hoc deletion requests go through the DPO.

## Data subject rights

Access, rectification, restriction, portability and objection requests arrive at
dpo@uniffy.io and are answered within 30 days. Identity is verified before anything is
released; the most common attack we see is a former employee of a customer requesting
records they have no right to.

Requests about workspace content are redirected to the customer's own admin, because
the customer is the controller there. Where we must refuse, for example erasing billing
records under retention law, the refusal is explained in writing, in plain language,
per [Voice and Tone](voice-and-tone.md).

## Sharing

Data leaves Uniffy only to: the customer's own admins, the data subject, and
subprocessors under a signed data processing agreement. Every subprocessor is listed in
the register with its location and safeguards. No customer data goes to a system
outside the EU without a documented transfer mechanism.

## Breach

Any suspected breach goes to the DPO and the SRE lead immediately. Notification to the
Commission for Personal Data Protection is due within 72 hours of becoming aware; as a
processor we notify affected controllers without undue delay. The technical response is
in [Information Security Policy](information-security-policy.md).
