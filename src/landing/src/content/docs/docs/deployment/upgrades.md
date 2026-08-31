---
title: Upgrades
description: How Uniffy upgrades work on both install paths. Pinsets, forward only migrations, automatic dumps before every upgrade, and what rollback honestly means.
sidebar:
  label: Upgrades
  order: 3
---

Upgrades are where self hosted software earns or loses trust, so this page is blunt about what happens, what we promise, and what we refuse to pretend.

## The pinset

Every release ships a **pinset**: the chart version, the image digests, and the platform component versions we tested together. Upgrading means moving from one pinset to the next. The upgrade tooling never resolves `latest` for anything; it applies the pinset or it does nothing.

Two rules ride on that:

- Upgrades are forward only. There is no downgrade path, because database migrations run forward on startup and we do not write reverse migrations.
- One major version at a time. The tooling refuses to jump majors and tells you which release to pass through.

## Before every upgrade: the dump

Both paths take a Postgres dump before touching anything, automatically. On the VM the last two dumps are kept under `/var/backups/uniffy/`, oldest deleted first. On a cluster the dump lands where your chart values point it.

The dump is not bureaucracy. It is the rollback. Read on. It is also not a backup regime: that is continuous archiving to S3, on its own page, [Backups and Restore](/docs/deployment/backups/).

## Upgrading the VM install

```bash
sudo uniffy-k3s upgrade                  # to the newest release
sudo uniffy-k3s upgrade --version 1.2.0  # to a specific one
sudo uniffy-k3s upgrade --infra          # also moves the platform components to the new pinset
```

What it does, in order: fetches and verifies the target pinset, refuses downgrades and major jumps, dumps Postgres, upgrades the chart, waits for health, and confirms the running version. Expect about a minute of downtime while the backend restarts and migrations run. That is a design choice on this path: one replica and a short pause beat the complexity that avoiding the pause costs.

Your edited settings survive. The installer keeps its values under `/etc/uniffy/` and every upgrade rereads them.

For a machine that is fully isolated from the internet, download and verify the new offline bundle on a connected machine, carry it over, and run the same command with `--bundle ./uniffy-airgap-1.2.0.tar.gz`.

## Upgrading on a cluster

Plan a short maintenance window. The procedure:

```bash
# 1. dump, even though you have backups
kubectl -n uniffy exec deploy/uniffy-backend -- pg_dump ... > pre-upgrade.dump

# 2. upgrade to the next pinset
helm upgrade uniffy oci://ghcr.io/uniffy-io/charts/uniffy \
  --version 1.2.0 -n uniffy -f values.yaml

# 3. watch the rollout, then verify
kubectl -n uniffy rollout status deploy/uniffy-backend
curl -f https://uniffy.example.com/healthz
helm test uniffy -n uniffy
```

The first new backend pod runs the migrations on boot; the rest join once it is healthy. We do not promise zero downtime upgrades today, and we would rather say so than sell you a rolling upgrade that gambles on old pods tolerating a new schema. If the window matters to you, upgrades are fast: the window is the backend restart plus the migration time, minutes not hours.

Mirror the new pinset first with `mirror.sh` if you run a private registry. Platform components move less often; when a pinset bumps one, the release notes say so and the same pinned `helm upgrade` commands from the install page apply.

## What rollback really means

`helm rollback` restores the old pods, not the old database. After migrations have run, old code against a new schema is an unsupported state that can corrupt data quietly, which is worse than downtime. So:

- First choice: fix forward. Patch releases exist for exactly this, and shipping one is fast.
- Real rollback: restore. Roll the chart back and restore the pre upgrade dump. That is why the dump is automatic and why the upgrade output prints the restore command next to it.

This is also why the tooling refuses downgrades: it will not offer a button that leads to the unsupported state.

## Finding out about releases

Uniffy never calls home, so nothing in your deployment checks for updates on its own. The running version is visible on the platform pages, and releases are announced on the GitHub releases feed, which works fine in a feed reader. If you want a check anyway, there is an opt in setting that fetches a static version file over plain HTTPS and nothing else. It is off by default and stays off.

We would rather you upgrade on your schedule with a dump in hand than have software update itself under your feet. The pinset, the automatic dump, and the refusal to downgrade are the same opinion applied three times: an upgrade should be boring, and when it is not, you should be holding everything needed to walk it back.
