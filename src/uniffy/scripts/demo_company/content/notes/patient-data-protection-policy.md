---
title: Patient Data Protection Policy
slug: vitalis-patient-data-protection-policy
folder: Handbook/Policies
tags:
  - policy
  - compliance
  - clinical
---

# Patient Data Protection Policy

Owner: Data Protection Officer. Applies to every processing of personal data at Vitalis
Health, in Sofia, in Plovdiv and in Vitalis Connect.

## Legal basis

Health data is a special category under GDPR Article 9. We rely on:

- **Article 9(2)(h)** for care delivery, under professional secrecy obligations.
- **Article 6(1)(c)** where Bulgarian law requires retention or reporting.
- **Explicit consent** for anything outside direct care: research, marketing, testimonials.

Consent is never bundled into the treatment contract. A patient who refuses marketing
gets exactly the same care.

## What we collect

Only what the episode of care requires. Nice-to-have fields are the enemy: every extra
field is a retention obligation and a breach surface. New fields in the clinical record
need DPO sign-off before they ship.

The processing register is maintained in
[data-processing-register.csv](file:Compliance/data-processing-register.csv) and
reviewed twice a year. Staff refresh their obligations at the
[GDPR and patient data refresher](event:GDPR and patient data refresher).

## Retention

| Data | Retention |
| --- | --- |
| Outpatient medical record | 5 years after last contact |
| Laboratory results | 5 years, longer where a specific regulation applies |
| Imaging | 10 years |
| Billing and insurance records | 10 years, tax and NHIF requirement |
| Telehealth session recordings | Not retained; only the clinical note survives |
| CCTV in the clinic | 30 days |

Deletion is a scheduled job, not a favour. Ad hoc deletion requests go through the DPO.

## Patient rights

Access, rectification, restriction, portability and objection requests arrive at
dpo@vitalis.example and are answered within 30 days. Identity is verified before
anything is released; the most common attack we see is a family member requesting
records they have no right to.

Requests to erase a clinical record are usually refused, because retention is a legal
obligation. That refusal is explained to the patient in writing, in plain language, per
[Voice and Tone](voice-and-tone.md).

## Sharing

Data leaves Vitalis only to: the treating clinician, the patient, NHIF for reimbursed
care, and processors under a signed data processing agreement. Every processor is listed
in the register with its location and safeguards. No patient data goes to a system
outside the EU without a documented transfer mechanism.

## Breach

Any suspected breach goes to the DPO and the Head of IT immediately. Notification to the
Commission for Personal Data Protection is due within 72 hours of becoming aware. The
technical response is in [Information Security Policy](information-security-policy.md).
