---
title: Architecture
description: How Uniffy is put together. Services, data stores, network topology, worker fleets, multi-tenancy, permissions, encryption, search, and calls.
sidebar:
  label: Architecture
  order: 2
---

This page describes how Uniffy runs in production. Read it before sizing infrastructure, planning an upgrade, or debugging an incident.

## Topology at a glance

```
        Browser / Mobile
                |
                v
       +-----------------+         +---------------------+
       |    Backend      |<------->|     PostgreSQL      |
       |  (FastAPI +     |         +---------------------+
       |   ConnectRPC,   |         +---------------------+
       |   Granian)      |<------->|      Meilisearch    |
       +-----------------+         +---------------------+
            |    ^   |             +---------------------+
            |    |   +------------>|       Valkey        |
            v    |                 |  (queue + cache +   |
       +---------+--------+        |   pub/sub)          |
       | Core Worker (ARQ)|<------>+---------------------+
       +------------------+        +---------------------+
       +------------------+<------>|  Object storage     |
       | Egress Worker    |        |  (S3-compatible)    |
       | (ARQ)            |        +---------------------+
       +------------------+
                ^                  +---------------------+
                |                  |     LiveKit SFU     |
                +----------------->|   (media plane)     |
                                   +---------------------+
                                   +---------------------+
                                   |  coturn (optional)  |
                                   +---------------------+
```

The control plane is the **backend**. The two **worker fleets** consume queues from Valkey and do background work. Real-time chat presence and notifications fan out through Valkey pub/sub. Calls media never touches the backend; it flows directly between clients and LiveKit.

## Services

| Service | Process | Purpose |
|---|---|---|
| Backend | Granian + FastAPI + ConnectRPC | HTTP + RPC entrypoint. Auth, content CRUD, RPC handlers, search proxy, real-time streams. |
| Core worker | ARQ | Tight-SLA jobs: thumbnails, file extraction, notifications, reminders, storage hygiene, chat-mute. |
| Egress worker | ARQ | Slow / retry-heavy jobs: agent runtime, conversation compaction, cron, external API integrations. |
| PostgreSQL 18 | Database | Primary data store. All durable state. |
| Meilisearch | Search engine | Typo-tolerant full-text index for universal `@` mentions and search. |
| Valkey | Redis-compatible KV | ARQ queue, ops cache, pub/sub channels. |
| S3-compatible storage | Object store | File uploads, attachments, thumbnails. Pluggable: AWS S3, R2, B2, MinIO, RustFS. |
| LiveKit | SFU | Audio and video calls. Forwards media between participants. |
| coturn | TURN relay | Optional. NAT traversal for WebRTC when direct paths fail. |
| Frontend | Vite + React 19 | Single-page app served as static assets. |
| Mobile | Expo + React Native | iOS and Android client. Hits the same RPC endpoints. |
| Landing + docs | Astro + Starlight | Marketing site and these docs. |

## API layer

Uniffy uses **ConnectRPC** (Protocol Buffers + Connect) for all client-server communication. Proto definitions in `src/proto/` are the source of truth; generated clients in Python, TypeScript, and Go are shared via workspace packages (`uniffy-proto`, `@uniffy/proto`, `uniffy-proto-go`).

Implications for operators:

- All endpoints look the same to a reverse proxy: HTTP POST to a service path with JSON or binary protobuf bodies.
- No REST contract to version. Versioning lives in proto namespaces (`users.v1`, `notes.v2`).
- Compatibility is enforced by `buf` in CI.

## Domain-driven vertical slices

Each feature is self-contained:

- **Backend**: `src/uniffy/domains/{feature}/` with `operations`, `handlers`, `service`, `converters`.
- **Frontend**: `src/ui/src/features/{feature}/` with `api`, `store`, `components`, `pages`, `hooks`.
- **Proto**: `src/proto/{service}/v1/{service}.proto` defines the contract.

This means most changes touch a single domain. Cross-cutting work (search indexing, permissions, audit) goes through shared modules under `src/uniffy/core/`.

## Worker fleet split

Two ARQ workers run as separate processes (or separate Kubernetes Deployments). One image, two entrypoints:

```sh
python -m uniffy --worker-core
python -m uniffy --worker-egress
```

| Fleet | Default concurrency | Default timeout | Typical work |
|---|---|---|---|
| Core | 10 jobs / process | 300s | Image thumbnails, document text extraction, push notifications, reminder dispatch, storage GC, chat-mute fan-out. |
| Egress | 50 jobs / process | 900s | Agent runtime, long-running LLM calls, conversation compaction, cron, future webhook delivery. |

