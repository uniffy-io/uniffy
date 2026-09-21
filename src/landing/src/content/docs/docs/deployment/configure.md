---
title: Configure Uniffy
description: Reference for every environment variable Uniffy reads at startup. What each setting does, its default, and when to override it.
sidebar:
  label: Configure Uniffy
  order: 6
---

Uniffy is configured through environment variables. The backend, workers, and supporting services all read from the same set. A working starting point lives at `.env.example` in the repository; copy it to `.env` and edit before running the stack.

This page documents every variable.

## Server

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `0.0.0.0` | Bind address for the HTTP server. |
| `PORT` | `8000` | TCP port the backend listens on. |
| `WORKERS` | `1` | Number of Granian worker processes. Use `1` for Kubernetes deployments since pods scale horizontally. Use `NUM_CPU / 2` if the backend runs on VM instances. |
| `LOG_LEVEL` | `info` | One of `debug`, `info`, `warning`, `error`, `critical`. |
| `LOG_FORMAT` | `console` | Use `console` for human readable output or `json` for structured logs. |
| `ENVIRONMENT` | `development` | One of `development`, `staging`, `production`. Controls deployment sensitive safety defaults. |
| `CORS_ORIGINS` | `*` | Comma separated list of allowed origins, or `*`. Use `*` only in development. |

## PostgreSQL

The primary store. Uniffy targets PostgreSQL 18 and requires async (`asyncpg`).

| Variable | Default | Purpose |
|---|---|---|
| `POSTGRES_HOST` | `localhost` | Hostname or IP. |
| `POSTGRES_PORT` | `5432` | TCP port. |
| `POSTGRES_USER` | `uniffy` | Database role. |
| `POSTGRES_PASSWORD` | `uniffy` | Role password. Override outside development. |
| `POSTGRES_DB` | `uniffy` | Database name. |
| `SQL_ECHO` | `false` | Echo every SQL statement to logs. Debug only. |
| `DB_POOL_SIZE` | `30` | Base connection pool per process. |
| `DB_MAX_OVERFLOW` | `70` | Additional connections allowed beyond the pool under load. |
| `DB_POOL_RECYCLE` | `1800` | Seconds before a pooled connection is replaced. Prevents stale connections. |
| `DB_POOL_TIMEOUT` | `10` | Seconds to wait for a free connection before failing the request. |
| `DB_STATEMENT_TIMEOUT_MS` | `30000` | Milliseconds. Applied per SQL statement via `SET statement_timeout`. |
| `DB_COMMAND_TIMEOUT` | `30` | Seconds. `asyncpg` timeout per command. |

Total max connections per backend pod is `WORKERS * (DB_POOL_SIZE + DB_MAX_OVERFLOW)`. Include backend, core, egress, and media pods when sizing Postgres `max_connections`.

## Authentication and encryption

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET_KEY` | placeholder | HMAC key for signing access tokens. Generate with `openssl rand -hex 32`. Required. |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Access token lifetime. Refresh is handled separately by the auth flow. |
| `APP_MASTER_KEY` | empty | Master Key Encryption Key (KEK). Wraps every organization Data Encryption Key in `org_encryption_keys` and application secrets such as the VAPID private key. Generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. Must be set before first boot. Losing this key permanently locks every encrypted column. |

Store `APP_MASTER_KEY` in a secrets manager and back it up outside the deployment. Never log it. A database backup without this key cannot restore encrypted secrets.

## Initial seed and registration

These settings control the first database seed and whether registration is open.

| Variable | Default | Purpose |
|---|---|---|
| `ALLOW_PUBLIC_REGISTRATION` | `false` | When `false`, accounts can only be created by invitation. The `Register` RPC returns `INVALID_ARGUMENT` and the `/auth/register` page hides its form. Set `true` for development or open self hosted deployments. |
| `INITIAL_ADMIN_EMAIL` | `admin@uniffy.io` | Email of the seeded admin user; also used as the VAPID contact email for web push. |
| `INITIAL_ADMIN_PASSWORD` | `admin` | Seed password. Change immediately after first login. Development only. |
| `DEFAULT_ORG_NAME` | `Default` | Name of the org created at seed. |
| `DEFAULT_ORG_SLUG` | derived from name | Slug used in URLs. Leave empty to generate it from the name. |

## Valkey

Valkey backs the ARQ job queue, pub/sub channels, and the operational cache.

| Variable | Default | Purpose |
|---|---|---|
| `VALKEY_HOST` | `localhost` | Hostname. |
| `VALKEY_PORT` | `6380` | TCP port. The local compose maps Valkey to 6380 to avoid collision with a host Redis on 6379. |
| `VALKEY_PASSWORD` | `uniffy-valkey-dev` | Auth password. |
| `VALKEY_DATABASE` | `0` | Logical DB used by app code. |

Queue, pub/sub, and cache connection profiles are set in code. Cache calls have a 150 ms deadline, so a slow Valkey becomes a cache miss instead of stalling the request.

## Meilisearch

Backs universal `@` mention lookup and full text search.

| Variable | Default | Purpose |
|---|---|---|
| `MEILISEARCH_URL` | `http://localhost:7700` | Base URL of the Meilisearch instance. |
| `MEILISEARCH_MASTER_KEY` | `uniffy-dev-master-key` | Master API key. Required in production. |
| `MEILISEARCH_TIMEOUT` | `30` | HTTP timeout in seconds. |

