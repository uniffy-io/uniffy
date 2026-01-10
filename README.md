# UWOS - Unified Work Operating System

The Operating System for Work. A unified workspace where notes, files, chat, AI assistants, calendar, books, passwords, and workflows exist in one application.

## 🚀 Quick Start

### Prerequisites

- **Python 3.13+**
- **Node.js 24+** and **pnpm**
- **Docker** and **Docker Compose**
- **uv** (Python package manager)
- **buf** (Protocol Buffer compiler)
- **GNU Make**

### 1. Clone and Install

```bash
git clone git@github.com:uniffy-io/uwos.git
cd uwos
make install
```

### 2. Start PostgreSQL

```bash
make db-up
```

This starts PostgreSQL 18 with auto-configured extensions.

### 3. Configure Environment

```bash
cp .env.example .env

# Edit .env and set:
# - JWT_SECRET_KEY (generate with: openssl rand -hex 32)
```

### 4. Run Development Server

```bash
# Backend + Frontend
make dev

# Or separately:
make run  # Backend only (http://localhost:8000)
make ui   # Frontend only (http://localhost:5173)
```

The application will:
- Auto-create PostgreSQL extensions
- Run database migrations on startup
- Start the FastAPI backend
- Start the React frontend

### 5. Working with alembic Migrations

**Migration are applied on app startup automatically.**

- model first approach using SQLModel
   - Write your models in `app/models/`
      - Create migration: `cd src/uwos && uv run alembic revision --autogenerate -m "Add content permission system and visibility scopes"`
   - AI All development -> let the ai write both the model and the migration

**Manual Migration Commands:**

```bash
cd src/uwos
uv run alembic upgrade head   # Apply migrations
uv run alembic downgrade -1   # Revert last migration
uv run alembic revision --autogenerate -m "description"  # Create migration
```

## 📚 Documentation

- **[Concept & Vision](docs/uwos-concept.md)** - What UWOS is and why it exists
- **[Multi-Tenant Architecture](docs/architecture-multi-tenant.md)** - Organization-based data model
- **[Authentication System](docs/authentication.md)** - JWT, SSO, and user management
- **[Database Schema](docs/database-schema.md)** - Complete schema reference
- **[Docker Setup](docs/docker-setup.md)** - PostgreSQL configuration guide

## 🏗️ Architecture

### Tech Stack

- **Backend**: Python, FastAPI, SQLModel, asyncpg
- **Database**: PostgreSQL 18 with async operations
- **Frontend**: React, TypeScript, Vite
- **API**: ConnectRPC (Protocol Buffers + Connect protocol)
- **Auth**: JWT tokens, bcrypt passwords, SSO-ready

### Project Structure

```
uwos/
├── app/
│   ├── auth/           # Authentication (JWT, passwords)
│   ├── db/             # Database session and initialization
│   ├── models/         # SQLModel database models
│   ├── repositories/   # Data access layer
│   ├── schemas/        # Pydantic schemas
│   ├── services/       # ConnectRPC service implementations
│   └── factory.py      # FastAPI app factory
├── alembic/            # Database migrations
│   └── versions/       # Migration scripts
├── proto/              # Protocol Buffer definitions
│   ├── auth/v1/        # Auth service proto
│   └── randomnum/v1/   # Example service
├── ui/                 # React frontend
├── docs/               # Documentation
└── docker-compose.yml  # PostgreSQL 18 setup
```

## 🛠️ Development

### Makefile Commands

```bash
make help          # Show all available commands
make install       # Install all dependencies
make proto         # Generate protobuf code
make db-up         # Start PostgreSQL
make db-down       # Stop PostgreSQL
make db-reset      # Reset database (⚠️ deletes data)
make db-logs       # View database logs
make db-shell      # Connect to database
make dev           # Run backend + frontend
make run           # Run backend only
make ui            # Run frontend only
make lint          # Run linters
make format        # Format code
make test          # Run tests
make clean         # Clean generated files
```

### Database Management

```bash
# Start database
make db-up

# View logs
make db-logs

# Connect to database
make db-shell

# Reset (deletes all data)
make db-reset
```

### Adding Protobuf Services

1. Create `.proto` file in `proto/<service>/v1/`
2. Run `make proto` to generate code
3. Implement service in `app/services/`
4. Register in `app/factory.py`

## 🗄️ Database

### Schema

- **users** - Global user accounts (SSO-ready)
- **organizations** - Multi-tenant workspaces
- **organization_members** - User memberships with roles
- **groups** - Organization-scoped teams/channels
- **group_members** - Group memberships
- **sso_configurations** - SAML/OIDC configs

### Migrations

Migrations run automatically on app startup. To run manually:

```bash
alembic upgrade head   # Apply migrations
alembic revision --autogenerate -m "description"  # Create migration
```

## 🔐 Authentication

JWT-based authentication with bcrypt passwords. SSO-ready schema (SAML/OIDC).

### Test Authentication

```bash
# Register a user
curl -X POST http://localhost:8000/auth.v1.AuthService/Register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "username": "testuser",
    "password": "securepass123"
  }'

# Login
curl -X POST http://localhost:8000/auth.v1.AuthService/Login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securepass123"
  }'
```

See [Authentication Documentation](docs/authentication.md) and [API Documentation](docs/api-documentation.md) for details.

## 🚢 Production

### Environment Variables

```bash
# Database
POSTGRES_HOST=your-db-host
POSTGRES_PORT=5432
POSTGRES_USER=uwos
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=uwos

# Security
JWT_SECRET_KEY=<generate-with-openssl-rand-hex-32>

# Optional
SQL_ECHO=false  # Set to true for SQL query logging
```

### Deployment Checklist

1. Set strong passwords in `.env`
2. Use external PostgreSQL (not Docker Compose)
3. Enable SSL/TLS for database
4. Use HTTPS for API endpoints
5. Set up rate limiting
6. Enable audit logging

---

**Note:** This is an active development project. The name may change.
