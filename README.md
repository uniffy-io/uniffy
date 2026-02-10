# Uniffy

A unified workspace where notes, files, chat, AI assistants, calendar, and workflows exist in one application. Every piece of information can be referenced from anywhere using universal `@` mentions.

## Table of Contents

- [Documentation](#documentation)
- [Development](#development)
  - [Prerequisites](#prerequisites)
  - [Setup](#setup)
- [System Architecture](#system-architecture)

## Documentation

- [Sharing and Permissions](docs/documentation/SHARING.md)
- [Search](docs/documentation/SEARCHING.md)
- [Transparency](docs/TRANSPARENCY.md)
- [Licenses](docs/LICENSES.md)

## Development

### Prerequisites

- Python 3.13+
- Node.js 24+ with pnpm
- Docker and Docker Compose
- [uv](https://github.com/astral-sh/uv) (Python package manager)
- [buf](https://buf.build/) (Protocol Buffer compiler)

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
