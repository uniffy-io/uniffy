---
title: Backups and Restore
description: Continuous Postgres backups to S3 with point in time recovery, the master key ritual, what Valkey persistence means for edits not yet saved, what not to bother backing up, and the restore procedures for both install paths.
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
| Valkey | Queues, caches, and edits accepted in the last few seconds that PostgreSQL does not hold yet | Choose its persistence and keep its data volume on durable storage. Persistence decides what a crash costs; a file backup is optional and returns little. [Below](#valkey-and-edits-not-yet-saved). |
| LiveKit's Valkey | LiveKit's room registry for calls in progress | Nothing of Uniffy's lives here. The compose stack runs it without persistence. |

A database backup without the master key leaves stored credentials unreadable. Without object storage, file metadata can return while downloads and videos stay missing. Storage durability protects against hardware failure; it does not replace a recovery plan for deleted or overwritten objects.

Media scratch is disposable. Pending video work can restart from object storage after recovery reclaims an expired processing claim. Keep stored originals and completed copies in your file backup policy.

## Valkey and edits not yet saved

Valkey is more than queues and caches. When someone types in a note, a task or an event description, the server accepts the edit into Valkey first and writes it to PostgreSQL about ten seconds after the first unsaved edit, later when the workers fall behind. Collaborators see the edit at once. The chip in the editor reads Synced while the edit waits and Saved once PostgreSQL holds it.

So losing Valkey's data can cost the server its copy of the edits waiting for their save. Normally that is the last ten seconds or so of each document being edited, more while saves fall behind. Which events lose them depends on the persistence Valkey runs with. Uniffy reads that setting at startup and logs the loss window it implies, but never changes it.

| Valkey persistence | Clean restart or upgrade loses | Crash or power cut loses |
|---|---|---|
| AOF with `appendfsync always` | Nothing | Nothing |
| AOF with `appendfsync everysec` | Nothing | Edits accepted in about the last second |
| AOF with `appendfsync no` | Nothing | Edits the operating system had not written to disk yet |
| RDB snapshots only | Nothing, because Valkey writes a snapshot as it shuts down | Edits accepted since the last snapshot that were still waiting for their save |
| No persistence | Every edit waiting for its save | Every edit waiting for its save |

A clean restart is Valkey shutting down on its own terms, as it does on a normal stop. Losing the data volume itself loses every edit waiting for its save, whatever the setting.

That is only the server's copy. Every editor also keeps its own edits in encrypted storage on the device until PostgreSQL holds them. When Valkey comes back, open editors send again whatever the server lost. An editor that was closed in the meantime sends it the next time its author opens Uniffy on that device.

An edit is gone for good only when its author never returns to that device, signs out and discards it, or edits in a browser that cannot store it. When a write to the device fails, the chip reads Not saved on device, so the author knows to keep the editor open.

So pick Valkey's persistence for how much of the last few seconds you can afford to lose on a crash, keep its data volume on storage you trust, and keep backing up PostgreSQL.

A file backup of Valkey adds little for edits. Saves follow within seconds, so a backup taken minutes or hours ago holds an edit PostgreSQL lacks only when saves were stalled at that moment, for example while the core workers were down. It holds document text, so guard it like a PostgreSQL backup.

If you restore one, start Valkey on the restored files; never load keys into a running instance. The restart gives Valkey a new identity. On the next touch of each document, Uniffy saves the restored edits that continue what PostgreSQL already holds and sets the rest aside until maintenance clears it a week after its newest edit. The restored files also bring back the job queue as it was, so jobs that ran after the backup can run again.

Valkey holds document text in memory and in its persistence files. Uniffy does not encrypt those bytes, so protect Valkey, its disk and its files the way you protect PostgreSQL. Only Uniffy backends, workers and their operators hold its password. LiveKit keeps its room registry on a Valkey of its own; a separate logical database on the same instance is no boundary. Never give Uniffy's Valkey an `allkeys-*` eviction policy; [Configure Uniffy](/docs/deployment/configure/#valkey) explains why.

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
