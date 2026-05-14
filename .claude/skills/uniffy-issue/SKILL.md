---
name: uniffy-issue
description: |
  Create or refine a GitHub issue in `uniffy-io/uniffy` following project conventions: `[TYPE] Domain: desc` title format, `domain:*` + `area:*` + type labels, the four issue-template body shapes (bug / feature / security / performance), pre-creation recon with file:line pointers, native `addBlockedBy` GraphQL dependency links, project assignment to "Uniffy V1", and the image-attach workaround.

  TRIGGER when: the user asks to "create an issue", "open an issue", "file a bug", "draft a feature", "report a perf issue", "log a security issue", "make a gh issue"; the user writes a message starting with `[BUG]`, `[FEATURE]`, `[SECURITY]`, or `[PERFORMANCE]`; the user asks to rename existing issues to follow the title convention; the user pastes a screenshot of a bug or feature gap and asks to track it; the user describes a defect, missing capability, perf regression, or security weakness in this repo and asks to capture it.

  SKIP when: the user is creating a Pull Request the user is writing a commit message (use `commit`); the user is planning implementation work without filing a tracking issue (use `plan-feature`); the request is about a non-Uniffy repo; the user is asking general GitHub CLI questions unrelated to issue creation in this repo.
user_invocable: true
---

# Uniffy Issue Creation

Codifies the issue conventions for the `uniffy-io/uniffy` repo. Apply every time you draft, refine, or post an issue.

## Title format

`[TYPE] Domain: short description`

- `TYPE` is one of `BUG`, `FEATURE`, `SECURITY`, `PERFORMANCE`. Maps to the matching label.
- `Domain` is CamelCase matching a `domain:*` label (without the `domain:` prefix). Omit the `Domain:` segment only if the change is genuinely cross-cutting with no dominant domain.
- Keep titles under ~80 chars. Detail goes in the body, not the title.

Examples:
- `[BUG] Agents: cannot read images sent in chat`
- `[FEATURE] Chat: app-wide messenger dock`
- `[FEATURE] Agents: rooms domain tools`

## Templates

Four issue forms live in `.github/ISSUE_TEMPLATE/`:

| File | Use for |
|---|---|
| `bug.yml` | Defects in existing functionality |
| `feature.yml` | New functionality or significant enhancement |
| `security.yml` | Hardening, audit findings, dependency CVEs (NOT active exploits - those email `admins@uniffy.io`) |
| `performance.yml` | Slowness, high resource use, scalability |

When creating via `gh issue create --body`, write the body in the shape the matching template expects (same section headings + order). When the user files via the web UI, the template renders automatically.

## Labels

Always apply:
1. The type label: `bug` | `feature` | `security` | `performance`
2. One or more `domain:*` labels matching the affected vertical slice(s) - backend `src/uniffy/domains/<x>/` AND frontend `src/ui/src/features/<x>/` share the same domain label
3. Zero or more `area:*` labels for cross-cutting concerns: `area:frontend`, `area:mobile`, `area:proto`, `area:infra`, `area:docs`

A single issue can carry multiple `domain:*` labels (e.g. a feature touching chat + agents). Verify labels exist before applying (`gh label list | grep domain:`). Never invent new labels without user confirmation.

## Body sections (FEATURE template - the gold standard)

```
## Summary
One paragraph. What and why in one breath. No fluff.

## Motivation
User need, business driver, technical gap. The "so what".

## User Story
As a <role>, I want <capability> so that <outcome>.

## Scope

In:
- bullet of every behaviour the change must produce
- include concrete file paths and module names when known
- include acceptance-checkable items

Out:
- explicit non-goals (deferred to v2, separate issue, won't fix)
- prevents scope creep during execution

## Acceptance Criteria
- [ ] each criterion phrased as a verifiable check
- [ ] every Scope-In bullet should produce at least one box
- [ ] include tests, migrations, docs updates, telemetry as boxes
- [ ] always include rule-driven boxes that apply to the change

## Area
backend / frontend / mobile / proto / infra - matches the `area:*` labels

## Alternatives Considered
- **Option name.** One-line description. Rejected: reason.
- Three to five alternatives is typical. Show the road not taken.

## Additional Notes - First-Glance Pointers
Where the change lands in the codebase. File paths, class names, line numbers.
Hidden constraints, performance bars (see backend rules' Performance-Critical
Domains for chat/agents), prerequisite refactors.
```

For BUG: replace Motivation/Scope/Acceptance with Steps to Reproduce / Expected / Actual / Severity / Environment.
For SECURITY: Category / Severity / Impact / Reproduction-or-Evidence / Suggested Mitigation / References.
For PERFORMANCE: Current Measurement (numbers + how measured) / Target (threshold + why) / Reproduction / Profiling Evidence / Suspected Cause.

