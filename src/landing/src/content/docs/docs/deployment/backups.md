---
title: Backups and Restore
description: Continuous Postgres backups to S3 with point in time recovery, the master key ritual, what not to bother backing up, and the restore procedures for both install paths.
sidebar:
  label: Backups and Restore
  order: 4
---

Two things in a Uniffy deployment are irreplaceable: the Postgres database and the `APP_MASTER_KEY`. Everything on this page exists to make losing either impossible, and to make the restore a procedure instead of an improvisation.

## What needs backing up, what does not

| Store | Holds | Your job |
|---|---|---|
| PostgreSQL | Every note, message, task, permission, and setting | Back up continuously. This page. |
| `APP_MASTER_KEY` | The key wrapping every tenant secret | One copy, offline, once. Below. |
| Object storage | File bytes | Cluster path: your provider's durability. VM path: covered by the Postgres plus volume story below. |
| Meilisearch | Search index | Nothing. Rebuilt from Postgres by a background job. |
| Valkey | Queues and caches | Nothing. Queues drain, caches refill. |

A backup of Postgres without the master key restores an app where every stored credential, provider key, and identity secret is unreadable. They are one backup in two parts.

## Continuous Postgres backups to S3

Optional, and the first optional thing you should turn on. When Postgres is bundled, the chart configures CloudNativePG to archive write ahead logs to an S3 bucket continuously and take a base backup on schedule. Continuous archiving means **point in time recovery**: you can restore to any moment inside the retention window, not just to last night.

```yaml
postgres:
  backup:
    enabled: true
    endpoint: https://s3.eu-central-1.amazonaws.com
    destinationPath: s3://acme-uniffy-pg-backups/prod
    retention: 30d
    schedule: "0 30 2 * * *"    # daily base backup at 02:30, six field cron, seconds first
```

Credentials go in their own secret, not in `uniffy-secret`:

```bash
kubectl -n uniffy create secret generic uniffy-pg-backup-s3 \
  --from-literal=ACCESS_KEY_ID='...' \
  --from-literal=ACCESS_SECRET_KEY='...'
```

Use a dedicated bucket, never the file storage bucket. Different lifecycle, different credentials, and ideally a different failure domain: backups in the same account with the same keys as the data they protect are one leaked credential away from being deleted together. Write only credentials on this bucket are worth the extra provider clicks.

This applies to bundled Postgres only. If you brought an external database, its backup regime belongs to whoever runs it, and the master key ritual below still applies to you.

## On the VM

The same values work in `/etc/uniffy/values.yaml`, then `sudo uniffy-k3s upgrade` applies them. One rule matters more here than anywhere: the bucket must be off the machine. Any S3 provider, another building, another company, anywhere that is not this VM.

The local dumps you already have, the two kept under `/var/backups/uniffy/` by the upgrade command and `uniffy-k3s backup`, live on the same disk as the database. They are for walking back a bad upgrade, not for surviving a dead machine. The S3 archive is what survives the machine. With it enabled, the VM path needs no other backup: Postgres history in the bucket, files in the bundled object store covered by your VM volume snapshots if you take them, and a database restore brings back everything else.

## The master key

`APP_MASTER_KEY` never changes after install, so this is a ritual, not a schedule:

```bash
kubectl -n uniffy get secret uniffy-secret \
  -o jsonpath='{.data.APP_MASTER_KEY}' | base64 -d
```

Print it, store it in your password manager or offline vault, and confirm the copy against the running secret. Losing it does not break the app today; it breaks the restore you will attempt in two years. That failure mode is silent until the worst moment, which is why the installer shouts about it and this page repeats it.

## Restore

### Point in time, cluster path

Restore builds a fresh cluster from the archive rather than repairing the old one in place. Point the chart at the backup store, optionally at an exact moment:

```yaml
postgres:
  recovery:
    source: s3://acme-uniffy-pg-backups/prod
    endpoint: https://s3.eu-central-1.amazonaws.com
    # targetTime: "2027-03-14 09:00:00+00"    # omit for latest
```

Install with these values, the same `uniffy-secret` including the same `APP_MASTER_KEY`, and the same backup credentials secret. CloudNativePG replays the base backup plus the archived logs up to the target, and the app comes up against the recovered database. Search returns as the reindex job rebuilds Meilisearch; nobody has to do anything for that beyond waiting.

### After a bad upgrade

The pre upgrade dump is the faster path when the database is minutes old and the archive is overkill. The [Upgrades](/docs/deployment/upgrades/) page carries that procedure and the reasons rollback without a restore is not offered.

## Believe nothing you have not restored

`kubectl -n uniffy get backups` shows the base backups CloudNativePG has taken and whether the last one completed. Look at it after enabling, and put a quarterly restore drill on the calendar: recover into a scratch namespace or a scratch VM, log in, open a note. An hour a quarter buys you the only proof that matters, because a backup that has never been restored is a hope with a retention policy.
