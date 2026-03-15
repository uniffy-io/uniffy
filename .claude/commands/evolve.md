---
description: Audit and update all AI development artifacts to stay current with project changes
---

# Evolve: Self-Updating AI Artifact Audit

## Objective

Audit all AI development artifacts (CLAUDE.md, AGENTS.md, commands, skills) against the current state of the codebase and update anything that has drifted.

## Process

### Phase 1: Scan Current State

Gather information about the project as it exists now:

**1. Domain Inventory**

```bash
ls src/uniffy/domains/
ls src/ui/src/features/
ls src/proto/
```

**2. Model Inventory**

```bash
ls src/uniffy/core/models/
```

**3. Available Commands**

Read `run.sh` to see all available commands.

**4. ContentType Enum**

Read `src/uniffy/core/models/shared.py` to get the current ContentType values.

**5. URN Types**

Read `src/ui/src/shared/utils/urnTypes.ts` to get the current URN types.

**6. Frontend Routes**

Read `src/ui/src/app/router.tsx` for current routes.

**7. Backend Services**

Read `src/uniffy/factory.py` for mounted services.

**8. Recent Changes**

```bash
git log -20 --oneline
git diff --name-only HEAD~20
```

---

### Phase 2: Audit CLAUDE.md / AGENTS.md

Read `CLAUDE.md` and verify each section:

| Section | Check |
|---------|-------|
| Tech Stack | Versions match `pyproject.toml` and `src/ui/package.json` |
| Commands | All commands in `run.sh` are documented |
| Project Structure | Directory tree matches actual layout |
| Architecture | Description matches current patterns |
| URN Types | Supported types match ContentType enum |
| Search Checklist | All listed files still exist and are correct |
| Key Files | All listed files exist |
| Critical Rules | No new patterns warrant a rule |

**Report findings** -- list what's current vs what needs updating.

---

### Phase 3: Audit Commands

Read each command file in `.claude/commands/` and verify:

| File | Check |
|------|-------|
| `commit.md` | Scope list matches current domain names |
| `execute.md` | Validation commands match `run.sh` |
| `plan-feature.md` | File references are current, patterns match |
| `prime.md` | Key file paths exist, doc paths correct |
| `create-prd.md` | Sections reference current architecture |
| `create-rules.md` | No significant issues expected |
| `evolve.md` | File paths and checks are current |
| `scaffold-domain.md` | Template matches current domain pattern |
| `validate.md` | Check patterns match current codebase |

---

### Phase 4: Audit Skills

Read each skill file in `.claude/skills/` and verify:

| Skill | Check |
|-------|-------|
| `frontend-design/SKILL.md` | Theme classes match current theme system, component library references correct |
| `e2e-test/SKILL.md` | URLs, commands, and user journeys are current |
| `pr/SKILL.md` | Categories match current architecture |

---

### Phase 5: Generate Report

Output a structured report:

```
## Evolve Audit Report

### Status: [All Current / Updates Needed]

### CLAUDE.md / AGENTS.md
- [x] Tech Stack: current
- [ ] Commands: missing `./run.sh new-command` (added in commit abc123)
- [x] Project Structure: current
...

### Commands
- [x] commit.md: scopes current
- [ ] plan-feature.md: missing reference to new domain
...

### Skills
- [x] frontend-design: theme system current
...

### Recommended Updates
1. Add `new-command` to CLAUDE.md Commands section
2. Add `new-domain` to commit.md scope list
3. ...
```

---

### Phase 6: Apply Updates

For each recommended update:

1. Show the user what will change
2. Apply the update
3. Verify CLAUDE.md and AGENTS.md remain in sync (CLAUDE.md is a symlink to AGENTS.md)

---

### Phase 7: Final Sync Check

Verify that CLAUDE.md and AGENTS.md point to the same content:

```bash
ls -la CLAUDE.md AGENTS.md
```

If they are separate files (not symlinked), ensure their content is identical.

## Notes

- This command is designed to be run periodically as the project evolves
- It should be non-destructive -- it reports before making changes
- Focus on factual accuracy (file paths, enum values, command names) not stylistic preferences
- If significant structural changes are detected, recommend running `/create-rules` for a full regeneration instead
