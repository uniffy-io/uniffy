---
title: System Architecture
description: What a running Uniffy deployment is made of. Services, the traffic plane, data stores, worker fleets, sizing, ports, boot order, and what an operator must know to run and debug it.
sidebar:
  label: System Architecture
  order: 6
---

This page is the map a platform team needs of a running Uniffy. Read it before sizing infrastructure, planning an upgrade, or debugging an incident. How the code inside is organized is not here; this is about processes, ports, and data.

## Topology at a glance

```
                            Internet
                               |
               80/443 TCP      |      3478 UDP+TCP
                    |          |           |
                    v          |           v
           +----------------+  |  +-----------------+
           |  Envoy Gateway |  |  | STUNner Gateway |
           +----------------+  |  +-----------------+
             |      |      |             |
         /   |  /api|      | /livekit    | relayed media
             v      v      v             v
      +----------+ +---------+ +--------------------+
      | Frontend | | Backend | |    LiveKit SFU     |
      |  (nginx) | |  pods   | | (signaling+media)  |
      +----------+ +----+----+ +---------+----------+
                        |                |
        +--------+------+------+------+  | room registry
        |        |             |      |  | (valkey db 1)
        v        v             v      v  v
   +----------+ +------------+ +----+ +--------+
   | Postgres | | Meilisearch| | S3 | | Valkey |
   +----------+ +------------+ +----+ +--------+
        ^        ^              ^       ^
        |        |              |       | queue + pub/sub
      +-+--------+--------------+-------+-+
      |   Core + egress worker fleets     |
      +-----------------------------------+
```

Two things enter from the internet and nothing else: HTTP on the Envoy Gateway, calls media on the STUNner gateway. The **backend** is the control plane. The two **worker fleets** consume queues from Valkey and do background work. Realtime presence and notifications fan out through Valkey pub/sub. Calls media never touches the backend.

## Services

| Service | Runs as | Purpose |
|---|---|---|
| Envoy Gateway | Operator + managed Envoy pods | TLS termination, HTTP routing, the operator API allowlist. |
| STUNner | Operator + TURN gateway pods | Relays WebRTC media into the cluster on one UDP/TCP port. |
| Backend | Granian, 3 pods default | RPC entrypoint. Auth, content, search proxy, realtime streams, migrations on boot. |
| Core worker | ARQ, 3 pods default | Tight deadline jobs: thumbnails, text extraction, notifications, reminders, storage hygiene. |
| Egress worker | ARQ, 3 pods default | Slow or retry heavy jobs: agent runtime, LLM calls, cron, external integrations. |
| Frontend | nginx | The browser app as static assets. |
| PostgreSQL 18 | CloudNativePG cluster, or external | Primary data store. All durable state. |
| Meilisearch | Single pod | Typo tolerant index behind universal `@` mention lookup and search. |
| Valkey | Single pod | Job queue, pub/sub, operational cache. |
| Object storage | Yours (S3 compatible) | File bytes. Private network only; browsers never reach it. |
| LiveKit | Single pod, scales to a cluster | Audio and video calls. Forwards media between participants. |

## The traffic plane

Every client request is an HTTP POST to an RPC path with a JSON or binary protobuf body, plus one WebSocket for realtime and long lived streamed responses for agents. The chart encodes that into the gateway routes, and the route table is worth knowing by heart when debugging:

| Path | Goes to | Upstream protocol | Why |
|---|---|---|---|
| `/api/realtime` | backend | HTTP/1.1 | The WebSocket. Websockets over HTTP/2 are unreliable across the ecosystem, so this path is pinned down a version. |
| `/api/superadmin.v1.` | backend | h2c | Named route rule so the [operator allowlist](/docs/deployment/hardening/) can target exactly it. |
| `/api/` and `/healthz` | backend | h2c | HTTP/2 cleartext for RPC multiplexing and streaming. |
| `/livekit/` | LiveKit 7880, prefix stripped | HTTP/1.1 | Calls signaling WebSocket. |
| everything else | frontend | HTTP/1.1 | Static assets and the single page app fallback. |

The request timeout on these routes is zero and buffering is off. An agent answer is one HTTP response that streams for as long as the agent thinks. A proxy timeout or a buffer anywhere in this path turns streaming features into silent hangs, which is why the traffic plane ships as part of the product instead of as a suggestion.

## Worker fleet split

Two ARQ fleets, one image, two entrypoints:

```sh
python -m uniffy --worker-core
python -m uniffy --worker-egress
```

| Fleet | Default concurrency | Default timeout | Typical work |
|---|---|---|---|
| Core | 10 jobs per process | 300s | Thumbnails, document text extraction, push notifications, reminder dispatch, storage GC. |
| Egress | 50 jobs per process | 900s | Agent runtime, long running LLM calls, conversation compaction, cron, webhook delivery. |

The split exists so a slow third party LLM call cannot starve the local I/O fleet. Scale them independently: core scales with user activity, egress scales with agent usage.

## Data stores

