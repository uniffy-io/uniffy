## Project Overview

Uniffy is a unified workspace where notes, files, chat, AI assistants, calendar, and workflows exist in one application. Every piece of information can be referenced from anywhere using universal `@` mentions. This is an enterprise application, so the bar is high - it pays to invest the extra time to get things right rather than reach for a quick fix. Before adding new logic, take a moment to scan other domains for the same pattern; we likely already have a component or helper that fits. Buttons, pickers, tables, and other primitives stay consistent across the app, which makes the experience feel cohesive.

---

## Two Product Targets (NON-NEGOTIABLE)

Every feature must work in BOTH deployment modes. The same codebase ships as:

1. **`cloud.uniffy.io`** - our hosted multi-tenant SaaS. We run the infra, the database, the mail relay, the storage. Tenants share a single deployment. Platform admins (Uniffy operators) exist as a distinct role from tenant org admins.
2. **Self-hosted** - paid license, customer runs their own deployment. Usually single-tenant (one org), occasionally multi-tenant. The customer is the operator AND the org owner; there is no Uniffy in the loop.

### Implications for every change

- **Keep cloud-only assumptions out.** Anything that requires an external service works best when it is either (a) optional with a sane local fallback, or (b) configurable via env so a self-hoster can point it at their own infra (their SMTP, their S3-compatible storage, their LLM provider keys). Hardcoding a vendor tends to box us in later.
- **Keep self-hosted-only assumptions out too.** A new flow should hold up on multi-tenant. Anything that touches shared resources benefits from an `organization_id` scope from day one.
- **Configuration tiers are layered, not branched.** Patterns we already use, repeat them in new work:
  - Env tier (deploy-time default, used by self-hosters and as the cloud fallback)
  - Per-org tier in DB (cloud tenants override; self-hosters may use it but usually do not need to)
  - Resolution chain: per-org row -> env default -> typed error. See `core/mail/resolver.py`.
- **Admin surfaces are scoped:** `/admin/*` = org admin (one tenant). `/platform/*` = platform admin (cloud operator, cross-tenant). New admin pages belong under the matching surface; mixing them tends to confuse the role boundary. Platform admins should not casually see tenant content - separation is enforced via `PlatformLayout` + permission gates, not by hiding nav entries.
- **Privacy posture on cloud.** Platform operators do not auto-bypass `PermissionChecker`. Access to tenant content MUST go through a time-bound, audit-logged `SupportSession` that the org owner can see live and revoke. Do not add any code path that lets `is_system_admin=true` read a tenant's content without one - this is a hard line. See `.claude/plans/platform-admin-surface.md`.
- **Secrets at rest belong to the tenant.** Per-org secrets (SMTP password, agent provider keys, future webhooks) MUST be encrypted with `OrgCipher`, never with a shared key. Self-hosters get the same envelope encryption as cloud tenants - the only difference is who holds the master KEK.
- **Telemetry / phone-home is off by default.** Self-hosters MUST be able to run fully air-gapped. Any analytics, error reporting, or CDN asset fetch is forbidden at runtime (see rule 25 below), and any optional opt-in stays off in defaults.
- **Migrations and seed data stay neutral.** Bootstrap flows should work for "fresh deploy, one org, one admin" (self-hosted day one) and for "fresh deploy, no orgs yet" (cloud day one). Cloud-only fixtures do not belong in the migration runner.
- **Docs and ops UX cover both.** When you add a setting, include it in `.env.example` (self-hosters read this) and surface it in the relevant admin page (cloud operators do not edit env). When you ship a flow that needs configuration before it works, document both paths.

When a design decision pulls in opposite directions (e.g. "ship Resend SDK for great cloud deliverability" vs "use generic SMTP so self-hosters can plug in Postfix"), pick the option that satisfies both unless one is impossible - then make the more general path the default and gate the specialized path behind a flag. Recent example: we dropped the Resend SDK in favor of SMTP (Resend ships an SMTP relay) so one backend covers every provider on both products.

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

All plans and backlogs live in `.claude/plans/`. Use kebab-case filenames.

**Plans** are pre-implementation blueprints. Created once, read during execution.

**Backlogs** are living progress trackers for multi-session work. They track what is done, what is in progress, and what remains so any agent or human can resume where the last session left off.

### When to create a backlog

