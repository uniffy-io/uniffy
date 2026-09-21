---
title: System Architecture
description: What a running Uniffy deployment is made of. Services, the traffic plane, data stores, worker fleets, sizing, ports, boot order, and what an operator must know to run and debug it.
sidebar:
  label: System Architecture
  order: 7
---

This page maps Uniffy's services, storage, and traffic. Read it before sizing infrastructure, planning an upgrade, or debugging an incident.

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
      | Core + egress + media workers     |
      +-----------------------------------+
```

Two things enter from the internet and nothing else: HTTP on the Envoy Gateway, calls media on the STUNner gateway. The **backend** is the control plane. Three **worker fleets** consume queues from Valkey and do background work. Realtime presence and notifications fan out through Valkey pub/sub. Calls media never touches the backend.

One deployment serves any number of organizations. A new organization is a database row, not new infrastructure.

## Services

| Service | Runs as | Purpose |
|---|---|---|
| Envoy Gateway | Operator + managed Envoy pods | TLS termination, HTTP routing, the operator API allowlist. |
| STUNner | Operator + TURN gateway pods | Relays WebRTC media into the cluster on one UDP/TCP port. |
| Backend | Granian, 3 pods default | RPC entrypoint. Auth, content, search proxy, realtime streams, migrations on boot. |
| Core worker | ARQ | Notifications, reminders, storage cleanup and recovery schedules. |
| Egress worker | ARQ, 3 pods default | Slow or retry heavy jobs: agent runtime, LLM calls, cron, external integrations. |
| Media worker | ARQ, separate image | Video conversion, thumbnails, metadata and document extraction. Independent CPU, memory and scratch limits. |
| Frontend | nginx | The browser app as static assets. |
| PostgreSQL 18 | CloudNativePG cluster, or external | Primary data store. All durable state. |
| Meilisearch | Single pod | Typo tolerant index behind universal `@` mention lookup and search. |
| Valkey | Single pod | Job queue, pub/sub, operational cache. |
| Object storage | Yours (S3 compatible) | File bytes. Private network only; browsers never reach it. |
| LiveKit | Single pod, scales to a cluster | Audio and video calls. Forwards media between participants. |

## The traffic plane

RPCs use HTTP POST with JSON or binary protobuf bodies. File downloads and video playback use authenticated HTTP GET requests, including byte ranges for seeking. Realtime uses a WebSocket, and agent responses stream over HTTP. The gateway routes these paths:

| Path | Goes to | Upstream protocol | Why |
|---|---|---|---|
| `/api/realtime` | backend | HTTP/1.1 | WebSocket upgrades need HTTP/1.1 on this route. |
| `/api/superadmin.v1.` | backend | h2c | Named route rule so the [operator allowlist](/docs/deployment/hardening/) can target exactly it. |
| `/api/` and `/healthz` | backend | h2c | HTTP/2 cleartext for RPC multiplexing and streaming. |
| `/livekit/` | LiveKit 7880, prefix stripped | HTTP/1.1 | Calls signaling WebSocket. |
| everything else | frontend | HTTP/1.1 | Static assets and the single page app fallback. |

The request timeout on these routes is zero and buffering is off. An agent answer is one HTTP response that streams for as long as the agent thinks. A proxy timeout or a buffer anywhere in this path turns streaming features into silent hangs, which is why the traffic plane ships as part of the product instead of as a suggestion.

## Worker fleet split

Core and egress use the backend image. Media uses `ghcr.io/uniffy-io/uniffy-media-worker`, which adds FFmpeg and ffprobe. All images use the same release tag.

```text
                      Valkey queues
                            |
          +-----------------+-----------------+
          v                 v                 v
  +---------------+ +---------------+ +---------------+
  | Core workers  | | Egress workers| | Media workers |
  | Backend image | | Backend image| | Media image   |
  +---------------+ +---------------+ +-------+-------+
                                              |
                                              v
                                      +---------------+
                                      | Disk emptyDir |
                                      | Source/output |
                                      +---------------+

  All fleets connect to shared data stores.
  Object storage holds originals and completed playback copies.
