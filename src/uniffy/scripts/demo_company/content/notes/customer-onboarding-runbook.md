---
title: Customer Onboarding Runbook
slug: uniffy-customer-onboarding-runbook
folder: Engineering Operations
tags:
  - engineering
  - onboarding
---

# Customer Onboarding Runbook

Controlled document. Owner: Support lead. Changes require sign-off from the SRE lead
and the support lead, per [How We Work](how-we-work.md).

## Scope

Every new customer org on cloud.uniffy.io and every self-hosted licence activation,
inbound or sales-led.

## Steps

1. **Verify the signup.** Org name, admin contact, billing domain. Two details must
   match the order before anything is provisioned.
2. **Check the plan.** Trial, paid tier, or self-hosted licence. Billing state is never
   a reason to delay the first response; it is settled after.
3. **Data processing agreement.** The admin receives the DPA and the privacy notice.
   What we process, where, and as what role is explained in plain language, see
   [Customer Data Protection Policy](customer-data-protection-policy.md).
4. **Provision the workspace.** Org created, region confirmed, defaults applied, admin
   invite sent. Recorded in the desk ticket, never in a private note first.
5. **Discovery.** Team size, migration source, SSO requirement, self-hosted
   constraints. Entered as structured fields, not free text; a free-text requirement is
   invisible to the success check-in.
6. **Triage.** Red flags escalate immediately to the on-duty engineer: failed SSO on an
   org above 50 seats, a migration over 100 GB, an air-gapped deployment, a signup from
   an existing customer's domain. Escalation does not wait for the paperwork.
7. **Hand over.** Ticket owner and the date of the first success check-in told to the
   customer before the call ends.

## Documentation

First-response and uptime targets are in
[service-slo-reference.csv](file:Engineering/service-slo-reference.csv). Every field in
the desk is attributable; nobody works a ticket under another person's login.
Escalations and rota questions are raised at the [Daily standup](event:Daily standup)
the next morning.

## Common failure modes

- Two orgs with near-identical names. Always confirm the billing domain aloud.
- A requirement captured in free-text notes and missed at the success check-in.
- SSO discovered on day 30 instead of day one. Ask at signup, not at rollout.
- A reseller answering for the customer's admin. Address the admin.

## Related

Incidents surfaced during onboarding are reported per
[Incident Response Runbook](incident-response-runbook.md).
