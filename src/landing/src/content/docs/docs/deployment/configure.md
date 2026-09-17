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
| `CORS_ORIGINS` | `*` | Comma-separated list of allowed origins, or `*`. Use `*` only in development. |

## PostgreSQL

The primary store. Uniffy targets PostgreSQL 18 and requires async (`asyncpg`).

| Variable | Default | Purpose |
|---|---|---|
| `POSTGRES_HOST` | `localhost` | Hostname or IP. |
| `POSTGRES_PORT` | `5432` | TCP port. |
| `POSTGRES_USER` | `uniffy` | Database role. |
| `POSTGRES_PASSWORD` | `uniffy` | Role password. Override for any non-dev deploy. |
| `POSTGRES_DB` | `uniffy` | Database name. |
| `SQL_ECHO` | `false` | Echo every SQL statement to logs. Debug only. |
| `DB_POOL_SIZE` | `30` | Base connection pool per process. |
| `DB_MAX_OVERFLOW` | `70` | Additional connections allowed beyond the pool under load. |
| `DB_POOL_RECYCLE` | `1800` | Seconds before a pooled connection is replaced. Prevents stale connections. |
| `DB_POOL_TIMEOUT` | `10` | Seconds to wait for a free connection before failing the request. |
| `DB_STATEMENT_TIMEOUT_MS` | `30000` | Milliseconds. Applied per SQL statement via `SET statement_timeout`. |
| `DB_COMMAND_TIMEOUT` | `30` | Seconds. `asyncpg` command-level timeout. |

Total max connections per backend pod is `WORKERS * (DB_POOL_SIZE + DB_MAX_OVERFLOW)`. Size your Postgres `max_connections` accordingly across backend, worker-core, and worker-egress.

## Authentication and encryption

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET_KEY` | placeholder | HMAC key for signing access tokens. Generate with `openssl rand -hex 32`. Required. |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Access token lifetime. Refresh is handled separately by the auth flow. |
| `APP_MASTER_KEY` | empty | Master Key Encryption Key (KEK). Wraps every per-org Data Encryption Key in `org_encryption_keys` and app-wide secrets such as the VAPID private key. Generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. Must be set before first boot. Losing this key permanently locks every encrypted column. |

**`APP_MASTER_KEY` is the single hardest dependency in the system. Treat it like a root password: store it in a secrets manager, back it up out of band, and never log it.**

## Initial seed and registration

These are read once during first-boot seeding and on every start to gate the registration RPC.

| Variable | Default | Purpose |
|---|---|---|
| `ALLOW_PUBLIC_REGISTRATION` | `false` | When `false`, accounts can only be created via org-invite. The `Register` RPC returns `INVALID_ARGUMENT` and the `/auth/register` page hides its form. Set `true` for dev or open self-hosted deployments. |
| `INITIAL_ADMIN_EMAIL` | `admin@uniffy.io` | Email of the seeded admin user; also used as the VAPID contact email for web push. |
| `INITIAL_ADMIN_PASSWORD` | `admin` | Seed password. Change immediately after first login. Development only. |
| `DEFAULT_ORG_NAME` | `Default` | Name of the org created at seed. |
| `DEFAULT_ORG_SLUG` | derived from name | Slug used in URLs. Leave empty to auto-generate. |

## Valkey

Valkey (Redis-compatible) backs the ARQ job queue, pub/sub channels, and the operational cache.

| Variable | Default | Purpose |
|---|---|---|
| `VALKEY_HOST` | `localhost` | Hostname. |
| `VALKEY_PORT` | `6380` | TCP port. The local compose maps Valkey to 6380 to avoid collision with a host Redis on 6379. |
| `VALKEY_PASSWORD` | `uniffy-valkey-dev` | Auth password. |
| `VALKEY_DATABASE` | `0` | Logical DB used by app code. |

Per-tier connection profiles (queue, pub/sub, ops cache) live in code and are not env-tunable. The ops client also wraps cache calls in a 150 ms deadline guard so a slow Valkey degrades into a cache miss instead of stalling the user request.

## Meilisearch

Backs universal `@` mention lookup and full-text search.

| Variable | Default | Purpose |
|---|---|---|
| `MEILISEARCH_URL` | `http://localhost:7700` | Base URL of the Meilisearch instance. |
| `MEILISEARCH_MASTER_KEY` | `uniffy-dev-master-key` | Master API key. Required in production. |
| `MEILISEARCH_TIMEOUT` | `30` | HTTP timeout in seconds. |

## Workers

Uniffy runs three ARQ worker fleets. Each has its own queue and concurrency settings.

- **Core** handles notifications, reminders, storage cleanup and recovery schedules.
- **Egress** handles agent runtime, conversation compaction, cron and external API integrations.
- **Media** handles video conversion, thumbnails, metadata and document extraction. Its separate `uniffy-media-worker` image contains FFmpeg and ffprobe. PDF and Office parsers also remain in the backend image for agent document reads.

