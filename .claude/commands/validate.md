---
description: Run the full Uniffy validation pipeline and report results
---

# Validate: Full Project Validation

## Objective

Run every validation check available for the Uniffy project and report a structured summary of results.

## Process

### Step 1: Proto Check

Check if any `.proto` files have uncommitted changes:

```bash
git diff --name-only HEAD -- 'src/proto/**/*.proto'
git diff --cached --name-only -- 'src/proto/**/*.proto'
```

If any proto files changed, run:
```bash
./run.sh proto
```

Report: PASS/FAIL/SKIPPED (skipped if no proto changes)

---

### Step 2: Backend Linting

```bash
./run.sh lint-backend
```

Report: PASS/FAIL with error count

---

### Step 3: Frontend Linting

```bash
./run.sh lint-frontend
```

Report: PASS/FAIL with error count

---

### Step 4: Backend Formatting

```bash
./run.sh format
```

Check if formatting changed any files:
```bash
git diff --name-only
```

Report: PASS (no changes) / WARN (files were reformatted)

---

### Step 5: Backend Tests

```bash
./run.sh test
```

Report: PASS/FAIL with test count and failure details

---

### Step 6: Frontend Tests

```bash
./run.sh test-frontend
```

Report: PASS/FAIL with test count and failure details

---

### Step 7: Convention Checks

Scan for common CLAUDE.md rule violations:

**Frontend relative imports:**
Search for `from '../` or `from './` in `src/ui/src/` (excluding `node_modules/` and `gen/`).

**Frontend export default:**
Search for `export default` in `src/ui/src/` (excluding `node_modules/`, `gen/`, and `vite.config`).

**Frontend hardcoded colors:**
Search for patterns like `bg-zinc-`, `bg-gray-`, `bg-white`, `bg-black`, `text-white`, `text-black` in `src/ui/src/` component files (excluding `gen/` and config files where status colors are allowed).

**Python inline imports:**
Search for `import` statements that are NOT at the top of file in `src/uniffy/` (excluding `gen/` and `__init__.py`).

**Missing useDocumentTitle:**
For each page component in `src/ui/src/features/*/pages/`, verify it calls `useDocumentTitle`.

Report: PASS/WARN for each check with file paths for violations

---

### Step 8: Summary Report

```
## Validation Report

| Check | Status | Details |
|-------|--------|---------|
| Proto generation | PASS/FAIL/SKIP | {details} |
| Backend linting | PASS/FAIL | {error count} |
| Frontend linting | PASS/FAIL | {error count} |
| Backend formatting | PASS/WARN | {files changed} |
| Backend tests | PASS/FAIL | {X passed, Y failed} |
| Frontend tests | PASS/FAIL | {X passed, Y failed} |
| No relative imports | PASS/WARN | {violation count} |
| No export default | PASS/WARN | {violation count} |
| No hardcoded colors | PASS/WARN | {violation count} |
| No inline imports | PASS/WARN | {violation count} |
| useDocumentTitle | PASS/WARN | {missing count} |

### Overall: PASS / FAIL / WARN

{Summary of what needs attention}
```

## Notes

- Convention checks (Step 7) report WARN not FAIL because they may have intentional exceptions
- If any FAIL results, provide specific guidance on how to fix
- This command is designed to be run before committing or creating PRs
