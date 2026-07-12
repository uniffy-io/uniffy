## Project Overview

Uniffy is a unified workspace where notes, files, chat, AI assistants, calendar, and workflows exist in one application. Every piece of information can be referenced from anywhere using universal `@` mentions. This is an enterprise application, so the bar is high - it pays to invest the extra time to get things right rather than reach for a quick fix. Before adding new logic, scan other domains for the same pattern; we likely already have a component or helper that fits. Buttons, pickers, tables, and other primitives stay consistent across the app.

## Two Product Targets (NON-NEGOTIABLE)

Every feature must work in BOTH deployment modes. The same codebase ships as:

1. **`cloud.uniffy.io`** - our hosted multi-tenant SaaS. We run the infra, the database, the mail relay, the storage. Tenants share a single deployment. Platform admins (Uniffy operators) exist as a distinct role from tenant org admins.
2. **Self-hosted** - paid license, customer runs their own deployment. Usually single-tenant (one org), occasionally multi-tenant. The customer is the operator AND the org owner; there is no Uniffy in the loop.

### Implications for every change

- **Keep cloud-only assumptions out.** Anything needing an external service is either optional with a sane local fallback, or env-configurable so a self-hoster can point it at their own infra (their SMTP, their S3-compatible storage, their LLM keys).
- **Keep self-hosted-only assumptions out too.** New flows hold up on multi-tenant; anything touching shared resources carries an `organization_id` scope from day one.
- **Configuration tiers are layered, not branched:** per-org row in DB -> env default -> typed error. See `core/mail/resolver.py` and the settings-stores section in `.claude/rules/backend.md`.
- **Admin surfaces are scoped:** `/admin/*` = org admin (one tenant). `/platform/*` = platform admin (cloud operator, cross-tenant). New admin pages belong under the matching surface; separation is enforced via `PlatformLayout` + permission gates, not hidden nav.
- **Privacy posture on cloud.** Platform operators do not auto-bypass `PermissionChecker`. Access to tenant content MUST go through a time-bound, audit-logged `SupportSession` the org owner can see live and revoke. No code path lets `is_system_admin=true` read tenant content without one - this is a hard line.
- **Secrets at rest belong to the tenant.** Per-org secrets are encrypted with `OrgCipher`, never a shared key. Self-hosters get the same envelope encryption; only the master KEK holder differs.
- **Telemetry / phone-home is off by default.** Self-hosters MUST be able to run fully air-gapped; any opt-in stays off in defaults.
- **No third-party CDN fetches at runtime** (scripts, workers, fonts, styles). Bundle everything (Vite `?url` imports, `@fontsource-variable/*`). ESLint rejects CDN URL literals and `vite.config.ts` injects a CSP locked to `'self'` - both stay in place. New dependencies get audited for CDN URLs, telemetry endpoints, and postinstall scripts before adoption.
- **Migrations and seed data stay neutral.** Bootstrap works for "fresh deploy, one org, one admin" and "fresh deploy, no orgs yet". No cloud-only fixtures in the migration runner.
- **Docs and ops UX cover both.** New settings go in `.env.example` (self-hosters) AND the relevant admin page (cloud operators do not edit env).

When a design decision pulls in opposite directions, pick the option that satisfies both unless one is impossible - then make the more general path the default and gate the specialized one behind a flag. Example: we dropped the Resend SDK for generic SMTP (Resend ships an SMTP relay) so one backend covers every provider on both products.

## Commands

```bash
./manage.py deps install --stack local   # Install host dependencies (uv + pnpm workspace)
./manage.py proto                        # Generate protobuf code (run after ANY .proto edit)
./manage.py lint [-s backend|ui|mobile]  # Linters (ruff / eslint)
./manage.py test [-s ui]                 # Tests (pytest / vitest)
./manage.py bench                        # Benchmarks
```

Full command map: `.claude/rules/manage-cli.md`. Migrations run automatically on startup. Backend tests live in `src/uniffy/tests/`, frontend tests in `src/ui/`; tests mirror the domain structure (unit tests for operations, integration tests for handlers).

Before committing: `./manage.py proto` (if protos changed) and `./manage.py lint -s backend` (if Python changed).

## Rules

Path-scoped rules in `.claude/rules/` auto-load when you touch matching files and are the source of truth for their area - do not duplicate their content elsewhere:

- `architecture.md`, `permissions.md`, `comment-discipline.md` - always on (stack, permission model, comment/naming discipline)
- `backend.md`, `frontend.md` - conventions per side
- `files-domain.md`, `chat-domain.md`, `calls-domain.md`, `agents.md`, `notes-realtime.md`, `mentions.md`, `landing-voice.md` - domain invariants

Repo-wide basics not covered by a scoped rule:

- No emojis in code, docs, comments, or commit messages.
- `uv` runs Python; `pnpm` is the frontend package manager.
- All content carries a URN and is searchable; user-editable text is Markdown with `[[[label|urn]]]` mentions (see `architecture.md`).
- Authenticated asset reads (`<img>`/`<video>`/`<audio>`) ride the asset-read cookie; `.claude/rules/files-domain.md` owns that contract.
- Subagents do not auto-load these rules - carry the relevant ones into subagent prompts (see `comment-discipline.md` section 5).

## Plans, Backlogs and Reviews

All plans and backlogs live in `.claude/plans/`, kebab-case filenames. **Plans** are pre-implementation blueprints. **Backlogs** (`.claude/plans/backlogs/{name}-backlog.md`) are living progress trackers for work spanning multiple phases, sessions, or 5-10+ files. **Shipped work moves to `.claude/plans/archive/`** (plan + backlog together) so the active set stays scannable.

Backlog contents: progress summary table (`[ ]`/`[~]`/`[x]`/`[!]` with reason), how-to-resume instructions, per-phase checklists, dated session notes (absolute dates). Update it after every meaningful change and commit it alongside the work. When resuming a feature, check `.claude/plans/backlogs/` first. When `/execute` runs a multi-phase plan, create a companion backlog if none exists.

**Reviews** (security, performance, implementation, ...) are saved to `.claude/reviews/{kebab-case}.md` and the same content is the reply to the user. Findings are a few sentences each with file/function/line specifics and a fix proposal that was actually verified during the review - no guesses.
