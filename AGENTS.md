## Project Overview

Uniffy is a unified workspace where notes, files, chat, AI assistants, calendar, and workflows exist in one application. Every piece of information can be referenced from anywhere using universal `@` mentions. This is an enterprise application in which everything should be almost perfect and pushed to the standards. Don't make shortcuts or easy solutions, just to quickly solve something. When doing something always check if the logic is repeating first in other domains or already build components / classes. The buttons, pickers, tables, etc ... should be the same in every aspect of the app.

---

## Commands

```bash
# Setup
./run.sh install          # Install all dependencies (uv + pnpm workspace)
./run.sh proto            # Generate protobuf code (python, typescript, go)

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

## Testing

- **Backend tests**: `./run.sh test` - pytest, located in `src/uniffy/tests/`
- **Frontend tests**: `./run.sh test-frontend` - located in `src/ui/`
- **Benchmarks**: `./run.sh bench` - performance benchmarks in `src/uniffy/tests/benchmarks/`
- **Pattern**: Tests mirror the domain structure. Unit tests for operations, integration tests for handlers.

---

## Validation

Run before committing:

```bash
./run.sh proto            # if .proto files changed
./run.sh lint-backend     # ruff check + fix
```

---

## Plans and Backlogs

All plans and backlogs MUST be saved to `.claude/plans/`. Use kebab-case filenames.

**Plans** are pre-implementation blueprints. Created once, read during execution.

**Backlogs** are living progress trackers for multi-session work. They track what is done, what is in progress, and what remains so any agent or human can resume where the last session left off.

| Command | Writes to | Purpose |
|---------|-----------|---------|
| `/plan-feature` | `.claude/plans/{name}.md` | Implementation plan from codebase analysis |
| `/create-prd` | `.claude/plans/{name}.md` | Product requirements document |
| `/scaffold-domain` | `.claude/plans/{name}.md` | New domain implementation plan |
| `/execute` | reads plans, updates backlogs | Execute a plan file step by step |

### When to create a backlog

Create a backlog in `.claude/plans/backlogs/{name}-backlog.md` when the work spans multiple phases, multiple sessions, or touches more than 5-10 files. A backlog MUST contain:

1. **Progress summary** - table of phases with status (`[ ]`, `[~]`, `[x]`)
2. **How to resume** - instructions for the next agent/human picking up the work
3. **Phase checklist** - detailed tasks with checkboxes per phase
4. **Session notes** - dated entries at the bottom summarizing what each session changed

### Backlog rules

- Update the backlog after every meaningful change. Commit it alongside the work.
- Mark tasks `[x]` as you complete them, `[~]` when in progress, `[!]` when blocked (with reason).
- When the user says to resume work on a feature, check `.claude/plans/backlogs/` for an existing backlog first.
- When `/execute` is run on a multi-phase plan, create a companion backlog in `.claude/plans/backlogs/` if one does not exist.
- Convert relative dates to absolute dates in session notes (e.g., "today" -> "2026-04-12").

---

## Critical Rules

0. NEVER USE EMOJIES IN CODE, DOCUMENTS, COMMENTS, OR COMMIT MESSAGES
0. Always use a single hyphen (-). Do not use double-hyphens (--) or em-dashes (/) in your responses
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
17. NEVER call setState synchronously in useEffect - use useState initializers or useMemo instead
18. NEVER access refs during render - track dimensions in state with ResizeObserver instead
19. For authenticated resources in `<img>`/`<video>` tags, use HTTP routes + service worker auth proxy
20. Use the attachments system (`@/features/attachments`) to link files to content - never store file references directly on content models
21. NEVER use inline imports in Python - all imports MUST be at the top of the file. The only exception is when there is no other way to avoid a circular dependency
22. Use the centralized error handling system (`@/config/errorMessages.ts` + `errorToastMiddleware`) - never write manual `toast.error()` calls in thunks or duplicate error message strings
23. All frontend pages, layouts, and components MUST be responsive: desktop (first-class), tablet (must feel polished), mobile (functional but limited - native app exists). Use `useBreakpoint()` hook and Tailwind responsive classes
24. NEVER write decorative divider comments in code. No `# ----`, `# ====`, `// ----`, `// ====`, or any line of repeated punctuation characters used as a visual separator. No standalone section-label comments like `# Helpers`, `# Constants`, `// Actions`, `// Selectors`, `// Types` that exist only to name a group of methods or variables. Code structure is self-evident from the code itself; these comments add noise and are always removed on sight.
