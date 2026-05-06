# Uniffy

A unified workspace where notes, files, chat, AI assistants, calendar, and workflows exist in one application. Every piece of information can be referenced from anywhere using universal `@` mentions.

## Table of Contents

- [Documentation](#documentation)
- [Development](#development)
  - [Prerequisites](#prerequisites)
  - [Setup](#setup)
- [Repository Structure](#repository-structure)
- [System Architecture](#system-architecture)

## Documentation

- [Sharing and Permissions](docs/documentation/SHARING.md)
- [Search](docs/documentation/SEARCHING.md)
- [Transparency](docs/TRANSPARENCY.md)
- [Licenses](docs/LICENSES.md)

## Development

### Prerequisites

- Python 3.14+
- Node.js 24+ with pnpm (>=9)
- Docker and Docker Compose
- [uv](https://github.com/astral-sh/uv) (Python package manager)
- [buf](https://buf.build/) (Protocol Buffer compiler)
- Go 1.23+ (optional, for CLI development and proto generation)

### Setup

- Clone 

```bash
git clone git@github.com:uniffy-io/uniffy.git
cd uniffy
./run.sh install
```

- Configure the environment (once)

```bash
cp .env.example .env
# Set JWT_SECRET_KEY (generate with: openssl rand -hex 32)
```

#### Start Developing

- first time run

```bash
docker compose up -d # Start the infra (postgres, valkey, meilisearch, rustfs, livekit, admin UIs)
docker compose --profile dev up -d # Start the dev stack (backend + workers + ui + landing, all in containers, all hot-reload)
####### !! ############
docker compose logs -f backend worker-core worker-egress ui landing # start watching the logs of all Uniffy services
####### Usually here it takes 5 minutes on the first run while dependencies install ###########
```

- Stop

```bash
docker compose --profile dev down              # stops dev services + infra
docker compose --profile dev stop backend ui   # stop a subset, keep the rest
```

- Endpoints

  | What              | URL                     |
  |-------------------|-------------------------|
  | Backend API       | http://localhost:8000   |
  | Frontend (UI)     | http://localhost:5173   |
  | Landing           | http://localhost:4321   |
  | LiveKit signaling | ws://localhost:7880     |
  | Postgres          | localhost:5432          |
  | Valkey            | localhost:6380          |
  | Meilisearch       | http://localhost:7700   |
  | RustFS (S3)       | http://localhost:9000   |
  | pgAdmin           | http://localhost:5050   |
  | RedisInsight      | http://localhost:5540   |

- Reset the data services without killing the dev stack. Wipes Postgres, Valkey, Meilisearch, and RustFS volumes; restarts backend + workers so they re-run migrations against the empty Postgres. UI / landing keep running.

```bash
./run.sh data-reset    # one-shot helper with confirmation prompt

# or step-by-step manually:
docker compose stop postgres valkey meilisearch rustfs
docker compose rm -f postgres valkey meilisearch rustfs
docker volume rm \
  uniffy-local_postgres_data \
  uniffy-local_valkey_data \
  uniffy-local_meilisearch_data \
  uniffy-local_rustfs_data \
  uniffy-local_rustfs_logs
docker compose up -d postgres valkey meilisearch rustfs
docker compose restart backend worker-core worker-egress
```

- Rebuild dev images after a Dockerfile change

```bash
docker compose --profile dev build --no-cache backend ui
```

#### Compose Layout

Compose layout (modular, top-level `docker-compose.yml` only `include`s the rest):

```
.docker/compose/
  core.yaml          postgres, valkey, meilisearch
  storage.yaml       rustfs (S3-compatible)
  admin.yaml         pgadmin, redisinsight
  calls.yaml         livekit (always on), coturn (profile: calls-turn)
  dev-tools.yaml     mcp-playwright (profile: dev)
  dev.yaml           backend, worker-core, worker-egress, ui, landing (profile: dev)
```

Run any subset directly: `docker compose -f .docker/compose/calls.yaml up`.

Opt-in profiles

```bash
docker compose --profile calls-turn up -d coturn   # TURN relay for cross-NAT testing
```

#### Other targets

```bash
./run.sh proto              # regenerate protobuf after editing .proto files
./run.sh lint               # run all linters
./run.sh test               # backend tests
./run.sh test-frontend      # frontend tests
./run.sh dev-native         # legacy: run python/node on host (infra still in containers)
```

## Repository Structure

Uniffy is a monorepo managed with [uv](https://github.com/astral-sh/uv) (Python) and [pnpm workspaces](https://pnpm.io/workspaces) (TypeScript). Protocol Buffer definitions in `src/proto/` are the single source of truth for all API contracts. A single `./run.sh proto` generates code for all three languages into shared packages.

```
uniffy/
  src/
    proto/              Source .proto definitions
    gen/
      python/           uniffy-proto    (uv workspace member)
      typescript/       @uniffy/proto   (pnpm workspace member)
      go/               Go module for future CLI
    uniffy/             Python backend  (FastAPI + ConnectRPC)
    ui/                 React web app   (Vite + Redux + Tailwind)
    mobile/             React Native    (Expo)
  pyproject.toml        uv workspace root
  pnpm-workspace.yaml   pnpm workspace root
  buf.gen.yaml          Codegen config (all languages, single pass)
  run.sh                All project commands
```

| Package | Language | Consumed by | Resolution |
|---------|----------|-------------|------------|
| `uniffy-proto` | Python | backend | `uv sync` (workspace) |
| `@uniffy/proto` | TypeScript | ui, mobile | `pnpm install` (workspace) |
| `uniffy-proto-go` | Go | future CLI | `go mod` (replace directive) |

## System Architecture

- For production deployments, it is recommended to support HTTP/2 at all levels of the stack. This is especially important for large deployments, as ConnectRPC benefits significantly from HTTP/2 multiplexing to avoid head-of-line blocking and reduce connection overhead.

- **Note on Valkey:** While Redis should in theory work as a drop-in replacement for Valkey, this has not been tested and is not recommended by us. We only support and test against Valkey.

- **Note on Calls:** LiveKit is the SFU for audio/video/screen. It reuses the existing Valkey on a separate database (DB 1; the app uses DB 0) for its room registry. All app traffic and call signaling enter through the same reverse proxy on a single TLS endpoint; the proxy routes `/livekit/*` to the LiveKit signaling port. WebRTC media (UDP 7882) cannot ride HTTP and connects directly from client to LiveKit. coturn provides TURN/STUN for NAT traversal and is opt-in.

```
        +--------------+    +-----------+    +-------+
        | Browser      |    | Mobile    |    |  CLI  |
        | (React)      |    | (Expo/RN) |    +---+---+
        +------+-------+    +-----+-----+        |
               |                  |              |
               +--------+---------+--------+-----+
                        |
                  HTTP/2 + WebSocket (443/tcp) | 7882/udp ( WebRTC Media ) 
                        |                      | 3478/udp ( TURN/STUN opt-in NAT relay)
                        |                      |
                        |                      |
                        |                      |
                        v                      |
              +--------------------+           |
              | Reverse Proxy      |  :443     |
              | (Caddy / Nginx)    |           |
              +--+--------------+--+           |
                 |              |              |
                 | h2c          | /livekit/*   |
                 v              v              |
           +-----------+   +-----------+       v
           |  Backend  |<--| LiveKit   |  :7882/udp (media, direct)
           |  FastAPI  |   |    SFU    |
           +-----+-----+   +-----+-----+
                 |               |
                 |               +-- WebRTC media (UDP 7882, direct from clients)
                 |               +-- coturn :3478/udp (opt-in TURN relay)
                 |
   +-------------+----+-----------+----------+
   |                  |           |          |
   v                  v           v          v
+----------+   +-----------+  +-----------+  +---------+
| Postgres |   |Meilisearch|  | Valkey    |  | RustFS  |
| Database |   | Search    |  | DB 0: app |  | Storage |
|          |   |           |  | DB 1: LK  |  |         |
+----------+   +-----------+  +-----+-----+  +---------+
                                    |
                                    v
                              +-----------+
                              | Workers   |
                              | core +    |
                              | egress    |
                              +-----------+
```

LiveKit fires webhooks back to backend on call lifecycle events (room started, participant joined, recording finished, etc.) which the calls domain projects into Postgres.
