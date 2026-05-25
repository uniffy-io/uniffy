---
paths:
  - "**/*"
---

# Architecture

## Tech Stack

| Technology | Purpose |
|------------|---------|
| Python 3.13+ | Backend language |
| FastAPI | Web framework (async only) |
| SQLModel + asyncpg | ORM and async database driver |
| PostgreSQL 18 | Primary database |
| Meilisearch | Typo-tolerant full-text search |
| React 19 | Frontend framework |
| TypeScript | Frontend language |
| Vite | Frontend build tool |
| Redux Toolkit | State management |
| Tailwind CSS 4 | Styling framework |
| ConnectRPC | API layer (Protocol Buffers + Connect) - not REST |
| ARQ + Valkey | Background task queue |
| Alembic | Database migrations |

---

Uniffy uses **domain-driven vertical slices**. Each feature is self-contained:

- **Backend**: `src/uniffy/domains/{feature}/` with operations, handlers, service, converters
- **Frontend**: `src/ui/src/features/{feature}/` with api, store, components, pages, hooks
- **Proto**: `src/proto/{service}/v1/{service}.proto` defines the API contract

**API layer**: ConnectRPC (Protocol Buffers + Connect). All API communication uses generated clients - never REST. Proto definitions are the source of truth. Generated code is imported as `from uniffy_proto.` (Python) and `@uniffy/proto/` (TypeScript).

**Multi-tenancy**: All content is scoped to `organization_id`. Users are global; memberships are org-scoped.

**Permission system**: Every content row carries an `access_mode` (`OWNER_ONLY`, `EXPLICIT_MEMBERS`, `OPEN_TO_ORG`) and an optional `baseline_role` (only meaningful with `OPEN_TO_ORG`). Explicit grants live in `permissions_content_members` as `ContentMember` rows keyed on `(content_type, content_id, subject_type, subject_id)` with a `role` ordered `VIEWER < COMMENTER < EDITOR < ADMIN < OWNER` plus a `BLOCKED` deny state. `PermissionChecker.effective_role()` resolves the highest of (ownership, explicit direct/group member, baseline-when-OPEN_TO_ORG) minus any `BLOCKED` row. Org OWNER/ADMIN and per-domain `DomainAdmin` bypass the filter. Use `role_can_view / role_can_comment / role_can_edit / role_can_delete / role_can_manage / role_can_transfer` from `core.auth.permissions` to gate operations. Access-mode and member changes go through `permissions.v1.MembersService` (backed by `ContentMembersOperations` in `core/content/members.py`). For content that uses custom membership-based access (e.g., chat channels), domains override the `_require_*` hooks on `BaseContentOperations`.

**Domain admin system**: Users can be granted admin status for specific domains (chat, files, calendar, etc.) without being full org admins. Stored in a shared `DomainAdmin` table with unique constraint on `(organization_id, user_id, domain)`. Access check order: org ADMIN/OWNER > domain admin > regular member.

**Background tasks**: ARQ workers with Valkey for async job processing (file processing, indexing, etc.).

---

## Project Structure

```
uniffy/
├── src/
│   ├── proto/            # Protocol Buffer definitions (source of truth)
│   ├── gen/              # Generated code from proto (DO NOT EDIT)
│   │   ├── python/       # Python package: uniffy-proto (uv workspace member)
│   │   ├── typescript/   # TypeScript package: @uniffy/proto (pnpm workspace member)
│   │   └── go/           # Go module: github.com/uniffy-io/uniffy-proto-go
│   ├── uniffy/           # Python backend (Granian + FastAPI + ConnectRPC)
│   │   ├── core/         # Core models, auth, search, types, errors
│   │   ├── domains/      # Domain modules (vertical slices)
│   │   ├── db/           # Database session, migrations, seed data
│   │   ├── workers/      # Background task workers (ARQ)
│   │   └── factory.py    # App factory mounting services
│   ├── ui/               # React frontend (TypeScript + Vite)
│   │   └── src/
│   │       ├── app/      # Redux store, hooks, router
│   │       ├── components/  # Shared UI primitives
│   │       ├── config/   # API setup, theme system, error handling
│   │       ├── features/ # Domain modules (auth, notes, files, etc.)
│   │       └── shared/   # Shared hooks, utils, layouts
│   └── mobile/           # React Native mobile app (Expo)
├── pyproject.toml        # uv workspace root (backend + gen/python)
├── pnpm-workspace.yaml   # pnpm workspace root (ui + mobile + gen/typescript)
├── buf.yaml              # Protobuf lint/breaking config
└── buf.gen.yaml          # Protobuf codegen (all languages, single pass)
```

