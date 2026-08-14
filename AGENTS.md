## Project Overview

Uniffy is a unified workspace where notes, files, chat, AI assistants, calendar, and workflows exist in one application. Every piece of information can be referenced from anywhere using universal `@` mentions. This is an enterprise application, so the bar is high - it pays to invest the extra time to get things right rather than reach for a quick fix. Before adding new logic, scan other domains for the same pattern; we likely already have a component or helper that fits. Buttons, pickers, tables, and other primitives stay consistent across the app.

## Two Product Targets (NON-NEGOTIABLE)

Every feature must work in BOTH deployment modes. The same codebase ships as:

1. **`cloud.uniffy.io`** - our hosted multi-tenant SaaS. We run the infra, the database, the mail relay, the storage. Tenants share a single deployment. Platform admins (Uniffy operators) exist as a distinct role from tenant org admins.
2. **Self-hosted** - paid license, customer runs their own deployment. Usually single-tenant (one org), occasionally multi-tenant. The customer is the operator AND the org owner; there is no Uniffy in the loop.

### Implications for every change

- **Keep cloud-only assumptions out.** Anything needing an external service is either optional with a sane local fallback, or env-configurable so a self-hoster can point it at their own infra (their SMTP, their S3-compatible storage, their LLM keys).
- **Keep self-hosted-only assumptions out too.** New flows hold up on multi-tenant; anything touching shared resources carries an `organization_id` scope from day one.
- **Configuration tiers are layered, not branched:** per-org row in DB -> env default -> typed error. See `core/mail/resolver.py` and the settings-stores section in `.agents/rules/backend.md`.
- **Admin surfaces are scoped:** `/admin/*` = org admin (one tenant). `/platform/*` = platform admin (cloud operator, cross-tenant). New admin pages belong under the matching surface; separation is enforced via `PlatformLayout` + permission gates, not hidden nav.
- **Privacy posture on cloud.** Platform operators do not auto-bypass `PermissionChecker`. Access to tenant content MUST go through a time-bound, audit-logged `SupportSession` the org owner can see live and revoke. No code path lets `is_system_admin=true` read tenant content without one - this is a hard line.
- **Secrets at rest belong to the tenant.** Per-org secrets are encrypted with `OrgCipher`, never a shared key. Self-hosters get the same envelope encryption; only the master KEK holder differs.
- **Telemetry / phone-home is off by default.** Self-hosters MUST be able to run fully air-gapped; any opt-in stays off in defaults.
- **No third-party CDN fetches at runtime** (scripts, workers, fonts, styles). Bundle everything (Vite `?url` imports, `@fontsource-variable/*`). The linter rejects CDN URL literals in BOTH the web app and mobile (custom `uniffy/no-cdn-urls` oxlint rule in `lint/uniffy-oxlint-plugin.mjs`) and `vite.config.ts` injects a CSP locked to `'self'` - both stay in place. New dependencies get audited for CDN URLs, telemetry endpoints, and postinstall scripts before adoption.
- **Migrations and seed data stay neutral.** Bootstrap works for "fresh deploy, one org, one admin" and "fresh deploy, no orgs yet". No cloud-only fixtures in the migration runner.
- **Docs and ops UX cover both.** New settings go in `.env.example` (self-hosters) AND the relevant admin page (cloud operators do not edit env).

When a design decision pulls in opposite directions, pick the option that satisfies both unless one is impossible - then make the more general path the default and gate the specialized one behind a flag. Example: we dropped the Resend SDK for generic SMTP (Resend ships an SMTP relay) so one backend covers every provider on both products.

## Commands

All project commands go through `./manage.py`, a PEP 723 uv script (click). Every `--stack` command defaults to `docker`; `--stack local` runs the host toolchain.

```bash
# First start
./manage.py start                            # docker: full containerized stack
./manage.py start --stack local              # host app + native processes, infra in docker

# Compose stack (default profiles core+dev; add -p mobile)
./manage.py stack up [-d] [--no-build]       # start detached (cached build), tail logs (Ctrl+C detaches)
./manage.py stack down                       # stop the stack
./manage.py stack rebuild [services...]      # --no-cache image rebuild, then recreate them + image-siblings
./manage.py stack recreate <services...>     # force-recreate just these (apply an edited command/env, no data loss)
./manage.py stack recreate                   # no args = DESTRUCTIVE full reset: down --volumes ALL profiles, then up
./manage.py stack reset-data                 # wipe only data volumes (pg/valkey/meili/rustfs), restart backend + demo seeder

# Logs
./manage.py logs                             # tail all docker services
./manage.py logs -s backend -s ui            # tail specific services (-s repeatable)
./manage.py logs --stack local               # tail .logs/*.log written by `serve all`

# Host dev processes (native hot reload; infra stays in docker)
./manage.py serve all                        # backend + both workers + vite
./manage.py serve backend|worker-core|worker-egress|ui|landing|mobile

# Dependencies (per workspace; -s backend|ui|mobile|landing)
./manage.py deps install -s all              # sync from lockfiles (backend sync also resyncs the workers)
./manage.py deps add <pkg[@ver]> -s ui       # add (pkg@ver pins the version); --dev for a dev dep
./manage.py deps remove <pkg> -s backend     # remove a package
./manage.py deps update [pkgs] -s backend    # upgrade named pkgs (bare = upgrade all in range)
./manage.py deps run -s backend -- <args>    # raw uv (backend) / pnpm (node) passthrough

# Codegen / housekeeping
./manage.py proto                            # regenerate protobuf (run after ANY .proto edit)
./manage.py licenses                         # regenerate docs/LICENSES.md
./manage.py clean                            # remove generated code + build caches
./manage.py toolbox <cmd>                    # run in deps-manager container (pnpm/uv/buf); try: toolbox bash

# Quality
./manage.py lint [-s backend|ui|mobile|cli]  # ruff / oxlint / go vet
./manage.py format                           # ruff format (backend)
./manage.py test [-s backend|ui|cli]         # pytest / vitest / go test
./manage.py bench                            # backend benchmarks

# Database
./manage.py db shell                         # psql into postgres
./manage.py db migrate                       # alembic upgrade head (also runs automatically on startup)

# unictl (Go CLI)
./manage.py cli build|install|run|lint|test

# Landing site (--stack defaults to docker)
./manage.py landing build|preview|deploy     # preview on :8788; deploy needs CLOUDFLARE_API_TOKEN in host env
```