The split exists so a slow third-party LLM call cannot starve the local-I/O fleet. Scale them independently: core scales with user activity, egress scales with agent usage.

## Data stores

### PostgreSQL

All durable state. Async only (`asyncpg`). Migrations run on backend startup.

Connection budget per pod is `WORKERS * (DB_POOL_SIZE + DB_MAX_OVERFLOW)`. With the defaults (`WORKERS=1`, pool 30, overflow 70) that is 100 connections per backend pod. Workers reuse the same pool sizing. Size Postgres `max_connections` accordingly:

```
max_connections >= n_backend_pods * 100
                 + n_core_worker_pods * 100
                 + n_egress_worker_pods * 100
                 + headroom for pgbouncer / psql
```

In production, run Postgres with sane defaults: `shared_buffers ~25%` of RAM, `effective_cache_size ~75%`, `work_mem` per-connection sized to your query patterns.

### Meilisearch

Indexes every piece of content that has a URN. The backend writes during normal operations and reindexes through a background job when schema changes ship. Treat the Meilisearch DB as reproducible: a full reindex from Postgres is supported and safe.

Required for: universal `@` mention search, global search, filter prefixes.

### Valkey (Redis-compatible)

Three roles, each with its own connection profile baked into code:

| Tier | Profile | Used by |
|---|---|---|
| ARQ queue | 10s timeout, 5 retries, 1s delay | Background job dequeue. |
| Pub/Sub | 5s timeout, retry on transient, 30s health check | Chat presence, notification fan-out, live updates. |
| Ops cache | 200ms connect, 100ms read, 0 retries, 150ms deadline guard | Permission cache, agent context, provider cache. Misses are silently treated as cache-misses when Valkey is slow. |

The 150ms deadline guard means a slow Valkey degrades the cache, not the user request. This is intentional.

LiveKit uses a separate Valkey database (`LIVEKIT_VALKEY_DATABASE=1` by default) so room registry pressure does not collide with the app's caches.

### Object storage

Any S3-compatible service. Backend signs PUT URLs for direct browser-to-storage uploads; the file content never traverses the backend. Files are addressed by `(bucket, key)` and tracked in Postgres for permissions and search indexing.

## Multi-tenancy

Every content row carries an `organization_id`. Users are global; org membership is per-org. All RPCs derive the active org from the auth token and pass it into operations.

Cross-org access is prevented at three layers:

1. RPC handlers reject calls outside the user's org.
2. Operations always include `organization_id` in WHERE clauses.
3. `PermissionChecker` short-circuits on org mismatch before any role resolution.

## Permissions

Every content row has:

- `access_mode`: `OWNER_ONLY`, `EXPLICIT_MEMBERS`, or `OPEN_TO_ORG`.
- `baseline_role`: only meaningful with `OPEN_TO_ORG`. Sets the floor role for org members.

Explicit grants live in `permissions_content_members` as `ContentMember` rows keyed by `(content_type, content_id, subject_type, subject_id)` with a `role`:

```
VIEWER < COMMENTER < EDITOR < ADMIN < OWNER     and a separate BLOCKED deny state.
```

`PermissionChecker.effective_role()` resolves the highest of (ownership, explicit direct/group member, baseline when `OPEN_TO_ORG`) minus any `BLOCKED` row. Org OWNER/ADMIN and per-domain `DomainAdmin` bypass the filter. Helpers `role_can_view / _comment / _edit / _delete / _manage / _transfer` gate operations.

Access-mode and member changes route through `permissions.v1.MembersService`, backed by `ContentMembersOperations`.

### Domain admins

Some users get admin status for specific domains (chat, files, calendar) without being full org admins. Stored in a shared `DomainAdmin` table with `UNIQUE (organization_id, user_id, domain)`. Access check order: org `ADMIN`/`OWNER` > domain admin > regular member.

## Encryption layers

| Layer | Key | Wrapped by | Used for |
|---|---|---|---|
| App master KEK | `APP_MASTER_KEY` (env) | Operator | Wraps every per-org DEK + app-wide secrets (VAPID private key). |
| Per-org DEK | Row in `org_encryption_keys` | App master KEK | Used by `OrgCipher` for tenant-scoped secrets (SMTP passwords, agent provider keys, future webhooks). |
| Field-level | Per-row IV + AEAD tag | Per-org DEK | Each encrypted column carries its own nonce, decrypted only when needed. |

`OrgCipher` is the only blessed entrypoint for encrypting tenant secrets. The legacy single-key path was removed. Losing `APP_MASTER_KEY` permanently locks every encrypted column in the deployment, so back it up out of band.

## URNs and search

Every content row carries a URN: `urn:uniffy:content:{TYPE}:{uuid}`.

