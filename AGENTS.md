## Project Overview

Uniffy is a unified workspace where notes, files, chat, AI assistants, calendar, and workflows exist in one application. Every piece of information can be referenced from anywhere using universal `@` mentions. This is an enterprise application in which everything should be almost perfect and pushed to the standards. Don't make shortcuts or easy solutions, just to quickly solve something. When doing something always check if the logic is repeating first in other domains or already build components / classes. The buttons, pickers, tables, etc ... should be the same in every aspect of the app.

---

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
| ConnectRPC | API layer (Protocol Buffers + Connect) -- not REST |
| ARQ + Valkey | Background task queue |
| Alembic | Database migrations |

---

## Commands

```bash
# Setup
./run.sh install          # Install all dependencies (uv + pnpm workspace)
./run.sh proto            # Generate protobuf code (python, typescript, go)

# Development
./run.sh dev              # Run backend + frontend + worker (all-in-one)
./run.sh backend          # Run backend with hot reload
./run.sh ui [cmd]         # Run pnpm command in ui workspace (default: dev)
./run.sh mobile [cmd]     # Run pnpm command in mobile workspace (default: start)
./run.sh mobile-dev       # Run backend + mobile app in web view

# Quality
./run.sh lint             # Run all linters (backend + frontend)
./run.sh lint-backend     # Run backend linter (ruff)
./run.sh lint-frontend    # Run frontend linter (eslint)
./run.sh lint-mobile      # Run mobile linter + format check
./run.sh test             # Run backend tests
./run.sh test-frontend    # Run frontend tests
```