### PostgreSQL

All durable state. Migrations run on backend startup; the first pod up after an upgrade applies them.

Connection budget per pod is `WORKERS * (DB_POOL_SIZE + DB_MAX_OVERFLOW)`. With the defaults (`WORKERS=1`, pool 30, overflow 70) that is 100 connections per backend pod. Worker pods use the same sizing. Size `max_connections` accordingly:

```
max_connections >= n_backend_pods * 100
                 + n_core_worker_pods * 100
                 + n_egress_worker_pods * 100
                 + headroom for pgbouncer / psql
```

The bundled CloudNativePG cluster ships sane parameters; for an external Postgres, start from `shared_buffers ~25%` of RAM and `effective_cache_size ~75%`.

### Meilisearch

The search index, and nothing but an index. The backend writes to it during normal operation and can rebuild it from Postgres entirely through a background job. Treat it as reproducible: losing the Meilisearch volume costs a reindex window, not data.

### Valkey

Three roles, each with its own connection profile baked into the code:

| Tier | Profile | Used by |
|---|---|---|
| Job queue | 10s timeout, 5 retries | Background job dispatch and dequeue. |
| Pub/sub | 5s timeout, retry on transient | Presence, notification fan out, live updates. |
| Ops cache | 150ms deadline guard, no retries | Hot presentation caches. A miss is served from Postgres. |

The deadline guard means a slow Valkey degrades into cache misses instead of stalling user requests. Authorization never reads from Valkey; permission decisions come from Postgres every time, so a poisoned or stale cache cannot extend access.

LiveKit keeps its room registry in a separate Valkey database (db 1) so registry pressure and app caches cannot evict each other.

### Object storage

Any S3 compatible service, always yours on the cluster path. Every upload and download flows through the backend, which checks permissions per request; browsers never talk to the storage endpoint, so it stays on a private network with no CORS and no public exposure. File bytes ride backend bandwidth, which is why upload heavy orgs scale backend pods, not storage networking.

## Multi-tenancy

One deployment serves many organizations. Every content row is scoped to an organization, RPC handlers derive the organization from the auth token, and the permission layer short circuits on any mismatch. A single org self hosted install is the same code with one tenant, no flags and no different binary.

The operational consequence: there is no per tenant infrastructure to provision. A new organization is a database row, not a namespace.

## Access control, the operator's view

Permissions are enforced inside the application against Postgres, not by any infrastructure component. Nothing you deploy or misdeploy at the edge grants content access, and there is no admin bypass to protect: org admins hold no skeleton key over member content, and a platform operator reaches tenant content only through a time bound, audit logged **support session** the org owner approves and can revoke. Your one infrastructure duty here is keeping the operator API off the internet, which is [one chart value](/docs/deployment/hardening/).

## Encryption and the master key

| Layer | Key | Wrapped by |
|---|---|---|
| Deployment master key | `APP_MASTER_KEY` from the secret | You. It exists only in your secret and your backup. |
| Per organization key | Row in the database | The master key. |
| Field level | Per row nonce | The organization key. |

Tenant secrets such as SMTP passwords, LLM provider keys, and identity source credentials are encrypted with the owning organization's key, which is itself wrapped by the master key. Losing `APP_MASTER_KEY` permanently locks every encrypted column in the deployment. The backup ritual is on [Backups and Restore](/docs/deployment/backups/).

## Calls

The backend's role in a call is small: mint a short lived LiveKit token, create the room over LiveKit's admin API (server to server, never exposed), and record call metadata in Postgres. Everything heavy is media, and media takes one of two paths:

- **Relayed through STUNner**, the mode both supported install paths deploy. Clients receive per user ephemeral TURN credentials minted by the backend from `TURN_SHARED_SECRET`, and all media enters the cluster through port 3478 on the media gateway. One port to firewall, one DNS record to keep honest.
- **Direct media** exists for deployments without a relay: clients hit LiveKit's media port directly and its embedded TURN covers NAT fallback. The [Configure Uniffy](/docs/deployment/configure/) TURN section covers the switch.

If the app works and calls do not, start at the media path: the TURN DNS record, port 3478 over UDP, and the shared secret matching between backend and gateway.

## Audit log

The audit middleware records every state changing RPC: actor, organization, resource, action, client IP, timestamp. `TRUSTED_PROXY_HOPS` decides which forwarded address counts as the client IP behind your edge; get it wrong and every audit row names your proxy. `file.uploaded` rows are opt in (`AUDIT_EVENTS_FILE_UPLOADED=true`) because busy orgs can generate more upload rows than everything else combined.

## Observability

| Signal | Source | How to collect |
|---|---|---|
| Backend metrics | Prometheus multiprocess | `GET /metrics` on the backend port, ServiceMonitor shipped in the chart. |
| Worker metrics | Prometheus | `:9091` core, `:9092` egress, ServiceMonitors shipped. |
| Logs | stdout, JSON in the chart defaults | Your cluster's log collector. |

