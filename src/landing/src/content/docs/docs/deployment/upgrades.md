---
title: Upgrades
description: How Uniffy upgrades work on both install paths. Pinsets, forward only migrations, automatic dumps before every upgrade, and what rollback honestly means.
sidebar:
  label: Upgrades
  order: 3
---

Use this procedure to move a self hosted deployment to a new release with a verified backup and matching application images.

## The pinset

Every release ships a **pinset**: the chart version, the image digests, and the platform component versions we tested together. Upgrading means moving from one pinset to the next. The upgrade tooling never resolves `latest` for anything; it applies the pinset or it does nothing. The pinset and every image in it are signed, and [Verify a Release](/docs/deployment/verify/) shows how to check them before an upgrade touches your cluster.

The application images are `uniffy`, `uniffy-media-worker`, and `uniffy-frontend`, all under `ghcr.io/uniffy-io`. Core and egress use the `uniffy` image. Keep all three images on the same release, including any media Deployment managed outside Helm.

Two rules ride on that:

- Upgrades are forward only. Running older pods does not reverse database migrations. Restore the database to roll back a release.
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
kubectl -n uniffy rollout status deploy/uniffy-worker-core
kubectl -n uniffy rollout status deploy/uniffy-worker-egress
kubectl -n uniffy rollout status deploy/uniffy-worker-media
curl -f https://uniffy.example.com/healthz
helm test uniffy -n uniffy
```

The first new backend pod runs the migrations on boot; the rest join once it is healthy. We do not promise zero downtime upgrades today, and we would rather say so than sell you a rolling upgrade that gambles on old pods tolerating a new schema. If the window matters to you, upgrades are fast: the window is the backend restart plus the migration time, minutes not hours.

Use the Deployment names from your rendered manifests if they differ. Update any separately managed media Deployment to the verified media image before checking its rollout. Let backend migrations finish before workers consume jobs against the new schema.

Mirror the new pinset first with `mirror.sh` if you run a private registry. Platform components move less often; when a pinset bumps one, the release notes say so and the same pinned `helm upgrade` commands from the install page apply.

### Live editing durability upgrade

Use a maintenance window for this upgrade. Old and new realtime backends and workers must never overlap.

1. Pause editing and new realtime connections at ingress. Ask users to finish edits and close editing sessions while old backends and workers still run.
2. Allow at least 30 seconds for backend debounce work to flush. Confirm queued and running realtime snapshot jobs have finished. An empty queue alone is insufficient while backends still hold pending edits.
3. Stop every old backend and worker. Keep the maintenance gate closed.
4. Apply migrations through 110. Start matching worker fleets and backends. Keep worker-core running for projection recovery.
5. Deploy matching web and mobile clients. Reload open tabs before reopening editing traffic.
6. Edit a note, task and event. Confirm saved content after reopening each item.

Old snapshot jobs carry document bytes. New workers recover from committed PostgreSQL snapshots instead. Mixing versions can lose edits or overwrite newer state. The rolling commands above require this quiesce and full stop when crossing this protocol change.

Migration 110 uses LZ4 for newly written realtime snapshots when PostgreSQL supports it. Existing bytes are unchanged. Builds without LZ4 retain their current compression. It also replaces two recovery indexes with one index matching the recovery scan.

Mobile clients need a native rebuild with `expo-crypto` and `expo-sqlite`. Draft payloads use encrypted SQLite records with a SecureStore key that stays on the device. Existing SecureStore drafts stay readable and move into SQLite when saved in the same generation. Unreadable records remain retained.

Older mobile builds cannot read SQLite drafts. Sync pending edits before replacing the app with an older build.

### Moving media work off core

When upgrading from a release that processes media on core workers, pause new uploads and recordings. Let queued and running core media jobs finish before stopping those workers. This prevents job names from being handed to a fleet that no longer registers them.

Apply the release migrations, then start core, egress, and media at matching versions. Give the media worker the shared configuration and Secrets, plus [disk scratch and resource limits](/docs/deployment/configure/#media-scratch-on-kubernetes). Keep uploads paused until all fleets are ready.

Pending durable video work is recovered from PostgreSQL onto the media queue. Recovery runs every five minutes, but processing claims must expire before abandoned work can restart. A new pod does not resume a partial encode from its predecessor's scratch files.

Before ending the maintenance window, upload a video that needs conversion. Confirm playback, seeking, and original download. Check thumbnail and document extraction jobs too, since they share the media fleet.

## What rollback really means

`helm rollback` restores the old pods, not the old database. After migrations have run, old code against a new schema is an unsupported state that can corrupt data quietly, which is worse than downtime. So:

- First choice: fix forward. Patch releases exist for exactly this, and shipping one is fast.
- Real rollback: restore. Roll the chart back and restore the pre upgrade dump. That is why the dump is automatic and why the upgrade output prints the restore command next to it.

This is also why the tooling refuses downgrades: it will not offer a button that leads to the unsupported state.

## Finding out about releases

Uniffy never calls home, so nothing in your deployment checks for updates on its own. The running version is visible on the platform pages, and releases are announced on the GitHub releases feed, which works fine in a feed reader. If you want a check anyway, there is an opt in setting that fetches a static version file over plain HTTPS and nothing else. It is off by default and stays off.

Upgrade on your schedule with a verified dump in hand. A healthy backend alone is not enough: every worker fleet must be running the same release and processing its jobs.