Create a backlog in `.claude/plans/backlogs/{name}-backlog.md` when the work spans multiple phases, multiple sessions, or touches more than 5-10 files. A backlog should contain:

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

0. Skip emojis in code, documents, comments, and commit messages - they tend to add noise without clarity.
0. Prefer a single hyphen (-) in responses; double-hyphens (--) and em-dashes get visually noisy.
1. Run `./run.sh proto` after editing `.proto` files so generated code stays in sync.
2. Async patterns are the default in the backend - they compose well with the rest of the stack.
3. Permission checks belong inside domain operations; that is where the access policy is well-typed.
4. Reach for the theme system instead of hardcoded colors in the frontend - it keeps dark/light parity automatic.
5. Absolute `@/` imports in the frontend tend to read better and survive file moves; relative imports (`../` or `./`) tend to rot.
6. All content carries a URN and is searchable - this is what makes universal `@` mentions work.
7. User-editable text is stored as Markdown with `[[[label|urn]]]` mention support, so mentions render anywhere the text appears.
8. The shared URN utilities (`@/shared/utils/urn.ts`) cover parsing and display - reaching for them keeps behavior uniform.
9. URN type colors live in `@/config/theme/urnColors.ts`; centralizing them avoids drift between domains.
10. The keyboard shortcuts framework from `@/features/settings` lets users rebind anything - prefer it over hardcoded handlers.
11. The shared bookmarks system (`@/features/bookmarks`) is a good fit for "starred" / "pinned" / "favorite" UX; adding those fields to content models tends to duplicate state.
12. `uv` is the preferred way to run python scripts in this repo.
13. Domain layouts respect Zen Mode by checking `state.zenMode.isActive` - it is part of the layout contract.
14. Named exports work well across the frontend; `export default` makes refactors and auto-imports less predictable.
15. Page components call `useDocumentTitle()` from `@/shared/hooks/useDocumentTitle` so the tab title stays accurate.
16. `pnpm` is the package manager for the frontend (over npm or yarn).
17. Setting state synchronously in `useEffect` causes loops and lint failures; useState initializers or `useMemo` are a better fit for derived values.
18. Reading refs during render is unreliable - tracking dimensions in state via `ResizeObserver` is more robust.
19. Authenticated resources in `<img>`/`<video>` tags work best via HTTP routes plus the service worker auth proxy, since those tags cannot send Authorization headers themselves.
20. The attachments system (`@/features/attachments`) is the right place to link files to content; storing file references directly on content models tends to duplicate metadata.
21. Python imports stay at the top of the file - this keeps dependency shape obvious. The one exception is the rare circular-import case where no other resolution exists.
22. The centralized error handling system (`@/config/errorMessages.ts` + `errorToastMiddleware`) covers user-facing errors; manual `toast.error()` calls in thunks tend to duplicate copy.
23. Pages, layouts, and components stay responsive across three tiers: desktop (first-class), tablet (polished), mobile (functional fallback since the native app exists). The `useBreakpoint()` hook and Tailwind responsive classes carry the weight.
24. The comment and naming discipline in `.claude/rules/comment-discipline.md` (auto-loaded) keeps the codebase reading like a finished product: no decorative dividers, no process-history comments, no phase/plan artifacts in identifiers.
25. Do NOT fetch executable code, workers, fonts, or styles from third-party CDNs at runtime (no `unpkg.com`, `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `cdn.skypack.dev`, `esm.sh`, `fonts.googleapis.com`, `fonts.gstatic.com`, etc.). All such assets MUST be bundled. Use Vite `?url` imports for assets shipped inside an npm package (e.g., `import workerUrl from 'pkg/dist/worker.mjs?url'`) or self-host via `@fontsource-variable/*`. CDN fetches leak user IP/referrer, break offline and air-gapped deploys, and create supply-chain risk. The frontend ESLint config rejects CDN URL literals via `no-restricted-syntax`, and `vite.config.ts` injects a mode-aware Content-Security-Policy meta tag that locks `script-src`, `style-src`, `worker-src`, `font-src`, and `connect-src` to `'self'` at runtime (dev split-origin backends are derived from `VITE_API_URL`). Both must stay in place. When adding a new dependency: audit it for hardcoded CDN URLs (grep its source for the domains above), telemetry endpoints, and `postinstall` scripts; reject the dep or vendor a fork if it phones home.