| Variable | Default | Purpose |
|---|---|---|
| `CORE_WORKER_MAX_JOBS` | `10` | Concurrent jobs per core worker. |
| `CORE_WORKER_POLL_DELAY` | `0.5` | Seconds between queue polls. |
| `EGRESS_WORKER_MAX_JOBS` | `50` | Concurrent jobs per egress worker. Higher because most jobs are I/O waiting. |
| `EGRESS_WORKER_POLL_DELAY` | `0.05` | Aggressive polling for low queue latency. |
| `MEDIA_WORKER_MAX_JOBS` | `2` | Concurrent jobs per media process. |
| `MEDIA_WORKER_POLL_DELAY` | `0.5` | Seconds between media queue polls. |
| `MEDIA_WORKER_JOB_TIMEOUT` | `300` | Default media job timeout in seconds. Video conversions have a longer duration based limit. |
| `WORKER_JOB_TIMEOUT` | `300` | Per-job timeout for the core fleet, in seconds. |
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

When upgrading from a release that runs media jobs on core, pause new uploads and let existing core media jobs finish before replacing workers. Start all fleets at the same release version. Pending durable file work is also recovered from PostgreSQL onto the media queue.

## Object storage (S3-compatible)

Stores user file uploads, attachments, and generated thumbnails. Any S3-compatible service works: AWS S3, Cloudflare R2, MinIO, RustFS, Backblaze B2, etc.

| Variable | Default | Purpose |
|---|---|---|
| `S3_ENDPOINT_URL` | `http://localhost:9000` | Endpoint URL. Set to `https://s3.<region>.amazonaws.com` for AWS, or your provider's URL. |
| `S3_ACCESS_KEY` | `rustfsadmin` | Access key (username). |
| `S3_SECRET_KEY` | `rustfsadmin` | Secret key (password). |
| `S3_BUCKET_NAME` | `uniffy-files` | Bucket for stored objects. Must exist before first write. |
| `S3_REGION` | `us-east-1` | Region. Required even on providers that ignore it. |
| `S3_USE_SSL` | `false` | Enable HTTPS to the endpoint. `true` for any non-local provider. |
| `S3_CONNECT_TIMEOUT` | `10` | Seconds. |
| `S3_READ_TIMEOUT` | `30` | Seconds. |
| `S3_MAX_RETRIES` | `3` | Adaptive backoff. |

## Chat

| Variable | Default | Purpose |
|---|---|---|
| `CHAT_TYPING_MEMBER_LIMIT` | `50` | Channels larger than this skip the typing-indicator fan-out to protect Valkey pub/sub from large membership broadcasts. |

## Video processing

Core workers prepare completed MP4 copies when original formats need conversion. Originals remain in storage. Recording conversions and playback copies share a global encode limit. Use the same settings across backend and worker replicas.

| Variable | Default | Purpose |
|---|---|---|
| `MEDIA_RENDITIONS_ENABLED` | `true` | Allow new playback conversions. When false, pending copies terminate as failed. Existing copies and original playback stay available. Recording swaps remain active. |
| `TRANSCODE_MAX_CONCURRENT` | `1` | Global encode slots across media workers, capped at `MEDIA_WORKER_MAX_JOBS`. Raise alongside CPU, memory and scratch capacity. |
| `TRANSCODE_MAX_SOURCE_BYTES` | `4294967296` | Maximum downloaded source size, 4 GiB. Also bounds video thumbnail source downloads. |
| `TRANSCODE_MAX_OUTPUT_BYTES` | `4294967296` | Maximum encoded file size, 4 GiB. Incomplete output is rejected. |
| `TRANSCODE_MAX_DURATION_SECONDS` | `7200` | Maximum conversion duration, two hours. |
| `TRANSCODE_FFMPEG_TIMEOUT` | `1800` | Minimum encoder deadline. Longer videos receive four times their duration. Worker deadline includes ten extra minutes for storage work. |
| `TRANSCODE_THREADS` | `2` | Decoder and encoder thread budget. Filter processing uses one thread. |
| `MEDIA_SCRATCH_DIRECTORY` | system temporary directory | Existing writable directory for source and output files. Mount it in every media worker. Compose uses `/var/lib/uniffy/media` on a disk volume. |

Compose gives media worker a disk backed scratch volume. A conversion can hold source plus output, up to 8 GiB with default byte limits. Concurrent thumbnail downloads need extra space. On Kubernetes, mount writable disk space and set `MEDIA_SCRATCH_DIRECTORY`; memory backed `/tmp` counts against worker RAM. Set byte limits below available capacity. A storage error leaves the original available and retries transient conversion failures up to three attempts.

Recovery runs every five minutes. It retries pending work and reclaims processing claims after their maximum lifetime. Expired cleanup records remove abandoned objects after live references are checked. Configure your object store to abort incomplete multipart uploads after one day to cover a process dying before its upload identifier reaches PostgreSQL.

Disabling conversion does not cancel an encoder already running. Apply environment changes by recreating backend and core worker containers. Failed copies are terminal for that file version; replacing or restoring the file starts a new attempt budget.

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
