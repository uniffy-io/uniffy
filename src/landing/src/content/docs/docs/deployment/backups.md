---
title: Backups and Restore
description: Continuous Postgres backups to S3 with point in time recovery, the master key ritual, what not to bother backing up, and the restore procedures for both install paths.
sidebar:
  label: Backups and Restore
  order: 5
---

Back up three things to restore Uniffy: PostgreSQL, object storage, and `APP_MASTER_KEY`. The database holds content and permissions. Object storage holds files. The master key makes stored secrets readable after a restore.

## What needs backing up, what does not

| Store | Holds | Your job |
|---|---|---|
| PostgreSQL | Every note, message, task, permission, and setting | Back up continuously. This page. |
| `APP_MASTER_KEY` | The key wrapping every tenant secret | One copy, offline, once. Below. |
| Object storage | Originals, retained versions, thumbnails, and completed video copies | Protect the bucket with a backup or versioning and recovery policy. On a VM, back up the file store volume too. |
| Media scratch | Temporary conversion outputs | No backup. Disk backed `emptyDir` can be discarded when a pod is removed. |
| Meilisearch | Search index | Nothing. Rebuilt from Postgres by a background job. |
| Valkey | Queues and caches | Nothing. Queues drain, caches refill. |

A database backup without the master key leaves stored credentials unreadable. Without object storage, file metadata can return while downloads and videos stay missing. Storage durability protects against hardware failure; it does not replace a recovery plan for deleted or overwritten objects.

Media scratch is disposable. Pending video work can restart from object storage after recovery reclaims an expired processing claim. Keep stored originals and completed copies in your file backup policy.

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

Local dumps under `/var/backups/uniffy/` live on the same disk as the database. They help recover from a bad upgrade, but cannot survive a dead machine. Keep the Postgres archive off the VM.

Back up the bundled object store separately through volume snapshots or a file bucket backup. Keep those backups off the VM too. PostgreSQL archiving does not include uploaded files or completed playback copies. A media worker's temporary scratch volume needs no snapshot.

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

`kubectl -n uniffy get backups` shows the base backups CloudNativePG has taken and whether the last one completed. Check it after turning on backups, then schedule a quarterly restore drill in a separate namespace or VM.

Log in, open a note, download a stored file, and play a video from the restored object store. Check an encrypted credential too. A backup you have never restored is an assumption, not proof that your data can return.
