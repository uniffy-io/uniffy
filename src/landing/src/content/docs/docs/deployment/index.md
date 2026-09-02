---
title: Deployment Guide
description: Install, configure, upgrade, and back up a self hosted Uniffy on Kubernetes or on a single VM with k3s.
sidebar:
  label: Overview
  order: 0
---

Uniffy self hosted runs on Kubernetes. There are two supported paths, and both end in the same product our cloud runs.

**The VM path.** One machine, one command. The installer brings [k3s](https://k3s.io), every component, and Uniffy itself, makes the opinionated choices for you, and prints your admin password at the end. Start at [Install on a VM](/docs/deployment/install-k3s/).

**The cluster path.** You already run Kubernetes and a platform team. You install a Helm chart, bring your own object storage, and decide a short list of things like where Postgres lives. Start at [Install on Kubernetes](/docs/deployment/install-kubernetes/).

## What we support

Every release ships a **pinset**: the chart version, the image digests, and the component versions we tested together. Install from the pinset and you are running a combination that passed our release checks. Assemble your own combination and you are your own test lab.

The edge that fronts Uniffy has a strict contract. It must speak HTTP/2 in cleartext to the backend, pass websockets untouched, and carry streams that never time out and never buffer. We ship and test that contract as Envoy Gateway resources, and calls media relays through STUNner. Other Gateway API implementations may meet the contract on paper. We do not test them and we do not support them. If calls are off, STUNner is optional; Envoy Gateway is not.

## Fully isolated deployments

Uniffy never calls home, fetches nothing from third party CDNs at runtime, and keeps telemetry off by default. A deployment that is fully isolated from the internet is a supported configuration, not a special case. The VM installer takes an offline bundle, and the cluster path ships a mirror script for your private registry.

## What is here

- [Install on a VM](/docs/deployment/install-k3s/): one command on a fresh Ubuntu machine.
- [Install on Kubernetes](/docs/deployment/install-kubernetes/): the Helm chart on your cluster.
- [Upgrades](/docs/deployment/upgrades/): pinsets, forward only migrations, and the honest rollback story.
- [Backups and Restore](/docs/deployment/backups/): continuous Postgres backups to S3, point in time recovery, the master key ritual.
- [Configure Uniffy](/docs/deployment/configure/): every environment variable.
- [System Architecture](/docs/deployment/system-architecture/): services, data stores, scaling, and ports.
- [Admins and Operators](/docs/deployment/admins-and-operators/): the two admin jobs, the wall between them, one account or two.
- [Harden the Edge](/docs/deployment/hardening/): lock the operator API to your private network.
- [Behind an Edge](/docs/deployment/edges/): Cloudflare, CDNs, and corporate load balancers in front of Uniffy.
- [Account Recovery](/docs/deployment/recovery/): the break glass command for a locked out admin.
- [Licensing](/docs/deployment/licensing/): what open source means here.

When you evaluate Uniffy against anything else, ask the other vendor one question. If I run this on my own hardware, fully isolated, do I get the same product you sell in your cloud? Our answer is yes, and these pages are the proof.
