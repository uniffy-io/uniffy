# UWOS

A unified workspace where notes, files, chat, AI assistants, calendar, and workflows exist in one application. Every piece of information can be referenced from anywhere using universal `@` mentions.

For the full vision, see [docs/uwos-concept.md](docs/uwos-concept.md).

## Prerequisites

- Python 3.13+
- Node.js 24+ with pnpm
- Docker and Docker Compose
- [uv](https://github.com/astral-sh/uv) (Python package manager)
- [buf](https://buf.build/) (Protocol Buffer compiler)

## Setup

```bash
git clone git@github.com:uniffy-io/uwos.git
cd uwos
make install
```

Configure environment:

```bash
cp .env.example .env
# Set JWT_SECRET_KEY (generate with: openssl rand -hex 32)
```

Start the database:

```bash
make db-up
```

Run the application:

```bash
make dev        # Backend + Frontend
# or separately:
make run        # Backend only (localhost:8000)
make ui         # Frontend only (localhost:5173)
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
└── uwos/               # Python backend
    ├── core/           # Shared utilities, auth, content mixins
    ├── db/             # Database session, migrations
    ├── domains/        # Domain modules (auth, notes, etc.)
    ├── gen/            # Generated ConnectRPC services
    └── factory.py      # FastAPI app factory
```

## Development

### Common Commands

```bash
make help       # Show all commands
make proto      # Generate protobuf code
make lint       # Run linters
make format     # Format code
make test       # Run tests
```

### Database

```bash
make db-up      # Start PostgreSQL
make db-down    # Stop PostgreSQL
make db-shell   # Connect to database
make db-reset   # Reset database (deletes data)
```

### Migrations

Migrations apply on startup. Manual commands:

```bash
cd src/uwos
uv run alembic upgrade head
uv run alembic revision --autogenerate -m "description"
```

### Adding a Service

1. Define `.proto` in `src/proto/<service>/v1/`
2. Run `make proto`
3. Implement handlers in `src/uwos/domains/<service>/`
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

- [Concept & Vision](docs/uwos-concept.md)
- [Content Permissions](docs/architecture-content-permissions.md)
- [Search Architecture](docs/search.md)