Supported types include `NOTE`, `FILE`, `CHAT`, `USER`, `CALENDAR_EVENT`, `PROJECT`, `TASK`, `GROUP`. All content models inherit from `BaseContentOperations`, which automatically generates URNs and indexes into Meilisearch.

User-editable text is stored as Markdown with mentions of the form `[[[label|urn:uniffy:content:TYPE:uuid]]]`. Mentions render as live chips that resolve title, owner, status, and activity on every render.

## Calls (LiveKit)

Calls media flows directly between clients and LiveKit. The backend's role is:

1. Mint a short-lived LiveKit JWT for the user (signed with `LIVEKIT_API_SECRET`).
2. Create or look up the room via LiveKit's admin REST API.
3. Record call metadata in Postgres for history and permissions.

Clients use `LIVEKIT_WS_URL` to reach LiveKit's signaling. The backend uses `LIVEKIT_HOST` for the admin API (server-to-server, never exposed to browsers).

### TURN relay

Most browsers reach LiveKit's media ports directly. Behind symmetric NATs (some hotel WiFi, some enterprise networks), they cannot. `coturn` is an optional TURN relay that proxies media when direct paths fail. Off by default; bring up with the `calls-turn` profile when you see WebRTC connectivity errors in production.

The backend mints TURN credentials via the REST API pattern: `username=<expiry_ts>:<user_id>`, `password=base64(HMAC-SHA1(shared_secret, username))`. TTL should match the LiveKit JWT.

## Audit log

The audit middleware captures every state-changing RPC. Each event row records actor, org, resource, action, request IP, and timestamp.

`TRUSTED_PROXIES` controls how the client IP is derived behind a load balancer: only entries from the trusted list cause `X-Forwarded-For` to be honored; otherwise the raw socket peer wins. Default empty is the safe choice for direct-connect deployments.

`file.uploaded` is opt-in (`AUDIT_EVENTS_FILE_UPLOADED=true`) because every successful upload writes one row and that can dominate audit volume.

## Observability

| Signal | Source | How to scrape |
|---|---|---|
| Backend metrics | Prometheus client, multiprocess mode | `GET /metrics` on the backend port. |
| Core worker metrics | Prometheus client | `:9091/metrics` (`CORE_WORKER_METRICS_PORT`). |
| Egress worker metrics | Prometheus client | `:9092/metrics` (`EGRESS_WORKER_METRICS_PORT`). |
| Logs | stdout, JSON when `LOG_FORMAT=json` | Container runtime collector. |

Granian forks `WORKERS` children. Prometheus multiprocess mode is mandatory or each child only reports its own slice. The bootstrap helper in `uniffy.infrastructure.observability.bootstrap` manages a component subdirectory under `PROMETHEUS_MULTIPROC_BASE_DIR`. Override only when the container needs a different writable path.

### Worker signals

The worker metrics separate four different problems. A fleet can be reachable but not ready. It can
be ready with a growing queue. It can drain the queue while starting jobs too late. It can also reject
a job before its handler runs.

| Question | Metrics | Read it as |
|---|---|---|
| Is the fleet alive and connected? | `uniffy_worker_ready`, `uniffy_worker_last_heartbeat_timestamp_seconds`, `uniffy_worker_restarts_total` | Ready should be 1 and the heartbeat should remain newer than two health intervals. |
| Is work backing up? | `uniffy_worker_queue_depth`, `uniffy_worker_job_start_delay_seconds` | Depth is every job in the sorted set, including deferred work. Start delay is time from queue eligibility to handler start. |
| Are handlers healthy? | `uniffy_worker_jobs_started_total`, `uniffy_worker_jobs_completed_total`, `uniffy_worker_job_duration_seconds`, `uniffy_worker_jobs_in_progress` | Compare completion status and duration by queue and registered job name. Duration buckets extend through 900 seconds. |
| Are producers reaching the queue? | `uniffy_worker_job_enqueue_total` | Outcomes are `enqueued`, `deduplicated`, `unavailable`, and `error`. This metric can be emitted by the backend or a worker, depending on where dispatch happens. |
| Is ARQ refusing queued data? | `uniffy_worker_job_rejected_total` | Reasons cover expired or malformed payloads, missing functions, aborts before start, and exhausted retries. |

Every worker replica reads the same Valkey sorted set. Aggregate queue depth with `max by (queue)`,
not `sum`. Use the newest heartbeat across healthy replicas for the same reason. Counters and
histograms still aggregate with `sum`.

These PromQL examples are useful starting points. Tune the windows and thresholds for your traffic.