## Pre-creation recon (mandatory for non-trivial issues)

Before writing the body, do enough recon to make "Additional Notes - First-Glance Pointers" accurate. Verify the gap is real:

1. `Glob` / `Grep` the affected domain to confirm the claimed missing behaviour really is missing - never assert "code does not handle X" without searching.
2. Read the key files referenced in the body. Cite `file_path:line_number`.
3. Cross-check `.claude/rules/<domain>.md` for established patterns.
4. Check memory (`MEMORY.md`) for relevant project state, prior decisions, or feedback rules.

If the user says "first analyse" or "don't create yet", deliver findings as a regular response and wait for the go-ahead. Otherwise proceed to create after recon.

## Creating via gh CLI

```bash
gh issue create \
  --title "[FEATURE] Domain: title" \
  --label "feature,domain:<x>,area:<y>" \
  --body "$(cat <<'EOF'
## Summary
...
EOF
)"
```

After creation, capture the issue number from the URL output. Then:

1. **Add to the project** (Uniffy V1, number 1, owner uniffy-io):
   ```bash
   gh project item-add 1 --owner uniffy-io --url <issue-url>
   ```

2. **Link blockers** via GraphQL (gh CLI has no native flag):
   ```bash
   # Get node ids
   gh api graphql -f query='query { repository(owner:"uniffy-io", name:"uniffy") { issue(number:<blocked>) { id } } }' --jq '.data.repository.issue.id'
   gh api graphql -f query='query { repository(owner:"uniffy-io", name:"uniffy") { issue(number:<blocker>) { id } } }' --jq '.data.repository.issue.id'
   # Create the dependency
   gh api graphql -f query='mutation { addBlockedBy(input: { issueId: "<blocked-id>", blockingIssueId: "<blocker-id>" }) { issue { number } } }'
   ```
   Use the native dependency, NOT a plain comment or markdown link. The dependency shows in the sidebar and filters like `is:open is:issue -blocked:*`.

3. **If the user wants an image attached**: `gh` CLI cannot upload binary attachments. Two paths:
   - Default: create the issue without the image, tell the user to drag-drop into the issue in the browser (path stays at `/tmp/claude-imgs/...`).
   - Persistent: commit the image to a tracked location and reference via raw URL. Only with explicit user OK - polluting the repo for an issue asset is rarely worth it.

## Style and content rules

These come from `CLAUDE.md` and the feedback memory. Apply when drafting body text:

- **No emojis anywhere** (CLAUDE.md rule 0). Not in titles, not in bodies, not in commit messages, not in PR descriptions.
- **Single hyphens only** - never em-dashes or double-hyphens (CLAUDE.md rule 0). Use ` - ` or `,` to separate clauses.
- **Cite file:line** for "where this lands" pointers. Never invent paths. If you cannot verify, say "look around `domains/<x>/`" instead of fabricating a specific file.
- **No comments-style narration**. Body sections describe the work, not the conversation that led to it. Do not write "as discussed", "per the user", "from our chat earlier".
- **Acceptance Criteria boxes must be verifiable**. "Works correctly" is not a criterion. "`SUM(token_estimate)` query returns under 50ms p95 on 100k-row session" is.
- **Honour the no-backwards-compat rule** when scoping (memory: feedback_no_backwards_compat). If the issue introduces a breaking shape, scope says "update all call sites", not "add compat shim".
- **Rules-driven boxes**: when an issue touches a domain with rules in `.claude/rules/<x>.md`, fold the relevant rules into the acceptance criteria so they cannot be forgotten in implementation. Examples: chat changes must keep hot reads through Valkey caches; agents changes must populate `token_estimate` at INSERT; UI changes must use the theme system + responsive breakpoints + `useDocumentTitle`.

## Renaming existing issues

When asked to rename to follow the convention:
```bash
gh issue edit <num> --title "[TYPE] Domain: new title"
```
The convention applies to both issues and PRs (memory: feedback_pr_title_convention).

## Working backwards from a screenshot

If the user shares a screenshot showing a bug or feature request:
1. Read the image with the `Read` tool.
2. Recon the relevant code path.
3. Draft the body with concrete pointers.
4. Create the issue.
5. Tell the user how to attach the image (gh limitation).

## Defaults summary

| Field | Default |
|---|---|
| Repo | `uniffy-io/uniffy` |
| Project | `Uniffy V1` (org project number 1, owner `uniffy-io`) |
| Project assignment | Always add the new issue to the project |
| Type label | Match the TYPE prefix in the title |
| Domain labels | Include every domain the change touches |
| Area labels | Include for cross-cutting concerns only |
| Native dependency | Use `addBlockedBy` GraphQL when one issue blocks another |
| Image attach | Tell user to drag-drop in browser (gh limitation) |