## Workers

Uniffy runs three ARQ worker fleets. Each has its own queue and concurrency settings.

The **core worker** handles notifications, reminders, storage cleanup and recovery schedules. The **egress worker** handles agent runtime, conversation compaction, cron and external API integrations.

The **media worker** handles video conversion, thumbnails, metadata and document extraction. Its separate `uniffy-media-worker` image contains FFmpeg and ffprobe. PDF and Office parsers also remain in the backend image for agent document reads.

| Variable | Default | Purpose |
|---|---|---|
| `CORE_WORKER_MAX_JOBS` | `10` | Concurrent jobs per core worker. |
| `CORE_WORKER_POLL_DELAY` | `0.5` | Seconds between queue polls. |
| `EGRESS_WORKER_MAX_JOBS` | `50` | Concurrent jobs per egress worker. Higher because most jobs are I/O waiting. |
| `EGRESS_WORKER_POLL_DELAY` | `0.05` | Aggressive polling for low queue latency. |
| `MEDIA_WORKER_MAX_JOBS` | `2` | Concurrent jobs per media process. |
| `MEDIA_WORKER_POLL_DELAY` | `0.5` | Seconds between media queue polls. |
| `MEDIA_WORKER_JOB_TIMEOUT` | `300` | Default media job timeout in seconds. Video conversions have a longer duration based limit. |
| `WORKER_JOB_TIMEOUT` | `300` | Timeout per core job, in seconds. |
| `EGRESS_WORKER_JOB_TIMEOUT` | `900` | Per-job timeout for the egress fleet. Agent runtime jobs may legitimately run up to `MAX_TOOL_ITERATIONS * 60s` when slow tools fan out. |
| `WORKER_KEEP_RESULT` | `3600` | Seconds to retain completed job results in Valkey. |
| `WORKER_MAX_TRIES` | `3` | Retry attempts before a job is marked failed. |
| `WORKER_HEALTH_CHECK_INTERVAL` | `30` | Seconds between worker health pings. |
| `CORE_WORKER_METRICS_PORT` | `9091` | Prometheus `/metrics` port for the core fleet. |
| `EGRESS_WORKER_METRICS_PORT` | `9092` | Prometheus `/metrics` port for the egress fleet. |
| `MEDIA_WORKER_METRICS_PORT` | `9093` | Prometheus `/metrics` port for the media fleet. |

Run each fleet as a separate process or Deployment. Core and egress use the backend image. Media uses `ghcr.io/uniffy-io/uniffy-media-worker` with the same release tag:

```sh
python -m uniffy --worker-core
python -m uniffy --worker-egress
python -m uniffy --worker-media
```

Set CPU and memory requests and limits in the Kubernetes Deployment. Size media resources for accepted inputs and concurrency, and provide disk backed scratch space. Development limits live in the Compose service definition.

