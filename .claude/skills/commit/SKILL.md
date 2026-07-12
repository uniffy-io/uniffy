---
name: commit
description: Create a conventional commit for all uncommitted changes
---

# Commit: Create Conventional Commit

## Process

### 1. Review changes

```bash
git status
git diff HEAD
```

### 2. Stage files

Add untracked and changed files. Be selective - never stage files that contain secrets (`.env`, credentials, etc.).

### 3. Pre-commit checks

- If any `.proto` files changed: `./manage.py proto`
- If any Python files changed: `./manage.py lint -s backend`
- If any frontend files changed: `./manage.py lint -s ui`

### 4. Create commit

Conventional commit format with a Uniffy domain scope:

```
<type>(<scope>): <short description>

<optional body with more detail>
```

**Types:** `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `style`

**Scopes** (match domain directory names):
- Backend domains: `auth`, `users`, `organizations`, `groups`, `notes`, `files`, `calendar`, `projects`, `tasks`, `search`, `bookmarks`, `permissions`, `settings`, `attachments`, `agents`, `chat`, `calls`, `audit`, `platform`, `mail`
- Frontend features: same as backend, plus `ui`, `theme`, `editor`
- Infrastructure: `proto`, `db`, `worker`, `config`, `ci`
- Cross-cutting: `core`, `shared`

**Examples:**
```
feat(notes): add collaborative editing support
fix(calendar): correct timezone offset in recurring events
refactor(auth): extract token validation into shared utility
chore(proto): regenerate protobuf definitions
```

### Rules

- NEVER use emojis in commit messages
- Keep the first line under 72 characters
- Imperative mood ("add" not "added")
- Changes spanning multiple domains: use the most significant one as scope
- Add a body paragraph for complex changes explaining the why
- NEVER include co-author information in the commit message
