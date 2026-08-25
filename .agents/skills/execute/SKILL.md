---
name: execute
description: Execute or resume an implementation plan from `.agents/local/plans/`, keeping its companion backlog and validation evidence current. Use when the user asks to implement a saved plan or continue planned multi-phase work.
---

# Execute: Implement from Plan

Use the plan path supplied with the request. If no path is supplied, proceed only when one plan is the unambiguous subject of the conversation; otherwise ask which plan to execute.

## 1. Read and understand

- Read the ENTIRE plan. Read the always-on rules and every path-scoped rule in `.agents/rules/` that matches the files in scope; the plan may name additional mandatory rule files.
- Check `.agents/local/plans/backlogs/` for an existing backlog. If one exists, resume from the first `[ ]` or `[~]` item instead of starting over.
- If the plan is multi-phase and no backlog exists, create one (convention in AGENTS.md "Plans, Backlogs and Reviews").
- Validate the plan against the current codebase before writing code: file paths, symbol names, and patterns it references may have drifted since it was written. Fix the plan's assumptions, not the codebase, when they disagree on facts.

## 2. Execute tasks in order

For each task:

- Read the referenced files before modifying them.
- Follow the plan's specification; stay consistent with the surrounding code and the auto-loaded rules.
- Verify as you go: correct imports, correct types, no drive-by refactors outside the task.

If something in the plan is wrong or missing, document the deviation in the backlog and continue; do not silently diverge.

## 3. Tests

Create the test files the plan specifies, following the existing test organization (unit tests for operations, integration tests for handlers). Cover the edge cases the plan lists.

## 4. Validate

```bash
./manage.py proto            # if .proto files changed
./manage.py lint -s backend  # if Python changed
./manage.py lint -s ui       # if frontend changed
./manage.py test             # backend tests
./manage.py test -s ui       # frontend tests
```

Fix and re-run until green. Do not skip validation steps.

## 5. Update the backlog

- Mark completed tasks `[x]`, in-progress `[~]` with a note, blocked `[!]` with the reason.
- Add a dated session note (absolute date) summarizing what changed.
- Commit the backlog update alongside the work.

## 6. Report

Summarize: tasks completed, files created/modified, tests added with results, validation output, deviations from the plan. State plainly whether the work is ready for the `commit` skill.
