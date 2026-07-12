# Uniffy

> **Teamwork. Simplified, amplified, unified.**  

A unified workspace where notes, files, chat, AI assistants, calendar, and workflows exist in one application. Every piece of information can be referenced from anywhere using universal `@` mentions. Fully private. No trackers, no advertasing, no data harvesting, no training on your data.  OPT-IN AI Agents inside your work workspace configured and controlled by you. You choose the model, skills, permissions, and behavior. 

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

- Setup

```bash
git clone git@github.com:uniffy-io/uniffy.git
cd uniffy
cp .env.example .env
# Set JWT_SECRET_KEY (generate with: openssl rand -hex 32)
```


#### Start Developing

Uniffy supports development fully in docker, and that is the recommended mode for supply-chain safety. Dependencies are resolved, installed, and executed only inside containers. A compromised npm or PyPI release never runs code on your machine, so it cannot reach your shell profile, ssh keys, browser sessions, or anything else outside a throwaway container. Two more guards apply everywhere: package install scripts are blocked by default (`allowBuilds` in `pnpm-workspace.yaml`), and new package versions are refused until they are at least 5 days old (`minimumReleaseAge`), which gives poisoned releases time to be caught and pulled before they can ever be installed.

You can also run only the infrastructure in docker and develop natively on the host with uv and pnpm. This is handy for editor integration, but understand the tradeoff: package code executes on your host. The lockfile review and the two guards above still apply, the container isolation does not.

Editor IntelliSense does not require the native mode. The repo ships a dev container (`.devcontainer/`) that attaches your editor to a container holding the full workspace `node_modules` and `.venv`, so pyright, tsserver, ruff, and eslint all resolve from inside it:

- **VS Code**: install the "Dev Containers" extension, open the repo, accept the "Reopen in Container" popup (or run "Dev Containers: Reopen in Container" from the command palette).
- **Zed** (v0.218+): open the repo and accept the dev container prompt, or run "Project: Open Remote" from the command palette and choose "Connect Dev Container". Docker must be in your PATH.

Both modes support hot reload in the backend and the ui. Every command below is a `./manage.py` subcommand; `--help` on any level shows the full tree.

##### Everything in docker (nothing installed on the host)

```bash
./manage.py start --stack docker              # build images, install deps in volumes, run the stack
./manage.py start --stack docker -p mobile    # same, plus the expo/metro dev server on :8081
./manage.py stack down                        # stop everything
```

View logs:

```bash
./manage.py logs --stack docker               # all services combined
./manage.py logs --stack docker -s backend    # one service: backend, ui, landing, mobile,
./manage.py logs --stack docker -s postgres   #   worker-core, worker-egress, postgres, livekit, ...
```

Manage dependencies (resolution runs inside the containers; package.json / lockfiles change in your working tree as usual):

```bash
./manage.py deps add httpx -s backend --stack docker
./manage.py deps add zod -s ui --stack docker
./manage.py deps update @tanstack/react-query -s mobile --stack docker
./manage.py deps install --stack docker       # sync every workspace from the lockfiles
```

Quality and codegen, containerized:

```bash
./manage.py lint --stack docker
./manage.py test --stack docker
./manage.py proto --stack docker              # runs in the toolbox container
```

##### Native on the host (infra stays in docker)

```bash
./manage.py start --stack local  # installs host deps if missing, infra up, backend + workers + vite
./manage.py serve backend        # or run individual processes in separate terminals:
./manage.py serve ui             #   backend, worker-core, worker-egress, ui, landing, mobile
```

View logs:

```bash
./manage.py logs --stack local              # host processes started by `start --stack local` / `serve all`
./manage.py logs --stack local -s backend   # one process: backend, worker-core, worker-egress
./manage.py logs --stack docker -s postgres # infra logs still come from docker
```

Manage dependencies with the host toolchains:

```bash
./manage.py deps install --stack local
./manage.py deps add httpx -s backend --stack local
./manage.py deps update @tanstack/react-query -s mobile --stack local
./manage.py lint --stack local && ./manage.py test --stack local
./manage.py proto --stack local             # needs buf, node, and the venv on the host
```

##### Data and profiles

Reset the data services without killing the dev stack. Wipes Postgres, Valkey, Meilisearch, and RustFS volumes; restarts backend + workers so they re-run migrations against the empty Postgres. UI / landing keep running.

```bash
./manage.py stack reset-data    # one-shot helper with confirmation prompt
```

Profiles are independent building blocks. Stack them to compose an environment:

```bash
docker compose --profile core --profile dev up        # infra + app (== ./manage.py stack up)
docker compose --profile core --profile adminuis up   # infra + db inspection UIs
docker compose --profile all up                       # everything
```

## Repository Structure

Uniffy is a monorepo managed with [uv](https://github.com/astral-sh/uv) (Python) and [pnpm workspaces](https://pnpm.io/workspaces) (TypeScript). Protocol Buffer definitions in `src/proto/` are the single source of truth for all API contracts. A single `./manage.py proto` generates code for all three languages into shared packages.

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
    unictl/             Go CLI for Uniffy
  pyproject.toml        uv workspace root
  pnpm-workspace.yaml   pnpm workspace root
  buf.gen.yaml          Codegen config (all languages, single pass)
  manage.py             All project commands (uv-run click CLI)
```

| Package | Language | Consumed by | Resolution |
|---------|----------|-------------|------------|
| `uniffy-proto` | Python | backend | `uv sync` (workspace) |
| `@uniffy/proto` | TypeScript | ui, mobile | `pnpm install` (workspace) |
| `uniffy-proto-go` | Go | CLI | `go mod` (replace directive) |

## System Architecture

- For production deployments, it is recommended to support HTTP/2 at all levels of the stack. This is especially important for large deployments, as ConnectRPC benefits significantly from HTTP/2 multiplexing to avoid head-of-line blocking and reduce connection overhead.

- **Note on Valkey:** While Redis should in theory work as a drop-in replacement for Valkey, this has not been tested and is not recommended by us. We only support and test against Valkey.

- **Note on Calls:** LiveKit is the SFU for audio/video/screen. It reuses the existing Valkey on a separate database (DB 1; the app uses DB 0) for its room registry. All app traffic and call signaling enter through the same reverse proxy on a single TLS endpoint; the proxy routes `/livekit/*` to the LiveKit signaling port. WebRTC media (UDP 7882) cannot ride HTTP and connects directly from client to LiveKit. LiveKit's embedded TURN (UDP 3478) provides NAT traversal, so there is no separate coturn service.

```
        +--------------+    +-----------+    +-------+
        | Browser      |    | Mobile    |    |  CLI  |
        | (React)      |    | (Expo/RN) |    +---+---+
        +------+-------+    +-----+-----+        |
               |                  |              |
               +--------+---------+--------+-----+
                        |
                  HTTP/2 + WebSocket (443/tcp) | 7882/udp ( WebRTC Media ) 
                        |                      | 3478/udp ( LiveKit embedded TURN )
                        |                      |
                        |                      |
                        |                      |
                        v                      |
              +--------------------+           |
              | Reverse Proxy      |  :443     |
              | (Caddy / Envoy)    |           |
              +--+--------------+--+           |
                 |              |              |
                 | h2c          | /livekit/*   |
                 v              v              |
           +-----------+   +-----------+       v
           |  Backend  |<--| LiveKit   | <-7882/udp (media, direct)
           |  FastAPI  |   |    SFU    |
           +-----+-----+   +-----+-----+
                 |               
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
