---
description: Execute an implementation plan
argument-hint: [path-to-plan]
---

# Execute: Implement from Plan

## Plan to Execute

Read plan file: `$ARGUMENTS`

## Execution Instructions

### 1. Read and Understand

- Read the ENTIRE plan carefully
- Understand all tasks and their dependencies
- Note the validation commands to run
- Review the testing strategy
- Read `CLAUDE.md` critical rules before starting
- If the plan touches backend code, read `.claude/rules/backend.md`
- If the plan touches frontend code, read `.claude/rules/frontend.md`
- Check for an existing backlog file in `.claude/plans/backlogs/`. If one exists, resume from the first `[ ]` or `[~]` item instead of starting from scratch
- If the plan has multiple phases and no backlog exists, create one in `.claude/plans/backlogs/` (see CLAUDE.md "Plans and Backlogs" section)

### 2. Execute Tasks in Order

For EACH task in "Step by Step Tasks":

#### a. Navigate to the task
- Identify the file and action required
- Read existing related files if modifying

#### b. Implement the task
- Follow the detailed specifications exactly
- Maintain consistency with existing code patterns
- Include proper type hints and documentation
- Backend: use async patterns, check permissions, use `BaseContentOperations` for content
- Frontend: use `@/` absolute imports, named exports, theme variables, `useDocumentTitle`

#### c. Verify as you go
- After each file change, check syntax
- Ensure imports are correct (no relative imports in frontend, no inline imports in Python)
- Verify types are properly defined

### 3. Implement Testing Strategy

After completing implementation tasks:

- Create all test files specified in the plan
- Implement all test cases mentioned
- Follow the testing approach outlined
- Ensure tests cover edge cases

### 4. Run Validation Commands

Execute the Uniffy validation pipeline in order:

```bash
# If .proto files changed
./run.sh proto

# Linting
./run.sh lint-backend
./run.sh lint-frontend

# Formatting
./run.sh format

# Tests
./run.sh test
./run.sh test-frontend
```

If any command fails:
- Fix the issue
- Re-run the command
- Continue only when it passes

### 5. Final Verification

Before completing:

- [ ] All tasks from plan completed
- [ ] All tests created and passing
- [ ] All validation commands pass
- [ ] Code follows CLAUDE.md critical rules
- [ ] No relative imports in frontend code
- [ ] No `export default` in frontend code
- [ ] No hardcoded colors in frontend
- [ ] No inline imports in Python
- [ ] Page components use `useDocumentTitle()`
- [ ] Domain layouts support Zen Mode
- [ ] Documentation added/updated as needed

## Output Report

Provide summary:

### Completed Tasks
- List of all tasks completed
- Files created (with paths)
- Files modified (with paths)

### Tests Added
- Test files created
- Test cases implemented
- Test results

### Validation Results
```bash
# Output from each validation command
```

### Ready for Commit
- Confirm all changes are complete
- Confirm all validations pass
- Ready for `/commit` command

### 6. Update Backlog

If a backlog exists (or was created in step 1):
- Mark completed tasks `[x]`
- Mark in-progress tasks `[~]` with a brief note
- Add a dated session note at the bottom summarizing what changed
- Commit the backlog update alongside the work

## Notes

- If you encounter issues not addressed in the plan, document them in the backlog
- If you need to deviate from the plan, explain why in the backlog
- If tests fail, fix implementation until they pass
- Don't skip validation steps
