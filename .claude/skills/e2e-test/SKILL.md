---
name: e2e-test
description: Comprehensive end-to-end testing command. Launches parallel sub-agents to research the codebase (structure, database schema, potential bugs), then uses the Vercel Agent Browser CLI to test every user journey -- taking screenshots, validating UI/UX, and querying the database to verify records. Run after implementation to validate everything before code review.
disable-model-invocation: true
---

# End-to-End Application Testing

## Uniffy Context

**Dev server:** `./run.sh dev` (starts backend + frontend + worker with hot reload)
- Backend URL: `http://localhost:8000`
- Frontend URL: `http://localhost:5173`
- API: ConnectRPC (Protocol Buffers + Connect) -- not REST

**Database:** PostgreSQL, connect via `./run.sh db-shell` or `docker compose exec postgres psql -U uniffy -d uniffy`

**Auth flow:** JWT tokens (access + refresh). Users authenticate globally, then select an organization context. Tokens are in-memory only on the frontend.

**Key user journeys:**
- Authentication: register, login, org selection, logout
- Notes: create, edit (Milkdown editor), @mention, permissions, share
- Files: upload (chunked), browse, preview, thumbnails, attachments
- Calendar: create events, recurring events, RSVP, day/week/month views
- Projects/Tasks: create project, add tasks, assign, status flow
- Search: full-text search, type filters, @mention lookup
- Agent chat: AI assistant conversations
- Admin: org members, groups, permissions, settings
- Settings: user preferences, keyboard shortcuts, theme

**Package managers:** `uv` for Python, `pnpm` for frontend

---

## Pre-flight Check

### 1. Platform Check

agent-browser requires **Linux, WSL, or macOS**. Check the platform:
```bash
uname -s
```
- `Linux` or `Darwin` -> proceed
- Anything else (e.g., `MINGW`, `CYGWIN`, or native Windows) -> stop with:

> "agent-browser only supports Linux, WSL, and macOS. It cannot run on native Windows. Please run this command from WSL or a Linux/macOS environment."

Stop execution if the platform is unsupported.

### 2. Frontend Check

Verify the application has a browser-accessible frontend. For Uniffy, check:
- `src/ui/package.json` exists with a dev script
- `src/ui/src/app/router.tsx` exists (frontend routes)

If no frontend is detected:
> "This application doesn't appear to have a browser-accessible frontend. E2E browser testing requires a UI to visit. For backend-only or API testing, a different approach is needed."

Stop execution if no frontend is found.

### 3. agent-browser Installation

Check if agent-browser is installed:
```bash
agent-browser --version
```

If the command is not found, install it automatically:
```bash
npm install -g agent-browser
```

After installation (or if it was already installed), ensure the browser engine is set up:
```bash
agent-browser install --with-deps
```

The `--with-deps` flag installs system-level Chromium dependencies on Linux/WSL. On macOS it is harmless.

Verify installation succeeded:
```bash
agent-browser --version
```

If installation fails, stop with:
> "Failed to install agent-browser. Please install it manually with `npm install -g agent-browser && agent-browser install --with-deps`, then re-run this command."

## Phase 1: Parallel Research

Launch **three sub-agents simultaneously** using the Task tool. All three run in parallel.

### Sub-agent 1: Application Structure & User Journeys

> Research this codebase thoroughly. This is a Uniffy application -- an enterprise workspace with notes, files, chat, AI assistants, calendar, and workflows. Return a structured summary covering:
>
> 1. **How to start the application** -- use `./run.sh dev` to start all services. Backend on port 8000, frontend on port 5173.
> 2. **Authentication/login** -- check seed data in `src/uniffy/db/seed_data/` for test credentials. Auth uses JWT tokens with ConnectRPC. Check `src/proto/auth/v1/auth.proto` for auth methods.
> 3. **Every user-facing route/page** -- read `src/ui/src/app/router.tsx` for all routes
> 4. **Every user journey** -- complete flows a user can take. For each journey, list the specific steps, interactions (clicks, form fills, navigation), and expected outcomes
> 5. **Key UI components** -- forms, modals, dropdowns, pickers, toggles, and other interactive elements that need testing. Check `src/ui/src/components/` and `src/ui/src/features/`
>
> Be exhaustive. Testing will only cover what you identify here.

### Sub-agent 2: Database Schema & Data Flows

> Research this codebase's database layer. This uses PostgreSQL with SQLModel (async). DO NOT read `.env` directly. Return a structured summary covering:
>
> 1. **Database type and connection** -- PostgreSQL, connectable via `./run.sh db-shell`
> 2. **Full schema** -- read models in `src/uniffy/core/models/` and domain-specific models in `src/uniffy/domains/*/`. Check Alembic migrations in `src/uniffy/db/migrations/`
> 3. **Data flows per user action** -- for each user-facing action, document what records are created, updated, or deleted and in which tables
> 4. **Validation queries** -- for each data flow, provide the exact query to verify records are correct after the action

### Sub-agent 3: Bug Hunting

> Analyze this codebase for potential bugs, issues, and code quality problems. Focus on:
>
> 1. **Logic errors** -- incorrect conditionals, off-by-one errors, missing null checks, race conditions
> 2. **UI/UX issues** -- missing error handling in forms, no loading states, broken responsive layouts, accessibility problems
> 3. **Data integrity risks** -- missing validation, potential orphaned records, incorrect cascade behavior
> 4. **Security concerns** -- SQL injection, XSS, missing auth checks, exposed secrets
> 5. **CLAUDE.md rule violations** -- relative imports, export default, hardcoded colors, missing useDocumentTitle, inline imports in Python
>
> Return a prioritized list with file paths and line numbers.

