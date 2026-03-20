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

- Configure the environment

```bash
cp .env.example .env
# Set JWT_SECRET_KEY (generate with: openssl rand -hex 32)
```

- Start the infrastructure stack

```bash
docker compose up -d
```

- Start the services

```bash
./run.sh backend
./run.sh ui dev
./run.sh worker-dev

# if you don't want to run all on separate terminals
# you can launch all service from a single command
./run.sh dev
```

- Migrations run automatically on backend startup.

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

```
               +--------------+       +-------+
               | Browser      |       |  TUI  |
               | (React)      |       +---+---+
               +------+-------+           |
                      |                   |
                      +--------+----------+
                               |
                             HTTP/2
                               |
                               v
                     +--------------------+
                     | Reverse Proxy      |
                     | (Caddy / Envoy)    |
                     +--------+-----------+
                              |
                          h2c (HTTP/2
                          plain text)
                              |
                              v
                        +-----------+
                        |  Backend  |
                        |  FastAPI  |
                        +-----+-----+
                              |
        +-------------+-------------+-------------+
        |             |             |             |
        v             v             v             v
  +----------+  +------------+  +--------+  +---------+
  | Postgres |  | Meilisearch|  | Valkey |  | RustFS  |
  | Database |  | Search     |  | Queue  |  | Storage |
  +----------+  +------------+  +----+---+  +---------+
                                     |
                                     v
                               +-----------+
                               |  Worker   |
                               | (bg jobs) |
                               +-----------+
```
