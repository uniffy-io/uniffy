---
paths:
  - "**/*"
---

# Comment and Naming Discipline

These rules apply to every file in the repo. They exist because the codebase reads better as a finished product than as a changelog or a session log. When you touch a file, it is a good moment to clean up any patterns below that drifted in.

## 1. Skip decorative divider comments

Decorative divider comments and standalone section labels tend to add noise without clarity.

**Patterns that tend to cause friction, so we skip them:**

- Repeated punctuation as a visual separator: `# ----`, `# ====`, `// ----`, `// ====`, `/* ---- */`, `# ****`, any line whose only purpose is to draw a line.
- Standalone section-label comments that exist only to name a group of methods or variables: `# Helpers`, `# Constants`, `# Setup`, `# Cleanup`, `// Actions`, `// Selectors`, `// Types`, `// Internal helpers`.
- Combinations of the two (a label sandwiched between two divider lines).

**Why:** code structure is self-evident from the code itself. Class boundaries, function signatures, and import groups already group things visually. These comments add noise, fight against IDE outline views, and rot when methods move.

**Applies to:** Python, TypeScript, JavaScript, Go, Rust, CSS, SQL, proto - every language. Docstring section headers like `Args:` / `Returns:` / `Raises:` in Python and JSDoc tags are not dividers and are a good fit.

## 2. Skip process-history comments

Comments that reference process artifacts or history tend to rot fast.

**Patterns we skip:**

- Plan names, phase numbers, step numbers: `Phase 3`, `step 2`, `P5 wires this`, `plan §6.4`, `shipped as P8`, `lands in P7`, `(P2)`.
- Backlog items, ticket IDs, PR numbers, session work, commit shas: `see backlog`, `tracked in INGEST-142`, `from PR #99`, `added in this session`.
- Plan file paths: `.claude/plans/foo.md`, `.claude/plans/backlogs/bar-backlog.md`.
- Legacy / prior-implementation narration: `previously used X`, `was a class before`, `old method returned Y`, `renamed from Z`, `replaces the old handler`, `formerly the visibility scope`, `legacy color picker`, `before this binding landed`.
- Tense-of-the-fix narration: `this change`, `we now`, `as of this commit`, `the new approach`.

**Why:** git history is the source of truth for how code evolved. Plan files, ticket trackers, and PR descriptions live elsewhere. Comments embedded in code rot the moment the next refactor lands - a comment that says "Phase 2 wraps this in ARQ" is wrong the day Phase 2 is merged.

**Reach for instead:** comments focused on the WHY of the *current* code - hidden constraints, non-obvious invariants, surprising behavior, workarounds for specific upstream bugs (link the issue, not the internal plan). A comment that merely restates what the code does or narrates how it got here is a good candidate for deletion.

**Migrations are the one exception:** migration docstrings inherently describe a transition (`drop the legacy X column`, `backfill Y from Z`). Keep them tight and focused on the schema change, not on which plan or rewrite produced them.

**Wire-protocol names are not process artifacts:** `SyncStep1`, `SyncStep2`, `SYNC_UPDATE`, etc. are y-protocols message types. Same for HTTP/2 frame names, TCP states, etc. Keep them.

## 3. Skip process artifacts in identifiers

Baking process artifacts into file names, test names, function names, class names, variable names, fixture names, or any other identifier tends to make code harder to read down the line.

**Patterns we skip:**

- Phase / plan / migration suffixes: `test_foo_phase1.py`, `test_foo_phase5.py`, `test_foo_unified_tags.py`, `def test_phase2_handler()`, `class NewMembersService`, `handle_v2`, `process_legacy`, `migrate_old_X`, `useNotesV2`.
- "New" / "old" / "legacy" prefixes on production code: `NewAuthService`, `OldChannelLoader`, `legacy_handler`.
- Version digits that encode iteration rather than wire/API version: `Resolver2`, `runV3`. (Actual API versions like `users.v1` or `notes.v2.proto` are fine - those are external contracts.)

**Why:** identifiers persist forever and get read thousands of times. A name that encodes which plan introduced it stops describing what the thing does the moment the plan is forgotten. New readers cannot tell whether `handle_v2` is the canonical handler or an experiment.

**When work from a plan lands:**

- Merge phase-tests into the canonical domain test file. `test_agents_in_chat_phase1.py` + `test_agents_in_chat_phase2.py` -> `test_agents_in_chat.py`.
- Rename "new" / "v2" identifiers to the canonical name once the old one is gone.
- Rename existing offenders on sight when you touch the file for any reason.

Names work best when they describe what the thing IS or DOES, not which plan / phase / migration introduced it or what it replaced.