**Workspace architecture**: Generated protobuf code lives in `src/gen/` as shared packages consumed by all projects. Python uses `uniffy-proto` via uv workspace. TypeScript uses `@uniffy/proto` via pnpm workspace. Go uses a Go module with `replace` directives for local dev.

---

## Universal Resource Names (URNs)

Uniffy uses URNs to uniquely identify all content. This enables universal `@` mentions.

**Format:** `urn:uniffy:content:{TYPE}:{uuid}`

**Supported Types:** `NOTE`, `FILE`, `CHAT`, `USER`, `CALENDAR_EVENT`, `PROJECT`, `TASK`, `USER`, `GROUP`

**Requirements:**
- All content models MUST have a `urn` property
- All content MUST be indexed in search for `@` mention lookup
- Use `BaseContentOperations` which handles URN generation and search indexing automatically

## Markdown Content Standard

All user-editable text content MUST support Markdown with URN mentions.

**Mention Format:**
```markdown
Check out [[[My Note|urn:uniffy:content:NOTE:uuid]]] for details.
Contact [[[John Doe|urn:uniffy:content:USER:uuid]]] for questions.
```

---

## Search Integration Checklist

When adding a new content type (e.g., `TASK`), update these files:

**Proto** (run `./run.sh proto` after):
| File | Update |
|------|--------|
| `src/proto/search/v1/search.proto` | Add `SEARCH_RESULT_TYPE_{TYPE}` |
| `src/proto/common/v1/common.proto` | Add `CONTENT_TYPE_{TYPE}` |

**Backend:**
| File | Update |
|------|--------|
| `src/uniffy/core/models/shared.py` | Add to `ContentType` enum |
| `src/uniffy/core/converters/common_proto.py` | Add to `CONTENT_TYPE_TO_PROTO` and `CONTENT_TYPE_FROM_PROTO` |
| `src/uniffy/domains/search/converters.py` | Add to `ENTITY_TYPE_TO_PROTO` |
| `src/uniffy/domains/permissions/converters.py` | Add to `DOMAIN_CONTENT_TYPE_TO_PROTO` |

**Frontend:**
| File | Update |
|------|--------|
| `src/ui/src/shared/utils/urnTypes.ts` | Add to `UrnType` const |
| `src/ui/src/config/theme/urnColors.ts` | Add hex color and theme |
| `src/ui/src/config/theme/contentTypes.ts` | Add to `CONTENT_TYPE_CONFIG` |
| `src/ui/src/features/search/utils/queryParser.ts` | Add to `TYPE_KEYWORD_MAP` and `FILTER_PREFIXES` |
| `src/ui/src/features/search/components/SearchResultsList.tsx` | Add to `SEARCH_RESULT_TYPE_TO_URN_TYPE` |

---

## Key Files

| File | Purpose |
|------|---------|
| `src/uniffy/factory.py` | App factory - mounts all ConnectRPC services and HTTP routes |
| `src/uniffy/main.py` | Application entrypoint |
| `src/ui/src/app/store.ts` | Redux store - registers all feature reducers |
| `src/ui/src/app/router.tsx` | Frontend routes |
| `src/ui/src/config/api.ts` | ConnectRPC transport, token storage, auth interceptor |
| `src/uniffy/core/models/shared.py` | ContentType enum, base models |
| `src/uniffy/domains/settings/defaults.py` | Keyboard shortcuts source of truth |
| `src/ui/src/config/theme/` | Theme engine (dark/light + user accent colors) |
| `src/ui/src/config/errorMessages.ts` | Centralized error message mappings |
| `run.sh` | All project commands |