**Wait for all three sub-agents to complete before proceeding.**

## Phase 2: Start the Application

Using the startup information:

1. Start the dev server **in the background**: `./run.sh dev &`
2. Wait for both servers to be ready (backend on 8000, frontend on 5173)
3. Open the app with `agent-browser open http://localhost:5173` and confirm it loads
4. Take an initial screenshot: `agent-browser screenshot e2e-screenshots/00-initial-load.png`

## Phase 3: Create Task List

Using the user journeys from Sub-agent 1 and findings from Sub-agent 3, create a task (using TaskCreate) for each user journey. Each task should include:

- **subject:** The journey name (e.g., "Test note creation and editing flow")
- **description:** Steps to execute, expected outcomes, database records to verify, and any related bug findings from Sub-agent 3
- **activeForm:** Present continuous (e.g., "Testing note creation and editing flow")

Also create a final task: "Responsive testing across viewports."

## Phase 4: User Journey Testing

For each task, mark it `in_progress` with TaskUpdate and execute the following.

### 4a. Browser Testing

Use the Vercel Agent Browser CLI for all browser interaction:

```
agent-browser open <url>              # Navigate to a page
agent-browser snapshot -i             # Get interactive elements with refs (@e1, @e2...)
agent-browser click @eN               # Click element by ref
agent-browser fill @eN "text"         # Clear field and type
agent-browser select @eN "option"     # Select dropdown option
agent-browser press Enter             # Press a key
agent-browser screenshot <path>       # Save screenshot
agent-browser screenshot --annotate   # Screenshot with numbered element labels
agent-browser set viewport W H        # Set viewport (e.g., 375 812 for mobile)
agent-browser wait --load networkidle # Wait for page to settle
agent-browser console                 # Check for JS errors
agent-browser errors                  # Check for uncaught exceptions
agent-browser get text @eN            # Get element text
agent-browser get url                 # Get current URL
agent-browser close                   # End session
```

**Refs become invalid after navigation or DOM changes.** Always re-snapshot after page navigation, form submissions, or dynamic content updates (modals, tabs, theme changes).

For each step in a user journey:

1. Snapshot to get current refs
2. Perform the interaction
3. Wait for the page to settle
4. **Take a screenshot** -- save to a descriptive path under `e2e-screenshots/` organized by journey (e.g., `e2e-screenshots/notes/03-note-saved.png`)
5. **Analyze the screenshot** -- use the Read tool to view the screenshot image. Check for visual correctness, UX issues, broken layouts, missing content, error states
6. Check `agent-browser console` and `agent-browser errors` periodically for JavaScript issues

Be thorough. Go through EVERY interaction, EVERY form field, EVERY button. The goal is that by the time this finishes, every part of the UI has been exercised and screenshotted.

### 4b. Database Validation

After any interaction that should modify data (form submits, deletions, updates):

1. Query the database to verify records using `./run.sh db-shell` or:
   ```bash
   docker compose exec postgres psql -U uniffy -d uniffy -c "SELECT ..."
   ```
2. Verify:
   - Records created/updated/deleted as expected
   - Values match what was entered in the UI
   - URNs are properly generated for content
   - Relationships between records are correct
   - No orphaned or duplicate records
   - Permission records exist where expected

### 4c. Issue Handling

When an issue is found (UI bug, database mismatch, JS error):

1. **Document it:** what was expected vs what happened, screenshot path, relevant DB query results
2. **Fix the code** -- make the correction directly
3. **Re-run the failing step** to verify the fix worked
4. **Take a new screenshot** confirming the fix

### 4d. Responsive Testing

For the responsive testing task, revisit key pages at these viewports:

- **Mobile:** `agent-browser set viewport 375 812`
- **Tablet:** `agent-browser set viewport 768 1024`
- **Desktop:** `agent-browser set viewport 1440 900`

At each viewport, screenshot every major page. Analyze for layout issues, overflow, broken alignment, and touch target sizes on mobile.

After completing each journey, mark its task as `completed` with TaskUpdate.

## Phase 5: Cleanup

After all testing is complete:
1. Stop the dev server background process
2. Close the browser session: `agent-browser close`

## Phase 6: Report

### Text Summary (always output)

Present a concise summary:

```
## E2E Testing Complete

**Journeys Tested:** [count]
**Screenshots Captured:** [count]
**Issues Found:** [count] ([count] fixed, [count] remaining)

### Issues Fixed During Testing
- [Description] -- [file:line]

### Remaining Issues
- [Description] -- [severity: high/medium/low] -- [file:line]

### Bug Hunt Findings (from code analysis)
- [Description] -- [severity] -- [file:line]

### Screenshots
All saved to: `e2e-screenshots/`
```

### Markdown Export (ask first)

After the text summary, ask the user:

> "Would you like me to export the full testing report to a markdown file? It includes per-journey breakdowns, all screenshot references, database validation results, and detailed findings -- useful as context for follow-up fixes or GitHub issues."

If yes, write a detailed report to `e2e-test-report.md` in the project root containing:
- Full summary with stats
- Per-journey breakdown: steps taken, screenshots, database checks, issues found
- All issues with full details, fix status, and file references
- Bug hunt findings from the code analysis sub-agent
- Recommendations for any unresolved issues
