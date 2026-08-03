---
title: Support Escalation Runbook
slug: uniffy-support-escalation-runbook
folder: Engineering Operations
tags:
  - engineering
---

# Support Escalation Runbook

Controlled document. Owner: Support lead. Covers every ticket and customer call handled
by the desk, in Sofia, in Plovdiv and remote.

## Before the call

- Confirm the environment meets [Remote Work Policy](remote-work-policy.md): private
  room, headset, stable connection. In the office, use
  [Call Booth 1](room:Call Booth 1) or [Call Booth 2](room:Call Booth 2).
- Review the ticket: last contact, plan, open escalations, any active incident.
- Confirm you are speaking with a workspace admin before changing anything on an org.
- Never ask for a password or a screen share of workspace content. Access goes through
  an audited support session the customer approves and can revoke, per
  [Customer Data Protection Policy](customer-data-protection-policy.md).

## During

State that the call is not recorded and that a ticket note will be written. First
response targets are four working hours on paid plans and one business day on trials;
say the target out loud when you promise a follow-up.

Get the org id at the start. If the issue widens mid-call you need to know exactly
which tenant you are looking at.

## What the desk cannot do

Escalate to the on-call engineer for: data loss or suspected corruption, any security
report, anything needing a production log or database query to answer, an outage
touching more than one org, and any billing dispute above one invoice. Suspected
incidents follow [Incident Response Runbook](incident-response-runbook.md). When in
doubt, escalate.

## After

- Ticket note written in the same session, before the next ticket.
- Workarounds are written in plain language, per [Voice and Tone](voice-and-tone.md).
- Anything promised to the customer gets a task with an owner and a date.
- Follow-up booked before the call ends when one is needed. "Write back if it happens
  again" is not a follow-up plan on its own.

## Technical failure

If the call drops twice, switch to a phone call and note it. If the question needs a
screen, rebook rather than guess. Repeated call-quality failures are logged in
#dogfood the same day; a pattern of failures is a product problem, not a desk
annoyance.