Before committing: `./manage.py proto` (if protos changed) and `./manage.py lint -s backend` (if Python changed). Backend tests split by what they need: `src/uniffy/tests/unit/{domain}/` needs nothing and runs in CI, `src/uniffy/tests/integration/{area}/{suite}/` needs a live service and is local-only (`test -s integration`; `internal/database` needs Postgres, `agents/providers` needs paid API keys), benchmarks in `src/uniffy/tests/benchmarks/`. Frontend tests are in `src/ui/`.

Stack and container invariants:

- `--stack local` never auto-creates `.venv`/`node_modules` on the host; `serve` and `cli` are host-only. Docker deps live in per-container `.venv`/`node_modules` volumes the entrypoint syncs on restart - never hand-edit a `package.json` then `deps install` (the frozen lockfile refuses).
- Supply-chain: `pnpm-workspace.yaml` `minimumReleaseAge` (5d) refuses too-fresh versions on host and in containers - do not bypass. Surface a blocked deliberate upgrade to the user.
- Containers that run third-party code use `cap_drop: ALL` + read-only rootfs (`<<: *contained` in `dev.yaml`); a new code-running service gets that anchor. Writes stay host-owned via `HOST_UID`/`setpriv`, so never chown `/app` from inside a container.

### Stack rules

- If we are on a docker stack, don't run any commands in the host, e.g uv run pytest, pnpm exec vitest, uv ... or scripts. The code is live mounted in the docker containers, so use the appropriete container to run what you want to do with docker exec or with manage.py ( mostly ).

- If we are on docker stack again it's forbiden to install any dependencies on the host whatsoever. 

## Rules

Shared path-scoped rules live in `.agents/rules/` and are the source of truth for their area - do not duplicate their content elsewhere. Claude Code reaches them through `.claude/rules/` and loads matching rules automatically. Codex reaches the same source through `.codex/hooks.json`: the hook injects every `**/*` rule at session and subagent startup, parses each rule's `paths` frontmatter, and blocks the first edit to a newly matched path while injecting the complete matching rules for reassessment. Project-local Codex hooks require one-time trust through `/hooks`; if hooks are disabled or unavailable, manually read the three always-on rules and every rule whose `paths` match before editing.

- `architecture.md`, `permissions.md`, `comment-discipline.md` - always on (stack, permission model, comment/naming discipline)
- `backend.md`, `frontend.md`, `mobile.md` - conventions per side (backend, web app, Expo mobile app)
- `files-domain.md`, `chat-domain.md`, `calls-domain.md`, `agents.md`, `notes-realtime.md`, `mentions.md`, `landing-voice.md` - domain invariants

Repo-wide basics not covered by a scoped rule:

- No emojis in code, docs, comments, or commit messages.
- `uv` runs Python; `pnpm` is the frontend package manager.
- All content carries a URN and is searchable; user-editable text is Markdown with `[[[label|urn]]]` mentions (see `architecture.md`).
- Authenticated asset reads (`<img>`/`<video>`/`<audio>`) ride the asset-read cookie; `.agents/rules/files-domain.md` owns that contract.
- Delegated agents do not reliably load these rules - require them to read the relevant files in their task prompt (see `comment-discipline.md` section 5).

## Plans, Backlogs and Reviews

All plans and backlogs live in `.agents/plans/`, kebab-case filenames. **Plans** are pre-implementation blueprints. **Backlogs** (`.agents/plans/backlogs/{name}-backlog.md`) are living progress trackers for work spanning multiple phases, sessions, or 5-10+ files. **Shipped work moves to `.agents/plans/archive/`** (plan + backlog together) so the active set stays scannable.

Backlog contents: progress summary table (`[ ]`/`[~]`/`[x]`/`[!]` with reason), how-to-resume instructions, per-phase checklists, dated session notes (absolute dates). Update it after every meaningful change and commit it alongside the work. When resuming a feature, check `.agents/plans/backlogs/` first. When the `execute` skill runs a multi-phase plan, create a companion backlog if none exists.

**Reviews** (security, performance, implementation, ...) are saved to `.agents/reviews/{kebab-case}.md` and the same content is the reply to the user. Findings are a few sentences each with file/function/line specifics and a fix proposal that was actually verified during the review - no guesses.

**Scaling reviews** (`.agents/scaling-reviews/{kebab-case}.md`) are the registry of known scalability limits we are deliberately NOT fixing yet: one file per finding, carrying a Status line, the load at which it bites, file/function specifics, and the mitigation levers in sequencing order with their tradeoffs. The bar for filing is "correct today, falls over at scale, fix deferred on purpose" - anything broken at current scale is a bug, not a scaling review. File one whenever a capacity analysis, a review, or ordinary development surfaces such a limit; check the directory before designing anything that fans out per user, per org, or per connection, since the ceiling may already be documented. When a finding gets fixed, record what shipped in the file and move it to `.agents/scaling-reviews/resolved/`.
