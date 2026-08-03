---
title: Release and Deploy Runbook
slug: uniffy-release-and-deploy-runbook
folder: Engineering Operations
tags:
  - engineering
  - infra
---

# Release and Deploy Runbook

Controlled document. Owner: SRE lead. Releases follow the
[release quality manual](file:Engineering/release-quality-manual.pdf); deviations from
this procedure are non-conformities and are logged as such.

## Versions and artifacts

Releases are cut from main and tagged 1.42.x style at the moment of the cut, never in
advance and never by hand. An artifact is built once, signed, and promoted through the
stages unchanged. An artifact that cannot be traced to a commit is discarded and
rebuilt. A rebuild is a small inconvenience; an untraceable binary in production is not.

## Gate order

Lint, unit, integration, end-to-end, migration check. Deviating from the order wastes
runner time and lets silently broken builds through. The nightly pipeline report posts
to #infra-ops at 07:45 with test counts and flaky suites.

## Rollout stages

| Stage | Scope | Minimum bake |
| --- | --- | --- |
| Dogfood | Our own workspace, via #dogfood | 24 hours |
| Canary | 5 percent of cloud orgs | 4 hours |
| Cloud | All of cloud.uniffy.io | 48 hours |
| Self-hosted | Published installers | 7 days after cloud |

The QA pod runs the device-lab regression against each candidate build and posts
results by 11:35; a red regression stops the promotion. Plovdiv-specific logistics are
in [Plovdiv Office Guide](plovdiv-office-guide.md).

## Pre-deploy checks

A candidate is accepted against the changelog, checked for pending migrations,
default-off feature flags and rollback notes, and recorded before it reaches a stage.
Rejection reasons are recorded and shown to the authoring team the same day.

## SLOs and alerts

Availability and latency targets are maintained centrally in
[service-slo-reference.csv](file:Engineering/service-slo-reference.csv). An SLO breach
during bake rolls the stage back before anything ships further. A SEV1 page is
acknowledged by a person within 5 minutes, and the acknowledgement is logged with the
name of the person who took it. A SEV1 is never delivered only in writing.

## Quality control

Canary metrics are checked on every rollout, error budgets quarterly. A spent error
budget stops feature deploys for the affected service until resolved.
[Release review](event:Release review) looks at rollbacks, bake times and flaky suites
every Friday in [Pirin](room:Pirin). Non-conformities that reached a customer are
escalated per [Incident Response Runbook](incident-response-runbook.md).
