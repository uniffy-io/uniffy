---
name: plan-feature
description: Create a comprehensive Uniffy feature plan in `.agents/plans/` through deep codebase analysis, applicable rules, verified patterns, risks, tests, and executable validation steps. Use when the user asks to plan a feature or prepare implementation work without writing product code.
---

# Plan a Feature

Treat the feature description supplied with the request as the planning input. Resolve only ambiguities that materially change the architecture or scope.

Produce an implementation plan good enough for one-pass execution by an agent with no prior context. No code is written in this phase. The plan carries everything: patterns to mirror, files to read, gotchas, validation commands.

## 1. Understand the feature

- Extract the core problem, the user value, and the affected systems.
- Write or refine a user story: "As a <user> I want <action> so that <benefit>".
- If requirements are ambiguous, ask the user BEFORE researching further. Resolve architectural choices (libraries, approach) up front.

## 2. Codebase intelligence

Read the relevant rules first - they are the source of truth for their areas:

- `.agents/rules/architecture.md` - stack, vertical slices, URNs, Search Integration Checklist
- `.agents/rules/permissions.md` - access model (`access_mode` + `baseline_role`, `effective_role`, no admin bypass)
- `.agents/rules/backend.md` / `frontend.md` - conventions for whichever side the feature touches
- The matching domain rule (`chat-domain.md`, `files-domain.md`, `calls-domain.md`, `agents.md`, `notes-realtime.md`, `mentions.md`) when the feature lands in or near one

Then map the territory with repository search and any available code-intelligence tools. Delegate bounded read-only exploration only when the user or active instructions explicitly allow it.

- Find the most similar existing domain/feature and extract its vertical slice: proto -> model -> operations -> handlers -> service -> frontend api/store/components/pages.
- Identify integration points: `factory.py` mounts, `App.tsx` routes, `store.ts` reducers, proto files.
- Content types: does this need a URN, search indexing, permission rows? The Search Integration Checklist in `architecture.md` lists every file a new content type touches.
- Background work: check ARQ worker patterns if processing is needed.
- Check `.agents/plans/` for related prior plans and `.agents/plans/backlogs/` for in-flight work that overlaps.

## 3. External research (when the feature pulls in new tech)

Fetch official docs for any new library (with section anchors), note version constraints, known gotchas, and how existing dependencies already integrate. Respect the supply-chain policy in `AGENTS.md`: no CDN-fetching dependencies, and `minimumReleaseAge` applies.

## 4. Think through the design

Edge cases, race conditions, failure modes, performance (hot path? -> cache + invalidation are part of the plan, see backend rules), security (who can see/do what - both product targets from AGENTS.md), migration shape, and testability. Choose between alternatives with a stated rationale.

## 5. Write the plan

**Output:** `.agents/plans/{kebab-case-name}.md`. If the plan has 3+ phases or high complexity, also create `.agents/plans/backlogs/{name}-backlog.md` (convention in AGENTS.md).

Plan structure:

```markdown
# Feature: <name>

## Feature Description / User Story / Problem / Solution

## Context References
- Files to READ before implementing (path + line range + why)
- Rules that apply (list the specific .agents/rules/ files)
- New files to create (path + purpose)
- External docs (URL + section + why)

## Patterns to Follow
Concrete code excerpts from THIS codebase (file:line), not generic advice.

## Implementation Phases
Phase-by-phase breakdown with dependency order.

## Step-by-Step Tasks
One task per file-level change, ordered top-to-bottom, each with:
- ACTION (CREATE/UPDATE/ADD/REMOVE/REFACTOR/MIRROR) + target file
- Implementation detail, pattern reference (file:line), gotchas
- VALIDATE: an executable command proving the task landed

## Testing Strategy
Unit (operations) + integration (handlers) + edge cases, mirroring existing test layout.

## Validation Commands
./manage.py proto (if protos) / lint -s backend / lint -s ui / test / test -s ui

## Acceptance Criteria
Specific, measurable, including "works on both product targets" where relevant.
```

## 6. Report

Reply with: plan file path, approach summary, complexity assessment, key risks, and a confidence score (n/10) for one-pass implementation success.

Quality bar before you finish:

- Someone unfamiliar with the codebase could implement from the plan alone.
- Every task has a validation command; every pattern reference is file:line specific.
- No reinvention: existing helpers/components named where they cover a task.
- Nothing in the plan contradicts a rule file. When in doubt, the rule wins.