Migrations run automatically on startup.

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
│   ├── uniffy/           # Python backend (FastAPI + ConnectRPC)
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
├── buf.gen.yaml          # Protobuf codegen (all languages, single pass)
├── docs/agents/          # Layer-specific documentation
└── .claude/              # AI development artifacts
```

**Workspace architecture**: Generated protobuf code lives in `src/gen/` as shared packages consumed by all projects. Python uses `uniffy-proto` via uv workspace. TypeScript uses `@uniffy/proto` via pnpm workspace. Go uses a Go module with `replace` directives for local dev.

---

## Architecture

Uniffy uses **domain-driven vertical slices**. Each feature is self-contained:

- **Backend**: `src/uniffy/domains/{feature}/` with operations, handlers, service, converters
- **Frontend**: `src/ui/src/features/{feature}/` with api, store, components, pages, hooks
- **Proto**: `src/proto/{service}/v1/{service}.proto` defines the API contract

**API layer**: ConnectRPC (Protocol Buffers + Connect). All API communication uses generated clients -- never REST. Proto definitions are the source of truth. Generated code is imported as `from uniffy_proto.` (Python) and `@uniffy/proto/` (TypeScript).

**Multi-tenancy**: All content is scoped to `organization_id`. Users are global; memberships are org-scoped.

**Permission system**: Three layers -- VisibilityScope (PRIVATE/GROUP/ORGANIZATION), ContentGroupLink, and ContentPermission (VIEW/EDIT/ADMIN/OWNER).

**Background tasks**: ARQ workers with Valkey for async job processing (file processing, indexing, etc.).

---

## Documentation

Detailed documentation is split by layer:

- @docs/agents/backend.md - Use when working on Python code in `src/uniffy/`. Covers domain slices, API services, models, permissions, auth backend.
- @docs/agents/frontend.md - Use when working on React/TypeScript in `src/ui/`. Covers components, hooks, theme system, Redux patterns, keyboard shortcuts.
- @docs/agents/agents.md - Use when working on the agents domain. Covers tool execution flow, permission model, runtime orchestration, skills, providers, memories.

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

## Testing

- **Backend tests**: `./run.sh test` -- pytest, located in `src/uniffy/tests/`
- **Frontend tests**: `./run.sh test-frontend` -- located in `src/ui/`
- **Benchmarks**: `./run.sh bench` -- performance benchmarks in `src/uniffy/tests/benchmarks/`
- **Pattern**: Tests mirror the domain structure. Unit tests for operations, integration tests for handlers.

---

## Validation

Run before committing:

```bash
./run.sh proto            # if .proto files changed
./run.sh lint-backend     # ruff check + fix
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/uniffy/factory.py` | App factory -- mounts all ConnectRPC services and HTTP routes |
| `src/uniffy/main.py` | Application entrypoint |
| `src/ui/src/app/store.ts` | Redux store -- registers all feature reducers |
| `src/ui/src/app/router.tsx` | Frontend routes |
| `src/ui/src/config/api.ts` | ConnectRPC transport, token storage, auth interceptor |
| `src/uniffy/core/models/shared.py` | ContentType enum, base models |
| `src/uniffy/domains/settings/defaults.py` | Keyboard shortcuts source of truth |
| `src/ui/src/config/theme/` | Theme engine (dark/light + user accent colors) |
| `src/ui/src/config/errorMessages.ts` | Centralized error message mappings |
| `run.sh` | All project commands |

---

## On-Demand Context

| Topic | File |
|-------|------|
| Backend patterns | `docs/agents/backend.md` |
| Frontend patterns | `docs/agents/frontend.md` |
| Agents domain | `docs/agents/agents.md` |
| Backend domain structure | `src/uniffy/domains/` |
| Frontend feature structure | `src/ui/src/features/` |
| Proto definitions | `src/proto/` |
| Generated code | `src/gen/` (python, typescript, go) |
| Database models | `src/uniffy/core/models/` |
| Database migrations | `src/uniffy/db/migrations/` |

---

## AI Tools

Slash commands and skills available in this project. Suggest these to the user when appropriate.

### Commands (`/command`)

| Command | Description |
|---------|-------------|
| `/commit` | Create a conventional commit with Uniffy domain scopes |
| `/execute [plan-path]` | Execute an implementation plan file step by step |
| `/plan-feature [description]` | Create a comprehensive feature plan with codebase analysis |
| `/scaffold-domain <name> [desc]` | Generate an implementation plan for a new Uniffy domain |
| `/prime` | Load project context -- read key files and build codebase understanding |
| `/validate` | Run the full validation pipeline (lint, test, convention checks) |
| `/evolve` | Audit and update all AI artifacts to stay current with project changes |
| `/create-prd [filename]` | Generate a Product Requirements Document from conversation |
| `/create-rules` | Generate a CLAUDE.md file from codebase analysis |

### Skills (`/skill-name`)

| Skill | Description |
|-------|-------------|
| `/pr` | Create or update a pull request with auto-generated description |
| `/frontend-design` | Build distinctive, production-grade UI within Uniffy's design system |
| `/e2e-test` | Run comprehensive end-to-end browser testing with screenshots and DB validation |
| `/agent-browser` | Automate browser interactions -- navigate, click, fill forms, take screenshots |
| `/build-with-agent-team` | Build from a plan using multiple collaborating agents in tmux panes |
| `/skill-creator` | Create, modify, or benchmark skills |

### Prerequisites

Some skills require external tools. Install only what you need:

| Tool | Required by | Install |
|------|-------------|---------|
| `gh` (GitHub CLI) | `/pr` | `sudo apt install gh` then `gh auth login` |
| `agent-browser` | `/agent-browser`, `/e2e-test` | `npm install -g agent-browser && agent-browser install --with-deps` |
| `tmux` | `/build-with-agent-team` | `sudo apt install tmux` |

### Recommended Workflows

**New feature (new domain):**

```
/prime -> /create-prd -> /scaffold-domain -> /execute -> /validate -> /commit -> /pr
```

1. `/prime` -- build codebase understanding (skip if already primed this session)
2. `/create-prd` -- define requirements if the feature is complex or ambiguous (skip for small features)
3. `/scaffold-domain` -- generate a full implementation plan for the new domain (proto, backend, frontend, search integration)
4. `/execute [plan-path]` -- implement the plan step by step
5. `/validate` -- run lint, tests, and convention checks
6. `/commit` -- conventional commit with domain scope
7. `/pr` -- create pull request

**New feature (within existing domain):**

```
/prime -> /plan-feature -> /execute -> /validate -> /commit -> /pr
```

1. `/prime` -- build codebase understanding (skip if already primed)
2. `/plan-feature` -- analyze existing code and plan the addition
3. `/execute [plan-path]` -- implement the plan
4. `/validate` -- run lint, tests, and convention checks
5. `/commit` -- conventional commit
6. `/pr` -- create pull request

**Bug fix / enhancement / refactor:**

```
/plan-feature -> /execute -> /validate -> /commit -> /pr
```

1. `/plan-feature` -- trace the issue, map affected files, plan the fix (skip for trivial one-file fixes)
2. `/execute [plan-path]` -- implement the fix
3. `/validate` -- run lint, tests, and convention checks
4. `/commit` -- conventional commit (`fix(domain):` or `refactor(domain):`)
5. `/pr` -- create pull request

**Optional additions at any point:**
- `/frontend-design` -- when a feature needs distinctive UI work
- `/e2e-test` -- after implementation, before PR, to catch regressions with browser testing
- `/build-with-agent-team` -- when the plan is large enough to benefit from parallel agents

**Maintenance (run periodically):**
- `/evolve` -- audit all AI artifacts against actual codebase state and update anything that drifted

---

## Critical Rules

0. NEVER USE EMOJIES IN CODE, DOCUMENTS, COMMENTS, OR COMMIT MESSAGES
0. Always use a single hyphen (-). Do not use double-hyphens (--) or em-dashes (—) in your responses
1. Run `./run.sh proto` after editing `.proto` files
2. Always use async patterns in backend
3. Always check permissions in domain operations
4. Never hardcode colors in frontend - use theme system
5. ALWAYS use absolute imports with `@/` alias in frontend - NEVER use relative imports (`../` or `./`)
6. All content MUST have a URN and be searchable
7. All user-editable text MUST be stored as Markdown with `[[[label|urn]]]` mention support
8. Use shared URN utilities (`@/shared/utils/urn.ts`) for parsing and displaying URNs
9. Use centralized URN type colors from `@/config/theme/urnColors.ts` - never define URN colors inline
10. Use the keyboard shortcuts framework from `@/features/settings` - never hardcode keyboard handlers
11. Use the shared bookmarks system (`@/features/bookmarks`) - never add `is_pinned`/`is_starred`/`is_favorite` fields
12. Always use `uv` to run python scripts
13. All domain layouts MUST support Zen Mode - check `state.zenMode.isActive`
14. Never use `export default` in frontend code - always use named exports
15. All page components MUST use `useDocumentTitle()` hook from `@/shared/hooks/useDocumentTitle`
16. Use `pnpm` for package management in frontend (not npm or yarn)
17. NEVER call setState synchronously in useEffect - use useState initializers or useMemo instead (see frontend.md for patterns)
18. NEVER access refs during render - track dimensions in state with ResizeObserver instead
19. For authenticated resources in `<img>`/`<video>` tags, use HTTP routes + service worker auth proxy (see frontend.md)
20. Use the attachments system (`@/features/attachments`) to link files to content - never store file references directly on content models
21. NEVER use inline imports in Python - all imports MUST be at the top of the file. The only exception is when there is no other way to avoid a circular dependency
22. Use the centralized error handling system (`@/config/errorMessages.ts` + `errorToastMiddleware`) - never write manual `toast.error()` calls in thunks or duplicate error message strings (see frontend.md for patterns)
23. All frontend pages, layouts, and components MUST be responsive: desktop (first-class), tablet (must feel polished), mobile (functional but limited - native app exists). Use `useBreakpoint()` hook and Tailwind responsive classes. See frontend.md "Responsive Design" section for patterns
