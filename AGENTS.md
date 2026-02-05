# Uniffy

Uniffy is a unified workspace where notes, files, chat, AI assistants, calendar, and workflows exist in one application. Every piece of information can be referenced from anywhere using universal `@` mentions.

## Commands

```bash
./run.sh proto  # generate protos
./run.sh lint   # run linters
./run.sh dev    # run backend + frontend + worker
./run.sh        # show all commands
```

Migrations run automatically on startup.

## Stack

- **Backend**: Python 3.13+, FastAPI, SQLModel, asyncpg (async only)
- **Frontend**: React 19, TypeScript, Vite, Redux Toolkit, Tailwind CSS 4
- **API**: ConnectRPC (Protocol Buffers + Connect) - not REST
- **Database**: PostgreSQL 18
- **Search**: Meilisearch (typo-tolerant full-text search)

## Documentation

Detailed documentation is split by layer:

- @docs/agents/backend.md - Use when working on Python code in `src/uniffy/`. Covers domain slices, API services, models, permissions, auth backend.
- @docs/agents/frontend.md - Use when working on React/TypeScript in `src/ui/`. Covers components, hooks, theme system, Redux patterns, keyboard shortcuts.

## Universal Resource Names (URNs)

Uniffy uses URNs to uniquely identify all content. This enables universal `@` mentions.

**Format:** `urn:uniffy:content:{TYPE}:{uuid}`

**Supported Types:** `NOTE`, `FILE`, `CHAT`, `USER`, `BOOK`, `CALENDAR_EVENT`, `PASSWORD`, `SPACE`

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

## Critical Rules

0. NEVER USE EMOJIES IN CODE, DOCUMENTS, COMMENTS, OR COMMIT MESSAGES
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