```text
# A fleet has no ready replica.
max by (queue) (uniffy_worker_ready) < 1

# No successful health cycle for 90 seconds.
time() - max by (queue) (uniffy_worker_last_heartbeat_timestamp_seconds) > 90

# Current backlog by fleet.
max by (queue) (uniffy_worker_queue_depth)

# 95th percentile eligibility to start delay.
histogram_quantile(
  0.95,
  sum by (le, queue) (rate(uniffy_worker_job_start_delay_seconds_bucket[5m]))
)

# Failed or retried handler attempts.
sum by (queue, status) (
  rate(uniffy_worker_jobs_completed_total{status=~"failed|retry"}[5m])
)

# Queue dispatch could not complete.
sum by (queue, outcome) (
  rate(uniffy_worker_job_enqueue_total{outcome=~"unavailable|error"}[5m])
) > 0

# Jobs rejected before handler execution.
sum by (queue, reason) (rate(uniffy_worker_job_rejected_total[5m])) > 0
```

Prometheus labels stay operational and bounded. They never include job ids, organization ids, user
ids, arguments, results, or exception messages. Use structured logs when you need one job's exact
identity or error context.

## Scaling

| Component | Bottleneck | Scaling pattern |
|---|---|---|
| Backend | CPU on RPC handlers, Postgres pool | Horizontal. Each pod is stateless. Watch Postgres connection budget. |
| Core worker | Local I/O (thumbnails, extraction) | Horizontal. Increase `CORE_WORKER_MAX_JOBS` or pod count. |
| Egress worker | External API latency, agent iteration | Horizontal. Default concurrency 50 is high on purpose. |
| PostgreSQL | Connections, write throughput | Vertical first, then read replicas (read-only queries can target replicas), then sharding by `organization_id` if you outgrow a single primary. |
| Meilisearch | RAM, index size | Vertical. Plan for full-rebuild capacity. |
| Valkey | Memory, network | Vertical, then Cluster mode for write-heavy pub/sub patterns. |
| Object storage | Provider-managed | Provider's job. Just keep buckets per environment. |
| LiveKit | Egress bandwidth | Horizontal cluster with shared Valkey-backed room registry. |

## Network ports

| Port | Component | Notes |
|---|---|---|
| 8000 | Backend HTTP | Defaults from `.env.example`. |
| 9091 | Core worker metrics | Scraped by Prometheus. |
| 9092 | Egress worker metrics | Scraped by Prometheus. |
| 5432 | PostgreSQL | Internal only. |
| 6380 | Valkey | Local dev maps to 6380 to avoid clashing with host Redis on 6379. |
| 7700 | Meilisearch | Internal only. |
| 9000 | Object storage (S3) | Local dev with RustFS. AWS/R2/B2 use provider's endpoints. |
| 7880 | LiveKit signaling (TCP/WS) | Browsers connect here. |
| 7881-7882 | LiveKit media (TCP/UDP) | UDP is preferred; cannot tunnel cleanly over SSH. |
| 3478 | TURN/STUN | Only when coturn is enabled. |
| 5349 | TURNS (TLS) | Only when coturn is enabled. |
| 5173 | Frontend dev server | Vite dev only. |
| 4321 | Landing + docs dev server | Astro dev only. |

## Boot order and health

1. PostgreSQL and Valkey come up first. Both have container healthchecks.
2. Meilisearch comes up. Its healthcheck blocks dependents until it responds.
3. Backend starts. On boot it runs Alembic migrations, then opens the listener.
4. Core and egress workers connect to Valkey and start consuming queues.
5. LiveKit and coturn are independent. They have no dependency on the backend other than shared Valkey for room registry.

A backend pod with healthy `GET /healthz` accepts traffic. Workers report liveness via ARQ's built-in health checks every `WORKER_HEALTH_CHECK_INTERVAL` seconds.

## Stateless vs stateful

| Stateless (replace freely) | Stateful (back up) |
|---|---|
| Backend, core worker, egress worker, frontend, landing, mobile. | PostgreSQL, Meilisearch, Valkey (queue depth survives restarts but cache is volatile by design), object storage, LiveKit room registry. |

Backing up Postgres is mandatory. Meilisearch can be rebuilt from Postgres in O(content) time but you will lose indexing time during the rebuild; back it up if your SLA does not tolerate that gap. Object storage and `APP_MASTER_KEY` are non-negotiable backups: lose either and data is gone.

## Where to go next

- [Configure Uniffy](/docs/deployment/configure/) for every environment variable.
- [Harden the Edge](/docs/deployment/hardening/) to keep the platform operator API off the public internet.
- [Administration Guide](/docs/administration/) for org-level configuration: members, permissions, SSO, audit, encryption.
- [User Guide](/docs/user/) for end-user features.
