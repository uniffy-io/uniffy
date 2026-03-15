---
description: Prime agent with codebase understanding
---

# Prime: Load Project Context

## Objective

Build comprehensive understanding of the Uniffy codebase by analyzing structure, documentation, and key files.

## Process

### 1. Analyze Project Structure

List all tracked files:
!`git ls-files`

Show directory structure:
On Linux, run: `tree -L 3 -I 'node_modules|__pycache__|.git|dist|build|gen'`

### 2. Read Core Documentation

Read these files to understand project rules and patterns:

- `CLAUDE.md` -- project rules, critical constraints, search integration checklist
- `docs/agents/backend.md` -- backend patterns, domain slices, API services, models, permissions
- `docs/agents/frontend.md` -- frontend patterns, components, hooks, theme system, Redux

### 3. Identify Key Files

Read these files to understand the application structure:

**Backend:**
- `src/uniffy/factory.py` -- service registry, all mounted ConnectRPC services and HTTP routes
- `src/uniffy/main.py` -- application entrypoint
- `src/uniffy/core/models/shared.py` -- ContentType enum, base models

**Frontend:**
- `src/ui/src/app/router.tsx` -- all frontend routes
- `src/ui/src/app/store.ts` -- Redux store, all registered reducers
- `src/ui/src/config/api.ts` -- ConnectRPC transport, auth interceptor

**Proto:**
- `src/proto/common/v1/common.proto` -- shared enums and messages

**Configuration:**
- `pyproject.toml` -- Python dependencies and tools
- `src/ui/package.json` -- frontend dependencies
- `run.sh` -- all available commands

### 4. Scan Domain Landscape

List the backend domains and frontend features to understand the application scope:

```bash
ls src/uniffy/domains/
ls src/ui/src/features/
ls src/proto/
```

### 5. Understand Current State

Check recent activity:
!`git log -10 --oneline`

Check current branch and status:
!`git status`

## Output Report

Provide a concise summary covering:

### Project Overview
- Purpose and type of application
- Primary technologies and frameworks
- Current version/state

### Architecture
- Domain-driven vertical slice pattern
- ConnectRPC proto-first API
- Multi-tenant organization model
- Permission system (three-layer)

### Domain Inventory
- List all backend domains with brief purpose
- List all frontend features with brief purpose
- Note any domains that exist in backend but not yet in frontend (or vice versa)

### Tech Stack
- Languages and versions
- Frameworks and major libraries
- Build tools and package managers
- Testing frameworks

### Core Principles
- CLAUDE.md critical rules summary
- Code style and conventions observed
- Documentation standards

### Current State
- Active branch
- Recent changes or development focus
- Any immediate observations or concerns

**Make this summary easy to scan - use bullet points and clear headers.**
