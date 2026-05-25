---
title: Configure Uniffy
description: Reference for every environment variable Uniffy reads at startup. What each setting does, its default, and when to override it.
sidebar:
  label: Configure Uniffy
  order: 1
---

Uniffy is configured through environment variables. The backend, workers, and supporting services all read from the same set. A working starting point lives at `.env.example` in the repository; copy it to `.env` and edit before running the stack.

This page documents every variable.

## Server

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `0.0.0.0` | Bind address for the HTTP server. |
| `PORT` | `8000` | TCP port the backend listens on. |
| `WORKERS` | `1` | Number of Granian worker processes. Use `1` for Kubernetes and Docker deployments since pods and containers scale horizontally. Use `NUM_CPU / 2` if the backend runs on VM instances. |
| `LOG_LEVEL` | `debug` | One of `debug`, `info`, `warning`, `error`, `critical`. |
| `ENVIRONMENT` | `development` | One of `development`, `staging`, `production`. Used by logging and observability. |
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

The backend runs two separate ARQ worker fleets. Each has its own tunables.

- **Core** handles thumbnails, extraction, notifications, reminders, storage, chat-mute. Tight SLA, local I/O.
- **Egress** handles agent runtime, conversation compaction, cron, and external API integrations. Slow, retry-heavy, I/O bound.

| Variable | Default | Purpose |
|---|---|---|
| `CORE_WORKER_MAX_JOBS` | `10` | Concurrent jobs per core worker. |
| `CORE_WORKER_POLL_DELAY` | `0.5` | Seconds between queue polls. |
| `EGRESS_WORKER_MAX_JOBS` | `50` | Concurrent jobs per egress worker. Higher because most jobs are I/O waiting. |
| `EGRESS_WORKER_POLL_DELAY` | `0.05` | Aggressive polling for low queue latency. |
| `WORKER_JOB_TIMEOUT` | `300` | Per-job timeout for the core fleet, in seconds. |
| `EGRESS_WORKER_JOB_TIMEOUT` | `900` | Per-job timeout for the egress fleet. Agent runtime jobs may legitimately run up to `MAX_TOOL_ITERATIONS * 60s` when slow tools fan out. |
| `WORKER_KEEP_RESULT` | `3600` | Seconds to retain completed job results in Valkey. |
| `WORKER_MAX_TRIES` | `3` | Retry attempts before a job is marked failed. |
| `WORKER_HEALTH_CHECK_INTERVAL` | `30` | Seconds between worker health pings. |
| `CORE_WORKER_METRICS_PORT` | `9091` | Prometheus `/metrics` port for the core fleet. |
| `EGRESS_WORKER_METRICS_PORT` | `9092` | Prometheus `/metrics` port for the egress fleet. |

Run the two fleets as separate processes or Deployments:

```sh
arq uniffy.workers.settings.CoreWorkerSettings
arq uniffy.workers.settings.EgressWorkerSettings
```

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

## Calls (LiveKit)

LiveKit is the SFU for audio and video calls. Container config is inlined in `.docker/compose/calls.yaml`; only the credentials and URLs come from the env.

| Variable | Default | Purpose |
|---|---|---|
| `LIVEKIT_WS_URL` | `ws://localhost:7880` | WebSocket URL the **browser** uses to reach LiveKit signaling. |
| `LIVEKIT_HOST` | `http://localhost:7880` | HTTP URL the **backend** uses for LiveKit admin REST API (server-to-server). |
| `LIVEKIT_API_KEY` | `devkey` | Shared API key. Rotate together with the secret. |
| `LIVEKIT_API_SECRET` | `devsecret-...` | Shared secret. Minimum 32 characters in production. |
| `LIVEKIT_VALKEY_DATABASE` | `1` | Valkey logical DB used by LiveKit for its room registry. Kept separate from the app's DB (`VALKEY_DATABASE`) to avoid eviction or pub/sub cross-impact. |

## TURN relay (coturn)

Optional. Off by default in compose (profile `calls-turn`); most local dev does not need TURN. Bring up with `./run.sh calls-turn-up`.

| Variable | Default | Purpose |
|---|---|---|
| `COTURN_STUN_URL` | `stun:localhost:3478` | STUN URL the browser puts in its ICE servers list. |
| `COTURN_TURN_URL` | `turn:localhost:3478?transport=udp` | TURN URL (UDP). |
| `COTURN_TURNS_URL` | `turns:localhost:5349?transport=tcp` | TURN over TLS URL. |
| `COTURN_SHARED_SECRET` | `uniffy-coturn-dev` | Shared secret for TURN REST API ephemeral credentials. The backend mints `username=<expiry_ts>:<user_id>` and `password=base64(HMAC-SHA1(secret, username))`. |
| `COTURN_REALM` | `turn.localhost` | TURN realm. |
| `COTURN_CREDENTIAL_TTL_SECONDS` | `21600` | TTL of minted TURN credentials. Should match the LiveKit JWT TTL. |

## Cache controls

| Variable | Default | Purpose |
|---|---|---|
| `CACHE_DISABLED_NAMESPACES` | empty | Comma-separated list of Valkey cache namespaces to bypass at runtime. Accepts either a metrics namespace (first segment of the key) or a multi-segment prefix. Known namespaces: `chat`, `chat:channel`, `perm`, `agent`, `user`, `provider`. Use only when an operational issue forces a single namespace off without taking the rest down. |

## Audit log

| Variable | Default | Purpose |
|---|---|---|
| `TRUSTED_PROXIES` | empty | Comma-separated list of trusted-proxy peer IPs. When the immediate ASGI client matches one of these, the audit middleware honors the leftmost entry of `X-Forwarded-For` as the client IP captured into `audit_events.ip_address`. With the list empty, the raw socket peer is used and `X-Forwarded-For` is ignored: correct for direct-connect deployments and the safe default behind an unknown load balancer. |
| `AUDIT_EVENTS_FILE_UPLOADED` | `false` | Opt-in for the high-volume `file.uploaded` audit row. Each successful upload writes one row. Turn on once storage volume has been characterised and compliance asks for upload attribution. Accepts `1`, `true`, `yes` (case-insensitive). |

## Prometheus metrics

Granian forks `WORKERS` children. Without multiprocess mode, each child owns a private metrics registry and a `/metrics` scrape returns one child's slice only. The bootstrap helper in `uniffy._metrics_bootstrap` manages a per-component subdir under `PROMETHEUS_MULTIPROC_BASE_DIR` so backend and worker each get their own clean directory on startup.

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
| `FRONTEND_BASE_URL` | `http://localhost:5173` | Public app URL used to build password-reset links and other in-email URLs. No trailing slash. Example: `https://app.uniffy.io`. |
| `SMTP_HOST` | empty | SMTP server hostname. |
| `SMTP_PORT` | `587` | SMTP port. `587` for STARTTLS, `465` for implicit TLS. |
| `SMTP_USERNAME` | empty | SMTP auth user. For Resend: `resend`. |
| `SMTP_PASSWORD` | empty | SMTP auth password. For Resend: your API key. |
| `SMTP_USE_TLS` | `true` | Use STARTTLS on connect. Disable only for plain-text dev relays. |

