---
name: review-changes
description: |
  Run a disciplined review of the pending changes (uncommitted work plus the branch delta against main) across four dimensions: security, correctness, performance, and repo consistency. Fans out exploration subagents per dimension, then the main agent acts as judge: every finding is re-verified against the actual code before it is reported, and the result is saved to `.agents/reviews/` and replied verbatim. Use when asked to review the changes, review before a PR, check my work, audit this branch, or run a pre-merge review. Use `security-review` instead for a security-only pass, and `simplify` for quality-only cleanup with no bug hunting. Skip for reviewing a single function in conversation or code outside this repo.
---

# Review Pending Changes

This skill is the methodology for reviewing what is about to become a PR. The shape is explore -> judge -> report (-> fix). Subagents gather candidate findings; the main agent verifies each one against the code and rejects what does not survive. A finding that was never re-read in context is a guess, and guesses do not go in the review.

## 1. Establish the diff under review

1. `git fetch origin` (offline is fine; note it and continue).
2. Scope the changes: `git status` + `git diff HEAD --stat` for uncommitted work, `git log --oneline origin/main..HEAD` and `git diff origin/main...HEAD --stat` for the branch delta. On `main` with uncommitted work, the uncommitted set IS the review scope.
3. **Upstream alignment before anything else**: `git log --oneline HEAD..origin/main`. If upstream landed commits touching the same files, read those commits first and review against the merged reality, not the stale base. Overlaps and likely conflicts go in the review header.
4. Bucket the changed files by area (backend / ui / mobile / proto / landing docs / infra) and drop `src/gen/**` from the review set. Generated code is never reviewed; review the `.proto` source and confirm `./manage.py proto` was run (a proto edit without its regenerated files is itself a finding).
5. Check `.agents/plans/backlogs/` for a companion backlog. It carries the intent; a review that does not know what the change was trying to do misjudges half of it.

## 2. Load the rules the diff touches

The rules in `.agents/rules/` are the judging criteria, not background reading. A finding that contradicts a rule file is wrong; a diff that contradicts a rule file is a finding.

| Changed paths | Rules to read |
|---|---|
| anything | `architecture.md`, `permissions.md`, `comment-discipline.md`, CLAUDE.md "Two Product Targets" |
| `src/uniffy/**`, `src/proto/**` | `backend.md` |
| `src/ui/**` | `frontend.md` |
| `src/mobile/**` | `mobile.md` |
| files / chat / calls / agents / notes / mentions domains | the matching domain rule file |
| `src/landing/**` content | `landing-voice.md` |

Also scan `.agents/scaling-reviews/` (including `resolved/`). A limit already registered there is not a finding; a new "correct today, falls over at scale" discovery becomes a file there, not a bug in the review.

## 3. Fan out exploration subagents

One subagent per dimension, scaled down for small diffs (a docs-only change does not need a performance pass). Subagents explore and report candidates; they do not judge and they do not fix.

| Dimension | What to hunt |
|---|---|
| Security | the full standard vulnerability sweep first, as if this were any exposed web app: injection of every kind (SQL, command, template, header), SSRF on any URL the server fetches, XSS and unsafe HTML/markdown rendering, path traversal on file and asset routes, authn/authz bypass and privilege escalation, IDOR, CSRF on state-changing routes, open redirects, unsafe deserialization, race conditions with security effect (double-spend, TOCTOU), timing and enumeration leaks, weak or homemade crypto, token/session lifetime and revocation, file upload abuse (type confusion, zip bombs, stored payloads), new dependencies (typosquats, postinstall scripts, telemetry). Then the repo-specific layer on top: every new RPC/route gates inside domain operations; `organization_id` scoping on every query; no org/domain admin content bypass (the hardest rule in `permissions.md`); actor vs target id confusion; secrets through `OrgCipher`/settings stores, never plaintext or shared-key; `except Exception` responds with the literal `"Internal server error"`, never `str(e)`; additions to `PUBLIC_METHODS`; missing cache invalidation after permission or membership mutations (a stale 600s perm cache is a live privilege) |
| Correctness | mutations paired with their cache invalidation in the same commit; transaction boundaries; races on hot rows; proto contract drift between backend and generated clients; deletions that orphan or break remaining callers (grep, do not assume); optional/`HasField` handling at proto boundaries; migration safety for "fresh deploy, no orgs yet" |
| Performance | every code diff: N+1 and UNION-per-N shapes, pagination caps on growable lists, `LIKE` on indexed text lookups, LLM/external HTTP or unbounded loops on the request thread, missing batch INSERT/UPSERT/DELETE, index coverage for new query predicates, per-render work and refetch storms on the frontend. Diffs touching `domains/chat`, `domains/agents`, or `core/auth|content|valkey|users` are held to the stricter hot-path bar in `backend.md`: Valkey-before-PG on hot reads, invalidation in the same commit, fetch-once-and-thread-through, per-call cache deadlines |
| Consistency | an existing component/helper was reused instead of reinvented (pickers, tables, `SubjectAvatar`, formatting utils); both product targets hold (env fallback for external services, no cloud-only or self-hosted-only assumptions, no CDN fetches, new settings land in `.env.example` AND an admin surface); comment discipline (no phase/plan refs, no dividers, no numpydoc blocks, no `New`/`legacy`/`V2` identifiers); named exports, lazy routes, theme variables on the frontend; no backwards-compat shims anywhere |

