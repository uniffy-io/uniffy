# Uniffy

A unified workspace where notes, files, chat, AI assistants, calendar, and workflows exist in one application. Every piece of information can be referenced from anywhere using universal `@` mentions.

For the full vision, see [docs/uniffy-concept.md](docs/uniffy-concept.md).

## Prerequisites

- Python 3.13+
- Node.js 24+ with pnpm
- Docker and Docker Compose
- [uv](https://github.com/astral-sh/uv) (Python package manager)
- [buf](https://buf.build/) (Protocol Buffer compiler)

## Setup

```bash
git clone git@github.com:uniffy-io/uniffy.git
cd uniffy
./run.sh install
```

Configure environment:

```bash
cp .env.example .env
# Set JWT_SECRET_KEY (generate with: openssl rand -hex 32)
```

Start the database:

```bash
./run.sh db-up
```

Run the application:

```bash
./run.sh dev        # Backend + Frontend
# or separately:
./run.sh run        # Backend only (localhost:8000)
./run.sh ui         # Frontend only (localhost:5173)
```

Migrations run automatically on startup.

## Tech Stack

| Layer    | Technology                                      |
|----------|-------------------------------------------------|
| Backend  | Python, FastAPI, SQLModel, asyncpg              |
| Database | PostgreSQL 18 (async only)                      |
| Frontend | React, TypeScript, Vite                         |
| API      | ConnectRPC (Protocol Buffers + Connect)         |
| Auth     | JWT, bcrypt, SSO-ready (SAML/OIDC)              |

## Project Structure

```
src/
├── proto/              # Protocol Buffer definitions
│   ├── auth/v1/
│   ├── notes/v1/
│   └── search/v1/
├── ui/                 # React frontend
│   └── src/
│       ├── components/
│       ├── features/
│       └── gen/        # Generated ConnectRPC clients
└── uniffy/               # Python backend
    ├── core/           # Shared utilities, auth, content mixins
    ├── db/             # Database session, migrations
    ├── domains/        # Domain modules (auth, notes, etc.)
    ├── gen/            # Generated ConnectRPC services
    └── factory.py      # FastAPI app factory
```

## Development

### Common Commands

```bash
./run.sh help       # Show all commands
./run.sh proto      # Generate protobuf code
./run.sh lint       # Run linters
./run.sh format     # Format code
./run.sh test       # Run tests
```

### Database

```bash
./run.sh db-up      # Start PostgreSQL
./run.sh db-down    # Stop PostgreSQL
./run.sh db-shell   # Connect to database
./run.sh db-reset   # Reset database (deletes data)
```

### Migrations

Migrations apply on startup. Manual commands:

```bash
cd src/uniffy
uv run alembic upgrade head
uv run alembic revision --autogenerate -m "description"
```

### Adding a Service

1. Define `.proto` in `src/proto/<service>/v1/`
2. Run `./run.sh proto`
3. Implement handlers in `src/uniffy/domains/<service>/`
4. Register in `factory.py`

## Architecture

### Multi-Tenancy

All content is organization-scoped. Users are global but belong to organizations via memberships.

### Content Permissions

Three visibility levels:
- **Private** - Owner only
- **Group** - Shared with specific groups
- **Organization** - All org members

See [docs/architecture-content-permissions.md](docs/architecture-content-permissions.md).

### Search

Unified search powered by [Meilisearch](https://www.meilisearch.com/) for instant, typo-tolerant full-text search. Supports keyword-based filters (`note:`, `tag:`, `my:`), exact phrase matching with quotes, and real-time indexing.

See [docs/search.md](docs/search.md).

## Documentation

- [Concept & Vision](docs/uniffy-concept.md)
- [Content Permissions](docs/architecture-content-permissions.md)
- [Search Architecture](docs/search.md)