Granian forks `WORKERS` children and Prometheus multiprocess mode keeps their metrics coherent; the chart configures it, so this only concerns you when overriding writable paths.

### Worker signals

The worker metrics separate four different problems. A fleet can be reachable but not ready. It can be ready with a growing queue. It can drain the queue while starting jobs too late. It can also reject a job before its handler runs.

| Question | Metrics | Read it as |
|---|---|---|
| Is the fleet alive and connected? | `uniffy_worker_ready`, `uniffy_worker_last_heartbeat_timestamp_seconds`, `uniffy_worker_restarts_total` | Ready should be 1 and the heartbeat should remain newer than two health intervals. |
| Is work backing up? | `uniffy_worker_queue_depth`, `uniffy_worker_job_start_delay_seconds` | Depth is every job in the sorted set, including deferred work. Start delay is time from queue eligibility to handler start. |
| Are handlers healthy? | `uniffy_worker_jobs_started_total`, `uniffy_worker_jobs_completed_total`, `uniffy_worker_job_duration_seconds`, `uniffy_worker_jobs_in_progress` | Compare completion status and duration by queue and registered job name. Duration buckets extend through 900 seconds. |
| Are producers reaching the queue? | `uniffy_worker_job_enqueue_total` | Outcomes are `enqueued`, `deduplicated`, `unavailable`, and `error`. Emitted by whichever process dispatched the job. |
| Is ARQ refusing queued data? | `uniffy_worker_job_rejected_total` | Reasons cover expired or malformed payloads, missing functions, aborts before start, and exhausted retries. |

Every worker replica reads the same Valkey sorted set. Aggregate queue depth with `max by (queue)`, not `sum`. Use the newest heartbeat across healthy replicas for the same reason. Counters and histograms still aggregate with `sum`.

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

Prometheus labels stay operational and bounded. They never include job ids, organization ids, user ids, arguments, results, or exception messages. Use structured logs when you need one job's exact identity or error context.

## Scaling

| Component | Bottleneck | Scaling pattern |
|---|---|---|
| Backend | CPU on RPC handlers, Postgres pool, upload bandwidth | Horizontal. Stateless pods. Watch the connection budget. |
| Core worker | Local I/O | Horizontal, or raise `CORE_WORKER_MAX_JOBS`. |
| Egress worker | External API latency | Horizontal. Default concurrency of 50 is high on purpose. |
| PostgreSQL | Connections, write throughput | Vertical first, then read replicas. |
| Meilisearch | RAM, index size | Vertical. Plan for full rebuild capacity. |
| Valkey | Memory, network | Vertical first. |
| Object storage | Provider managed | Your provider's job. |
| LiveKit | Egress bandwidth | Horizontal cluster over the shared Valkey room registry. |

## Network ports

Public, the only two entry points:

| Port | Component |
|---|---|
| 80/443 TCP | Envoy Gateway. TLS and every HTTP path. |
| 3478 UDP+TCP | STUNner. Calls media. |

Cluster internal, never exposed:

| Port | Component |
|---|---|
| 8000 | Backend HTTP (the chart maps it behind the gateway). |
| 5432 | PostgreSQL. |
| 6379 | Valkey. |
| 7700 | Meilisearch. |
| 7880 | LiveKit signaling, reached only through the `/livekit` route. |
| 7881/7882 | LiveKit media, reached only through STUNner. |
| 9091/9092 | Worker metrics, scraped in cluster. |

## Boot order and health

1. The platform operators come first: Envoy Gateway, STUNner, CloudNativePG, cert-manager where used. The install pages sequence this.
2. The data stores come up with their probes: the Postgres cluster, Valkey, Meilisearch.
3. Backend pods boot, run migrations, then open the listener. A pod answering `GET /healthz` is ready; the chart wires that into the probes, so an unhealthy pod never receives traffic.
4. Workers connect to Valkey and start consuming. Liveness rides ARQ's built in health check every `WORKER_HEALTH_CHECK_INTERVAL` seconds and the heartbeat metric.
5. LiveKit is independent of the backend; they share only the Valkey room registry.

## Stateless vs stateful

| Stateless, replace freely | Stateful, back up |
|---|---|
| Backend, both worker fleets, frontend, gateway pods, STUNner pods. | PostgreSQL, object storage, `APP_MASTER_KEY`. |
| | Meilisearch and Valkey sit in between: losing them costs a reindex window and a queue drain, not data. |

Postgres, the master key, and object storage are the non negotiable three. [Backups and Restore](/docs/deployment/backups/) covers all of them, including the continuous archive that makes Postgres restorable to a point in time.

## Where to go next

- [Configure Uniffy](/docs/deployment/configure/) for every environment variable.
- [Harden the Edge](/docs/deployment/hardening/) for the operator API allowlist.
- [Behind an Edge](/docs/deployment/edges/) before putting Cloudflare or a corporate proxy in front.
- [Upgrades](/docs/deployment/upgrades/) and [Backups and Restore](/docs/deployment/backups/) for day two.