When upgrading from a release that runs media jobs on core, pause new uploads and recordings, then let existing core media jobs finish before replacing workers. Start all fleets at the same release version. Pending durable file work is also recovered from PostgreSQL onto the media queue. See [Upgrades](/docs/deployment/upgrades/#moving-media-work-off-core).

## Object storage (S3 compatible)

Stores original uploads, attachments, file versions, thumbnails, and completed video playback copies. Any S3 compatible service works: AWS S3, Cloudflare R2, MinIO, RustFS, Backblaze B2, etc.

| Variable | Default | Purpose |
|---|---|---|
| `S3_ENDPOINT_URL` | `http://localhost:9000` | Endpoint URL. Set to `https://s3.<region>.amazonaws.com` for AWS, or your provider's URL. |
| `S3_ACCESS_KEY` | `rustfsadmin` | Access key (username). |
| `S3_SECRET_KEY` | `rustfsadmin` | Secret key (password). |
| `S3_BUCKET_NAME` | `uniffy-files` | Bucket for stored objects. Must exist before first write. |
| `S3_REGION` | `us-east-1` | Region. Required even on providers that ignore it. |
| `S3_USE_SSL` | `false` | Use HTTPS to the endpoint. Set `true` for any remote provider. |
| `S3_CONNECT_TIMEOUT` | `10` | Seconds. |
| `S3_READ_TIMEOUT` | `30` | Seconds. |
| `S3_MAX_RETRIES` | `3` | Adaptive backoff. |

## Chat

| Variable | Default | Purpose |
|---|---|---|
| `CHAT_TYPING_MEMBER_LIMIT` | `50` | Channels larger than this skip typing broadcasts to bound Valkey pub/sub work. |

## Video processing

Media workers prepare completed MP4 copies for uploaded videos. Browsers try the original first and use the copy if original playback fails. Uploaded originals remain in storage; screen recordings replace their WebM source with the promised MP4 after conversion succeeds.

Recording conversions and playback copies share an encode limit within each media worker process. Run one media worker process per pod. Each pod gets its own slots: three pods with two encode slots each can run six conversions at once. LiveKit calls do not use these workers or settings.

| Variable | Default | Purpose |
|---|---|---|
| `MEDIA_RENDITIONS_ENABLED` | `true` | Allow new playback conversions. When false, pending copies terminate as failed. Existing copies and original playback stay available. Recording swaps remain active. |
| `TRANSCODE_MAX_CONCURRENT` | `1` | Encode slots per media worker process, capped at that worker's `MEDIA_WORKER_MAX_JOBS`. Raise alongside pod CPU, memory and scratch capacity. Replicas add independent capacity. |
| `TRANSCODE_MAX_SOURCE_BYTES` | `8589934592` | Maximum video source size, 8 GiB. Probes, thumbnails and conversions read object storage through HTTP Range without a local source copy. |
| `TRANSCODE_MAX_OUTPUT_BYTES` | `4294967296` | Maximum encoded file size, 4 GiB. Incomplete output is rejected. |
| `TRANSCODE_MAX_DURATION_SECONDS` | `7200` | Maximum video length accepted for conversion, two hours. |
| `TRANSCODE_FFMPEG_TIMEOUT` | `1800` | Minimum encoder deadline. Longer videos receive four times their duration. Worker deadline includes ten extra minutes for storage work. |
| `TRANSCODE_THREADS` | `2` | Decoder and encoder thread budget. Filter processing uses one thread. |
| `MEDIA_SCRATCH_DIRECTORY` | system temporary directory | Existing writable directory for output files. Mount it in every media worker. Compose uses `/var/lib/uniffy/media` on a disk volume. |
| `MEDIA_SCRATCH_MAX_BYTES` | `17179869184` | Scratch admission budget, 16 GiB. Match the disk volume size. Existing files, output reservations and free disk can defer new encodes. |

These byte limits bound processing, not the general upload quota. Files outside conversion limits may still play in a compatible browser or be downloaded as originals.

Only encoded MP4 output needs video scratch space. Sources stay in object storage, including during thumbnail generation. A full conversion still transfers source bytes over the network and can reread ranges. Compose gives media workers a disk backed scratch volume. Kubernetes settings are below.

`MEDIA_SCRATCH_MAX_BYTES` defaults to `17179869184` (16 GiB). Match it to the scratch volume's size limit. Each encode reserves its output cap plus 256 MiB for packet and MP4 finalization overhead. The worker keeps another 256 MiB free and checks existing scratch files and filesystem free space before admission. Insufficient space defers the job without consuming an attempt. Reservations are conservative and can reduce concurrency before the disk fills.

An occupied encode slot delays work without consuming a conversion attempt. Transient conversion failures retry up to three attempts. Recovery runs every five minutes to find pending work and reclaim processing claims after their maximum lifetime. Expired cleanup records remove abandoned objects after live references are checked.

Configure your object store to abort incomplete multipart uploads after one day. This covers a process dying before its upload identifier reaches PostgreSQL.

Disabling conversion does not cancel an encoder already running. Apply environment changes by restarting backend and all worker Deployments with matching settings. Failed copies are terminal for that file version; replacing or restoring the file starts a new attempt budget.

### Media scratch on Kubernetes

Use a disk backed `emptyDir` for temporary files. Originals and completed copies live in object storage, so the media worker needs no PVC. Set both `MEDIA_SCRATCH_DIRECTORY` and `TMPDIR` to the mount so conversion files and other temporary work use the same disk. A memory backed volume counts against pod RAM.

This pod template fragment starts with one media replica, four job slots, and two encode slots per pod, matching `.env.example`. Apply it to the media Deployment, with the same configuration and Secret references as the backend. Replace `RELEASE_VERSION` with the backend's release version, or use the media image digest from that release's verified `images.txt`.

```yaml
spec:
  replicas: 1
  template:
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: worker-media
          image: ghcr.io/uniffy-io/uniffy-media-worker:RELEASE_VERSION
          command: [python, -m, uniffy, --worker-media]
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: [ALL]
          env:
            - name: MEDIA_WORKER_MAX_JOBS
              value: "4"
            - name: TRANSCODE_MAX_CONCURRENT
              value: "2"
            - name: MEDIA_SCRATCH_MAX_BYTES
              value: "17179869184"
            - name: MEDIA_SCRATCH_DIRECTORY
              value: /var/lib/uniffy/media
            - name: TMPDIR
              value: /var/lib/uniffy/media
          ports:
            - name: metrics
              containerPort: 9093
          resources:
            requests:
              cpu: "1"
              memory: 1Gi
              ephemeral-storage: 16Gi
            limits:
              cpu: "2"
              memory: 2Gi
              ephemeral-storage: 20Gi
          volumeMounts:
            - name: media-scratch
              mountPath: /var/lib/uniffy/media
      volumes:
        - name: media-scratch
          emptyDir:
            sizeLimit: 16Gi
```

Keep the root filesystem read only and mount scratch for temporary writes. FFmpeg and ffprobe receive only a fixed binary search path and locale settings. Worker credentials stay out of their environment.

Restrict media pod egress to your DNS, PostgreSQL, Valkey, Meilisearch and object storage endpoints with a [NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/). Match selectors and ports to your deployment, including external storage or node local DNS where used. Your network plugin must enforce these policies. The decoder still shares the worker's user, filesystem and network; these controls do not provide a separate decoder sandbox.

Two encodes reserve 8.5 GiB with the 4 GiB output cap. Another 256 MiB stays free. The 16 GiB scratch volume leaves room for temporary work and conservative admission checks. The pod's 20 GiB ephemeral storage limit also covers logs and writable container layers. Nodes need enough free disk for every scheduled media pod.

Normal completion and cancellation remove output files. A killed process can leave scratch files until pod replacement discards `emptyDir`. Those files count against admission. If scratch pressure persists after jobs stop, replace the media pod so pending jobs can retry with an empty volume.

Set CPU, memory, and ephemeral storage budgets in Kubernetes. Raise them alongside byte limits or concurrency, then measure with your accepted video formats. An `emptyDir` survives a container restart within the same pod, but disappears when that pod is removed. Recovery can restart interrupted work from stored originals; it does not resume a half written output.

## Calls (LiveKit)

LiveKit is the SFU for audio and video calls. Server config lives in LiveKit's own config file; only the credentials and URLs come from the env.

| Variable | Default | Purpose |
|---|---|---|
| `LIVEKIT_WS_URL` | `ws://localhost:7880` | WebSocket URL the **browser** uses to reach LiveKit signaling. |
| `LIVEKIT_HOST` | `http://localhost:7880` | HTTP URL the **backend** uses for LiveKit admin REST API (server-to-server). |
| `LIVEKIT_API_KEY` | `devkey` | Shared API key. Rotate together with the secret. |
| `LIVEKIT_API_SECRET` | none | Shared secret, yours to generate: `openssl rand -hex 32`. At least 32 characters, and never one published in the repository. Calls stay disabled until it is set on both the backend and the LiveKit server. |
| `LIVEKIT_VALKEY_DATABASE` | `1` | Valkey logical DB used by LiveKit for its room registry. Kept separate from the app's DB (`VALKEY_DATABASE`) to avoid eviction or pub/sub cross-impact. |

## TURN relay

Optional. By default media flows directly to LiveKit and NAT traversal uses LiveKit's embedded TURN; nothing to configure. Set these only when all media must relay through an external TURN gateway.

| Variable | Default | Purpose |
|---|---|---|
| `TURN_SERVER_URLS` | empty | Comma-separated TURN URIs advertised to clients. Empty means direct media mode. |
| `TURN_SHARED_SECRET` | empty | Shared secret for ephemeral TURN credentials (TURN REST spec). Must match the relay. Required when `TURN_SERVER_URLS` is set. |
| `TURN_CREDENTIAL_TTL_SECONDS` | `28800` | Lifetime of minted TURN credentials. Must exceed the longest expected call; ICE servers cannot be rotated mid connection. |

## Cache controls

| Variable | Default | Purpose |
|---|---|---|
| `CACHE_DISABLED_NAMESPACES` | empty | Comma-separated list of Valkey cache namespaces to bypass at runtime. Accepts either a metrics namespace (first segment of the key) or a multi-segment prefix. Known namespaces: `chat`, `chat:channel`, `perm`, `agent`, `user`, `provider`. Use only when an operational issue forces a single namespace off without taking the rest down. |

## Audit log

| Variable | Default | Purpose |
|---|---|---|
| `TRUSTED_PROXY_HOPS` | `0` | Number of reverse proxies in front of the backend, as a hop count rather than an address list. With `N` above zero, the audit middleware takes the entry `N` from the right of `X-Forwarded-For` as the client IP captured into `audit_events.ip_address`, matching how nginx, Caddy, ALB, and Cloudflare append the immediate caller. At `0` the raw socket peer is used and `X-Forwarded-For` is ignored: correct for direct-connect deployments and the safe default behind an unknown load balancer. Also load-bearing for per-IP rate limits: at `0` a private or loopback peer skips the per-IP bucket so a misconfigured proxy cannot lock out every user behind it. Set `1` behind a single proxy, `2` when chained. |
| `AUDIT_EVENTS_FILE_UPLOADED` | `false` | Opt-in for the high-volume `file.uploaded` audit row. Each successful upload writes one row. Turn on once storage volume has been characterised and compliance asks for upload attribution. Accepts `1`, `true`, `yes` (case-insensitive). |

## Prometheus metrics

Granian forks `WORKERS` children. Without multiprocess mode, each child owns a private metrics registry and a `/metrics` scrape returns one child's slice only. The bootstrap helper in `uniffy.infrastructure.observability.bootstrap` manages a per-component subdir under `PROMETHEUS_MULTIPROC_BASE_DIR` so backend and worker each get their own clean directory on startup.

| Variable | Default | Purpose |
|---|---|---|
| `PROMETHEUS_MULTIPROC_BASE_DIR` | `/tmp/uniffy_prom_metrics` | Base directory for the per-component subdirs. Override only when the container needs a writable path elsewhere. |
| `PROMETHEUS_MULTIPROC_DIR` | unset | Explicit override; bypasses the per-component subdir. |

## Email and SMTP (optional, system default)

Optional. Used when an organization has no per-org SMTP override, or for org-less flows such as a pre-org password reset. Both the system default and per-org SMTP can also be configured via the admin UI; per-org SMTP passwords are stored encrypted via `OrgCipher` (envelope encryption, per-org DEK).

All providers are reached through SMTP. For Resend, use the SMTP relay (`smtp.resend.com:587`, username `resend`, password is your Resend API key).

| Variable | Default | Purpose |
|---|---|---|
| `MAIL_FROM_ADDRESS` | empty | Default `From` address. Required to send mail. |
| `MAIL_FROM_NAME` | `Uniffy` | Display name shown to recipients. |
| `MAIL_REPLY_TO` | empty | Optional `Reply-To` header. |
| `MAIL_RATE_LIMIT_PER_MIN` | `100` | Per-org or per-system cap, enforced via a Valkey token bucket. |
| `MAIL_DELIVERY_LOG_ENABLED` | `false` | Persist per-send rows in `mail_delivery_log`. Off saves storage; on gives forensics. |
| `UNIFFY_BASE_URL` | `http://localhost:5173` | Public app URL used to build user facing links in outbound email (accept invite, password reset, support session notifications). No trailing slash. Example: `https://cloud.uniffy.io`. |
| `SMTP_HOST` | empty | SMTP server hostname. |
| `SMTP_PORT` | `587` | SMTP port. `587` for STARTTLS, `465` for implicit TLS. |
| `SMTP_USERNAME` | empty | SMTP auth user. For Resend: `resend`. |
| `SMTP_PASSWORD` | empty | SMTP auth password. For Resend: your API key. |
| `SMTP_USE_TLS` | `true` | Use STARTTLS on connect. Disable only for plain-text dev relays. |