Subagent prompts MUST (per `comment-discipline.md` section 5, delegated agents do not auto-load rules):

- name the exact rule files to read before looking at code, and the changed-file list in scope;
- require every candidate as `file:line` + a one-sentence claim + a concrete failure scenario ("as user X calling Y, Z happens");
- forbid running linters, `pnpm build`, `tsc`, or full test suites (targeted `-k` runs only, inside the docker containers, never on the host);
- return raw findings, not prose or praise.

## 4. Judge: verify every finding

For each candidate, re-read the cited code yourself and try to refute it. Check the claim against the real gate order, the real call sites, the real cache keys. Only findings that survive the refutation attempt are reported, and each keeps the evidence that confirmed it. This is the project bar: findings are a few sentences with file/function/line specifics and a fix proposal **that was actually verified during the review**, no guesses.

Classify what survives:

- **Bug** - broken at current scale. Goes in the review, severity-ordered.
- **Scaling limit** - correct today, falls over later. Goes in `.agents/scaling-reviews/{kebab-case}.md` with the load at which it bites and the mitigation levers; the review links it.
- **Consistency drift** - style, reuse, rule violations. Reported below the bugs, batched.

Known non-findings to reject on sight: an admin who cannot see a member's content (that is the permission model working); missing deprecation aliases or compat shims (pre-production, clean cuts are policy); generated-code diffs; missing docstrings on self-explanatory functions (comment discipline prefers deletion).

## 5. Report

Write `.agents/reviews/{kebab-case}.md` and reply with the same content:

- Header: date, scope (branch, commit range, uncommitted or not), upstream alignment status.
- Findings ordered most severe first, each with file/function/line, the verified failure scenario, and the verified fix proposal.
- A short "checked, nothing found" list per dimension actually swept, so silence reads as coverage rather than omission.
- Commands run and their results.

## 6. Fix (when the request includes it)

The skill's second hat is fixer. If the user asked for review-and-fix, apply the confirmed findings after reporting, one finding at a time:

- Fix, then prove it with a targeted test (`docker exec uniffy-dev-backend python -m pytest <file> -k <case>`) or the exact repro from the finding. No full suites, no linters during the loop.
- After any `.proto` edit: `./manage.py proto`, then restart the backend container (watchfiles does not reliably pick up generated-code changes).
- One full validation at the end only: `./manage.py lint -s backend` / `-s ui` for touched sides plus the relevant test suites.
- Update the review file with an outcome per finding (fixed / skipped and why).

## Gotchas

- **Do not restart the backend to "apply" a Python change** - it auto-reloads, and restarts kill live sessions. Restart only after proto regeneration.
- **Test tier discipline**: never assert on compiled SQL text; query behavior is proven on real Postgres in `tests/integration/` (local-only). Unit findings about filters belong there as row-level assertions.
- **A grep gate beats a claim.** "No caller remains" and "no import remains" are one command; run it and paste it rather than asserting it.
- **Big diffs**: review the operations and gates first, handlers second, UI last. The permission mistake is always in operations; the UI can render controls the backend denies and that is safe by design.