```

| Fleet | Default concurrency | Default timeout | Typical work |
|---|---|---|---|
| Core | 10 jobs per process | 300s | Push notifications, reminder dispatch, storage cleanup and recovery schedules. |
| Egress | 50 jobs per process | 900s | Agent runtime, long running LLM calls, conversation compaction, cron, webhook delivery. |
| Media | 2 jobs per process | 300s, longer for video | Video conversion, thumbnails, metadata and document text extraction. |

Separate queues keep slow LLM calls and media processing from occupying core worker slots. Scale core with user activity, egress with agent usage, and media with processing demand. LiveKit carries live calls independently of these queues.

Media accepts two jobs per process by default, with one video encode slot per process. Run one media worker process per pod. Each replica adds its own encode slots, so more pods can process more videos at once. Raise concurrency within a pod only with enough CPU, memory and disk space. Allow for database connections across all replicas. PDF and Office parsers also remain in the backend image for direct agent document reads.

Media workers need writable disk scratch, not a persistent volume. Video sources up to 8 GiB stay in object storage and are read through Range requests. Each conversion writes one MP4 capped at 4 GiB. Video thumbnails need no source file on disk. Jobs reserve output space before starting and defer when scratch is full. [Configure Uniffy](/docs/deployment/configure/#media-scratch-on-kubernetes) gives a 16 GiB `emptyDir` example for two encode slots per pod.

## Data stores

### PostgreSQL

All durable state. Migrations run on backend startup; the first pod up after an upgrade applies them.

Connection budget per pod is `WORKERS * (DB_POOL_SIZE + DB_MAX_OVERFLOW)`. With the defaults (`WORKERS=1`, pool 30, overflow 70) that is 100 connections per backend pod. Worker pods use the same sizing. Size `max_connections` accordingly:

```
max_connections >= n_backend_pods * 100
                 + n_core_worker_pods * 100
                 + n_egress_worker_pods * 100
                 + n_media_worker_pods * 100
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

Storage includes uploaded originals, retained file versions, thumbnails, and completed playback copies. Budget for those copies alongside original uploads. Worker scratch holds temporary conversion outputs and other temporary work; it is not the file store.

## Scaling

| Component | Bottleneck | Scaling pattern |
|---|---|---|
| Backend | CPU on RPC handlers, Postgres pool, upload bandwidth | Horizontal. Stateless pods. Watch the connection budget. |
| Core worker | Local I/O | Horizontal, or raise `CORE_WORKER_MAX_JOBS`. |
| Egress worker | External API latency | Horizontal. Default concurrency of 50 is high on purpose. |
| Media worker | CPU, memory, scratch capacity and disk I/O | Horizontal. Each pod adds its own encode slots. Size resources and scratch for each pod's concurrency. |
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
| 9091/9092/9093 | Core, egress and media worker metrics. |

## Boot order and health

1. The platform operators come first: Envoy Gateway, STUNner, CloudNativePG, cert-manager where used. The install pages sequence this.
2. The data stores come up with their probes: the Postgres cluster, Valkey, Meilisearch.
3. Backend pods boot, run migrations, then open the listener. A pod answering `GET /healthz` is ready; the chart wires that into the probes, so an unhealthy pod never receives traffic.
4. Workers connect to Valkey and start consuming. Liveness rides ARQ's built in health check every `WORKER_HEALTH_CHECK_INTERVAL` seconds.
5. LiveKit is independent of the backend; they share only the Valkey room registry.

## Stateless vs stateful

| Stateless, replace freely | Stateful, back up |
|---|---|
| Backend, worker fleets, frontend, gateway pods, STUNner pods. | PostgreSQL, object storage, `APP_MASTER_KEY`. |
| | Meilisearch and Valkey sit in between: losing them costs a reindex window and a queue drain, not data. |

Postgres, the master key, and object storage are the non negotiable three. [Backups and Restore](/docs/deployment/backups/) covers all of them, including the continuous archive that makes Postgres restorable to a point in time.

Losing a media pod can interrupt processing. Its scratch files can be discarded. Durable pending video work is recovered from PostgreSQL and retried from object storage after any active claim expires; recovery is not immediate.

## Where to go next

- [Configure Uniffy](/docs/deployment/configure/) for every environment variable.
- [Harden the Edge](/docs/deployment/hardening/) for the operator API allowlist.
- [Behind an Edge](/docs/deployment/edges/) before putting Cloudflare or a corporate proxy in front.
- [Upgrades](/docs/deployment/upgrades/) and [Backups and Restore](/docs/deployment/backups/) for day two.
