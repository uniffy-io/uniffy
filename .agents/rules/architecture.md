---
paths:
  - "**/*"
---

# Architecture

## Tech Stack

| Technology | Purpose |
|------------|---------|
| Python 3.13+ | Backend language |
| FastAPI + Granian | Web framework (async only) |
| SQLModel + asyncpg | ORM and async database driver |
| PostgreSQL 18 | Primary database |
| Meilisearch | Typo-tolerant full-text search |
| React 19 | Frontend framework |
| TypeScript | Frontend language |
| Vite | Frontend build tool |
| Redux Toolkit | State management |
| Tailwind CSS 4 | Styling framework |
| ConnectRPC | API layer (Protocol Buffers + Connect) - not REST |
| ARQ + Valkey | Background job queue |
| Alembic | Database migrations |

---

Uniffy uses **domain-driven vertical slices**. Each feature is self-contained:

- **Backend**: `src/uniffy/domains/{feature}/` or
  `src/uniffy/domains/{context}/{subdomain}/` with operations, handlers, service, converters
- **Frontend**: `src/ui/src/features/{feature}/` with api, store, components, pages, hooks
- **Proto**: `src/proto/{service}/v1/{service}.proto` defines the API contract

**API layer**: ConnectRPC (Protocol Buffers + Connect). All API communication goes through generated clients rather than REST. Proto definitions are the source of truth. Generated code is imported as `from uniffy_proto.` (Python) and `@uniffy/proto/` (TypeScript).

**Multi-tenancy**: All content is scoped to `organization_id`. Users are global; memberships are org-scoped.

**Permission system**: Every content row carries an `access_mode` + optional `baseline_role`, resolved by `PermissionChecker.effective_role`. Personal content is private until shared - org/domain admins get no content bypass. Full model, enforcement points, caching, search/tag filtering, chat's separate model, and the hard rules live in **`.agents/rules/permissions.md`** (the single source of truth - do not duplicate it here).

**Background jobs:** The domain that owns the state and invariants also owns its typed contracts and
handlers under `domains/{feature}/jobs/contracts.py` and `domains/{feature}/jobs/jobs.py`. Large job
surfaces may keep additional focused, one-word collaborators beside those canonical files.
`core/jobs/` is the generic type and dispatch boundary, while `workers/` only composes owner-defined
jobs into the validated core and egress ARQ fleets and manages their process lifecycle.

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
│   │   ├── data/         # Shipped content: agent templates, skills, prompts, model catalog, assets
│   │   ├── db/           # Database session, migrations, seeding
│   │   ├── workers/      # ARQ fleet composition, registry, lifecycle
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

**Supported types:** the `ContentType` enum in `src/uniffy/core/types.py` (backend) and `UrnType` in `src/ui/src/shared/utils/urnTypes.ts` (frontend) are the source of truth. Do not copy the list into docs; it grows with every content type.

**Requirements:**
- All content models carry a `urn` property
- All content is indexed in search so `@` mention lookup works everywhere
- `BaseContentOperations` handles URN generation and search indexing automatically - extending it is the easiest way to get both right

## Markdown Content Standard

All user-editable text content supports Markdown with URN mentions - this keeps the `@` mention experience consistent across the app.

**Mention Format:**
```markdown
Check out [[[My Note|urn:uniffy:content:NOTE:uuid]]] for details.
Contact [[[John Doe|urn:uniffy:content:USER:uuid]]] for questions.
```

---

## Search Integration Checklist

When adding a new content type (e.g., `TASK`), update these files:

**Proto** (run `./manage.py proto` after):
| File | Update |
|------|--------|
| `src/proto/search/v1/search.proto` | Add `SEARCH_RESULT_TYPE_{TYPE}` |
| `src/proto/common/v1/common.proto` | Add `CONTENT_TYPE_{TYPE}` |

**Backend:**
| File | Update |
|------|--------|
| `src/uniffy/core/types.py` | Add to `ContentType` enum |
| `src/uniffy/core/converters/common_proto.py` | Add to `CONTENT_TYPE_TO_PROTO` and `CONTENT_TYPE_FROM_PROTO` |
| `src/uniffy/domains/search/converters.py` | Add to `ENTITY_TYPE_TO_PROTO` |
| `src/uniffy/domains/permissions/converters.py` | Add to `DOMAIN_CONTENT_TYPE_TO_PROTO` |

**Frontend:**
| File | Update |
|------|--------|
| `src/ui/src/shared/utils/urnTypes.ts` | Add to `UrnType` const |
| `src/ui/src/config/theme/urnColors.ts` | Add hex color, theme, and a `BRAND_RAMP_ORDER` slot |
| `src/ui/src/config/theme/contentTypes.ts` | Add to `CONTENT_TYPE_CONFIG` |
| `src/ui/src/features/search/utils/queryParser.ts` | Add to `TYPE_KEYWORD_MAP` and `FILTER_PREFIXES` |
| `src/ui/src/shared/utils/searchResultTypes.ts` | Add to `SEARCH_RESULT_TYPE_TO_URN_TYPE` |

---

## Key Files

| File | Purpose |
|------|---------|
| `src/uniffy/factory.py` | App factory - mounts all ConnectRPC services and HTTP routes |
| `src/uniffy/main.py` | Application entrypoint |
| `src/ui/src/app/store.ts` | Redux store - registers all feature reducers |
| `src/ui/src/App.tsx` | Frontend routes (lazy-loaded pages via `<LazyRoute>`) |
| `src/ui/src/config/api.ts` | ConnectRPC transport, token storage, auth interceptor |
| `src/uniffy/core/types.py` | ContentType and other shared enums |
| `src/uniffy/domains/settings/defaults.py` | Keyboard shortcuts source of truth |
| `src/ui/src/config/theme/` | Theme engine (dark/light + user accent colors) |
| `src/ui/src/config/errorMessages.ts` | Centralized error message mappings |
| `manage.py` | All project commands (uv-run click CLI; `./manage.py --help`) |
