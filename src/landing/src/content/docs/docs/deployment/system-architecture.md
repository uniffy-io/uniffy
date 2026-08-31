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

One deployment serves any number of organizations. A new organization is a database row, not new infrastructure.

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

Two ARQ fleets run from the one backend image:

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

Carries three loads: the job queue, pub/sub fan out for realtime, and a hot cache. Cache reads run under a 150ms deadline, so a slow Valkey degrades into cache misses instead of stalling user requests, and authorization never reads from it; permission decisions come from Postgres every time.

LiveKit keeps its room registry in a separate Valkey database (db 1) so registry pressure and app caches cannot evict each other.

### Object storage

Any S3 compatible service, always yours on the cluster path. Every upload and download flows through the backend, which checks permissions per request; browsers never talk to the storage endpoint, so it stays on a private network with no CORS and no public exposure. File bytes ride backend bandwidth, which is why upload heavy orgs scale backend pods, not storage networking.

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
| LiveKit | Egress bandwidth, CPU per room | See below; a room lives on one node. |

### Scaling LiveKit

The unit of LiveKit scaling is the room, not the participant. Raising `livekit.replicas` puts the pods in distributed mode over the shared Valkey registry and spreads rooms across them, so many concurrent calls scale horizontally. One giant call does not: a room is homed on a single pod, and its ceiling is that pod's CPU and bandwidth. If your usage pattern is all hands meetings rather than many small calls, scale the LiveKit pods vertically and put them on your fastest network nodes.

Bandwidth math is what actually bites. An SFU forwards every publisher's stream to every subscriber, so a 20 person call with cameras on multiplies quickly, and screen shares are the expensive stream. The org level screen share quality ceiling (`CALLS_DEFAULT_SCREEN_SHARE_QUALITY`, default `BALANCED`) exists exactly to protect a modest media node; raise it when the node has bandwidth to spare, not before. For load numbers per core, defer to LiveKit's own benchmarks; our wiring adds STUNner in the media path, which shifts relay bandwidth onto the gateway pods, and those scale horizontally as ordinary stateless workloads.

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
4. Workers connect to Valkey and start consuming. Liveness rides ARQ's built in health check every `WORKER_HEALTH_CHECK_INTERVAL` seconds.
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
