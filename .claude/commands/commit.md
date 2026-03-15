---
description: Create a conventional commit for all uncommitted changes
---

# Commit: Create Conventional Commit

## Process

### 1. Review Changes

Run these commands to understand what needs to be committed:

```bash
git status
git diff HEAD
git status --porcelain
```

### 2. Stage Files

Add untracked and changed files. Be selective -- do not stage files that contain secrets (`.env`, credentials, etc.).

### 3. Pre-Commit Checks

Before committing, verify the changes pass quality checks:

- If any `.proto` files changed: `./run.sh proto`
- If any Python files changed: `./run.sh lint-backend`
- If any frontend files changed: `./run.sh lint-frontend`

### 4. Create Commit

Use **conventional commit** format with a Uniffy domain scope:

```
<type>(<scope>): <short description>

<optional body with more detail>
```

**Types:**
- `feat` -- new feature or capability
- `fix` -- bug fix
- `refactor` -- code restructuring without behavior change
- `docs` -- documentation only
- `test` -- adding or updating tests
- `chore` -- tooling, config, dependencies
- `perf` -- performance improvement
- `style` -- formatting, linting fixes (no logic change)

**Scopes** (match domain directory names):
- Backend domains: `auth`, `users`, `organizations`, `groups`, `notes`, `files`, `calendar`, `projects`, `tasks`, `search`, `bookmarks`, `permissions`, `settings`, `attachments`, `agents`
- Frontend features: same as backend, plus `ui`, `theme`, `editor`
- Infrastructure: `proto`, `db`, `worker`, `config`, `ci`
- Cross-cutting: `core`, `shared`

**Examples:**
```
feat(notes): add collaborative editing support
fix(calendar): correct timezone offset in recurring events
refactor(auth): extract token validation into shared utility
docs(agents): update backend patterns documentation
chore(proto): regenerate protobuf definitions
```

### Rules

- NEVER use emojis in commit messages
- Keep the first line under 72 characters
- Use imperative mood ("add" not "added", "fix" not "fixed")
- If changes span multiple domains, use the most significant one as the scope
- Add a body paragraph for complex changes explaining the "why"
- NEVER include co-author information in the commit message
