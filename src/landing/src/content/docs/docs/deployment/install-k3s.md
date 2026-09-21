---
title: Install on a VM
description: Run Uniffy on a single virtual machine with one command. The installer brings k3s, the traffic plane, the data stores, and Uniffy itself, with every choice already made.
sidebar:
  label: Install on a VM
  order: 1
---

One virtual machine, one command, a running Uniffy. This page is for a team that wants the product, not a Kubernetes project. The installer makes every infrastructure choice for you. If you want to make those choices yourself, you want [Install on Kubernetes](/docs/deployment/install-kubernetes/) instead.

## What you need

- A fresh VM running Ubuntu 22.04 or newer. Start with 4 vCPU, 8 GB RAM and 60 GB of SSD storage. Use the [machine sizing guide](#choose-a-machine) below before buying capacity for your team.
- A DNS A record pointing your hostname at the VM, for example `uniffy.example.com`.
- Inbound ports open: 80 and 443 over TCP, 3478 over UDP and TCP.
- Optional: SMTP credentials. Without them Uniffy runs, but invites and password resets stay off until you add a mail server in the admin pages.
- Optional: a TLS certificate you own. Without one the installer gets a free certificate from Let's Encrypt.

Port 3478 carries calls media. Everything else works without it, and calls quietly do not, which is why the installer probes it and tells you.

## Choose a machine

Size your VM for the work your team does during busy hours. Notes, tasks and messages need less capacity than overlapping video conversions, large imports and calls. Use team size to choose a starting point, then adjust for your workload.

These are starting budgets for total team size. We have not load tested these user counts. They assume daily notes, tasks, chat and documents, occasional video uploads, small calls and an external AI provider. They do not promise that every member can run heavy work at once.

| Team size | vCPU | RAM |
|---|---|---|
| 1 to 20 people | 4 | 8 GB |
| 21 to 100 people | 8 | 16 GB |
| 101 to 200 people | 8 to 16 | 16 to 32 GB |

Use the lower end of each budget for lighter workloads. Allow more CPU and RAM when uploads, indexing and calls overlap often, even with a small team. Measure your busiest hours before relying on a size.

These budgets cover the whole host: Uniffy, its workers, data stores, calls service, k3s and the operating system. Use SSD storage. [K3s also recommends SSDs](https://docs.k3s.io/installation/requirements#disks) because database performance matters. A local AI model needs its own CPU, RAM or GPU budget.

### Leave room for video and calls

Start with one media worker. The [media configuration example](/docs/deployment/configure/#media-scratch-on-kubernetes) allows four jobs and two video conversions at once per worker. Video conversions share those four job slots with document processing and thumbnails. Long recordings can queue without needing a larger machine for every team member.

Keep CPU and memory available for the rest of the stack while conversions run. Add a second media worker when conversion wait times become a problem and the host has spare capacity. Each worker needs its own CPU, memory and scratch budget. Adding a replica on a saturated host does not add capacity.

Size calls separately if large meetings are routine. Simultaneous cameras, screen shares and subscribers drive CPU and network demand. [LiveKit's benchmarking guide](https://docs.livekit.io/transport/self-hosting/benchmark/) explains those factors. Team size alone cannot tell you whether the VM's network connection is enough.

### Size disk for your files

The 60 GB starting disk is for a small installation. Grow it with stored files and retained versions. Allow space for playback copies, PostgreSQL, search indexes, container images and logs too.

Within your disk budget, keep 16 GiB free per media worker for temporary work, separate from stored files. That space can live on the same SSD. Originals stay in object storage while conversions write their outputs to scratch. Scratch disappears when the pod is replaced; your stored files must persist. Keep backups off the VM.

### Know when to grow

Watch response times, CPU saturation, memory pressure, disk space, disk latency and how long jobs wait. Resize when those signals show pressure. A large file collection can need more RAM and disk even with a small team. These sizes are planning guidance; the installer does not select a profile from your member count.

## The command

```bash
curl -fsSLO https://github.com/uniffy-io/uniffy/releases/latest/download/uniffy-k3s.sh
sudo bash uniffy-k3s.sh install \
  --hostname uniffy.example.com \
  --acme-email admin@example.com
```

With an owned certificate, replace the ACME flag:

```bash
sudo bash uniffy-k3s.sh install \
  --hostname uniffy.example.com \
  --tls-cert ./fullchain.pem --tls-key ./private.key
```

The certificate file must be the full chain, the leaf and the intermediates concatenated. A leaf only file works in one browser and fails on phones and corporate networks, and that failure looks like a Uniffy bug when it is a certificate file bug.

## What the installer does

1. Checks the machine: CPU, memory, disk, DNS resolution of your hostname, and that ports 80, 443, and 3478 are free. It refuses early rather than failing late.
2. Installs k3s with its bundled ingress disabled. Envoy Gateway takes that place.
3. Installs the pinned platform components: Envoy Gateway, the STUNner operator, and CloudNativePG. cert-manager is installed only in ACME mode.
4. Generates every secret Uniffy needs and stores them in the cluster. Nothing is written to disk in plain text except the backup it tells you to make.
5. Installs the Uniffy chart from the release pinset: Postgres, Valkey, Meilisearch, object storage, LiveKit, the backend, the workers, and the frontend, one replica each.
6. Waits for everything to become healthy, probes TURN on port 3478, and prints the result.

The final output is your URL, your admin login, and one warning worth reading twice: back up the master key. The `APP_MASTER_KEY` encrypts every secret your organization stores in Uniffy. Lose the key and that data is gone. The installer prints the exact backup command; run it and put the copy somewhere that is not this VM.

The command is safe to re-run. Every step detects work already done and skips it, so a failed run is fixed by fixing the cause and running the same command again. Failed at the certificate step? That is almost always DNS not propagated yet. Wait, re-run.

## After the install

Sign in with the printed admin credentials and change the password. Then work through the admin pages: mail server, organization defaults, and your first members. The [Administration Guide](/docs/administration/) covers each page.

Two operational habits from day one:

- The master key backup from the install output, stored off the machine.
- Continuous Postgres backups to an S3 bucket that is not on this VM. Four lines in `/etc/uniffy/values.yaml` turn them on; [Backups and Restore](/docs/deployment/backups/) has them. The local dumps the upgrade command takes are for walking back a bad upgrade, not for surviving a dead machine.

## Renewing an owned certificate

Public certificate authorities cap validity at about 13 months, so a purchased certificate is a yearly ritual. Ten year certificates exist only from a private CA. Either way, renewal is one command with the new files:

```bash
sudo bash uniffy-k3s.sh tls-update --tls-cert ./new-fullchain.pem --tls-key ./private.key
```

The installer and the upgrade command both warn when the current certificate expires within 30 days. ACME mode renews itself and none of this applies.

## Calls and the firewall

Media between call participants relays through the STUNner gateway on port 3478, on the same hostname and IP as the app. If the app works but calls connect with no audio or video, the answer is almost always 3478 over UDP blocked somewhere between the participant and the VM. The install output includes the probe command so you can check from any network.

## Upgrading

```bash
sudo uniffy-k3s upgrade
```

One command, a Postgres dump first, about a minute of downtime while the backend restarts. The full story, including what rollback really means, is on the [Upgrades](/docs/deployment/upgrades/) page.

A single VM keeps operations small, but a host failure takes the whole service down. Move to the [cluster path](/docs/deployment/install-kubernetes/) when you need services on separate machines or availability through a host failure. Plan redundant data stores and backups too.
