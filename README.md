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

- Migrations run automatically on backend startup.


## System Architecture

```
                        +---------+
                        | Browser |
                        +----+----+
                             |
              +--------------+--------------+
              |                             |
              v                             v
        +-----------+               +-----------+
        | Frontend  |  ConnectRPC   |  Backend  |
        | React     +-------------->|  FastAPI  |
        +-----------+               +-----+-----+
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
