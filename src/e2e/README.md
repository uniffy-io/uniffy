# Uniffy E2E Suite

End-to-end browser tests for the chat and agents domains, driven by
[Playwright](https://playwright.dev).

The same suite runs in three modes:

| Mode | Driver | Stack | Use when |
|---|---|---|---|
| Local with Claude Code | Playwright **MCP** server | `./run.sh dev` (live) | Reproducing or verifying a bug from a Claude session |
| Local headless | `playwright test` | `./run.sh dev` (live) | Pre-commit smoke check, full suite locally |
| CI | `playwright test` inside Docker | `docker-compose.e2e.yml` (ephemeral) | PRs labelled `[e2e]`, nightly runs |

The full plan lives at `.claude/plans/e2e-browser-tests.md`. Open issues
and active work track in `.claude/plans/backlogs/e2e-browser-tests-backlog.md`.

---

## Layout

```
src/e2e/
├── playwright.config.ts        # projects (setup, chromium), reporters, baseURL from env
├── package.json                # uniffy-e2e workspace package
├── tsconfig.json
├── .env.example                # all configurable env vars, copy to .env locally
├── setup/
│   └── auth.setup.ts           # logs each role in via API, writes storageState/{role}.json
├── fixtures/
│   └── api.ts                  # typed ConnectRPC clients + login helper (node-side)
├── helpers/
│   ├── selectors.ts            # central registry of data-testid strings
│   ├── waiters.ts              # waitForAppReady, waitForMessage, waitForStreamingComplete
│   └── factories.ts            # withChannel / withAgent fixtures + cleanup
├── specs/                      # Playwright tests, one file per scenario group
│   ├── auth/
│   ├── chat/
│   └── agents/
├── storageState/               # gitignored; populated by auth.setup.ts
└── reports/                    # gitignored; HTML report, traces, videos, JUnit XML
```

---

## First-time setup (local)

```bash
pnpm install
pnpm --filter uniffy-e2e setup            # downloads chromium + system deps
cp src/e2e/.env.example src/e2e/.env      # tweak only if your stack runs on non-default ports
```

Make sure the local stack is up:

```bash
./run.sh dev
```

That starts Postgres, Valkey, Meilisearch, RustFS, the backend (port 8000),
the worker, and Vite (port 5173). The dev seed creates `admin@uniffy.io` plus
`alice@/bob@/charlie@/diana@/eve@`, all with password `admin`.

---

## Running locally (headless)

```bash
pnpm --filter uniffy-e2e test
```

What happens:

1. The `setup` Playwright project runs `setup/auth.setup.ts` once per role,
   logs in via the AuthService, and writes `storageState/{role}.json` if the
   existing file is older than 10 minutes.
2. The `chromium` project runs every `*.spec.ts` under `specs/`, with each
   test inheriting a logged-in session via `test.use({ storageState })`.
3. Failures dump traces (`reports/test-results/.../trace.zip`), videos
   (`*.webm`), and screenshots into `reports/test-results/`.
4. Open `pnpm --filter uniffy-e2e report` to view the HTML report.

Useful flags:

```bash
pnpm --filter uniffy-e2e test:headed                       # show the browser
pnpm --filter uniffy-e2e test:ui                           # Playwright UI mode (best for authoring)
pnpm --filter uniffy-e2e test specs/chat/messaging.spec.ts # run one file
pnpm --filter uniffy-e2e test --grep "@smoke"              # tag-based filtering
```

---

## Running locally (Claude Code via Playwright MCP)

The Playwright MCP server runs **inside Docker**, not on your host. Zero
`npm install` of Playwright on the local machine; only `docker` is needed.

### One-time

1. Confirm `docker compose` is on PATH.
2. The `mcp-playwright` service is already declared in `docker-compose.yml`
   under the `mcp` profile, and `.mcp.json` at the repo root points Claude
   Code at `http://localhost:8931/sse`. No setup beyond pulling the image.

### Each session

```bash
./run.sh dev       # postgres + valkey + meilisearch + rustfs + backend + worker + UI
./run.sh mcp-up    # docker compose --profile mcp up -d mcp-playwright
```

`mcp-up` boots a long-lived `mcr.microsoft.com/playwright` container that
exposes the MCP SSE endpoint on port 8931 and runs a headless chromium
inside the container. After the container is healthy:

3. **Restart Claude Code** so it loads `.mcp.json` and connects to the
   MCP server. You should see `playwright` in the MCP tool list afterwards.
4. Drop a request like *"test chat features one by one"* and Claude will
   walk the checklist in `.claude/plans/chat-manual-test-via-mcp.md`,
   driving the app via the `browser_*` MCP tools.

### Network notes

- Inside the container, the host-side Vite dev server is reachable as
  `http://host.docker.internal:5173` (Linux: `extra_hosts: host-gateway`
  is wired in `docker-compose.yml`). Tell Claude to use that URL when
  navigating, not `localhost`.
- The container's chromium is **headless**. You won't see a live window;
  Claude reports state via `browser_snapshot` (accessibility tree dumps)
  and `browser_take_screenshot`.

### Stopping

```bash
./run.sh mcp-down  # docker compose --profile mcp down
./run.sh mcp-logs  # tail the MCP server logs
```

> **Tip**: Tell Claude to anchor on testids from `helpers/selectors.ts`
> (`chat-sidebar-channel-{id}`, `chat-message-row-{id}`,
> `chat-compose-input`, etc.). Stable selectors > CSS path lookups.

The MCP browser shares no storageState with the headless spec suite;
Claude logs in through the UI on first navigation. Anything reproduced
in MCP that we want to keep should be distilled into a spec under
`specs/` so it runs in CI.

---

## Running in CI (`docker-compose.e2e.yml`)

The CI workflow (`.github/workflows/e2e.yml`, added in Phase 6) is gated on the
`[e2e]` PR label and `workflow_dispatch`. It runs:

```bash
docker compose -f docker-compose.e2e.yml up \
  --build \
  --abort-on-container-exit \
  --exit-code-from playwright
```

Services come up in order:

```
postgres + valkey + meilisearch + rustfs   (healthchecks gate everything else)
        |
        v
backend (LLM_STUB=1) + worker
        |
        v
ui (vite build + vite preview at port 4173)
        |
        v
playwright (mcr.microsoft.com/playwright:vX-jammy)
```

The runner exits non-zero on failure. The workflow then copies
`reports/playwright-report/` and `reports/test-results/` out of the runner
container and uploads them as the `e2e-report` artifact (14-day retention).

---

## Authoring a new spec

1. **Pick the surface** and confirm the testid you need exists in
   `helpers/selectors.ts`. If not, add the `data-testid` attribute to the
   component first, then export the constant from `selectors.ts`.
2. **Use factories**, not seed data, for anything you mutate:
   ```ts
   import { test, expect } from '@e2e/helpers/factories';
   import { sidebar, compose, messages } from '@e2e/helpers/selectors';

   test.use({ storageState: 'storageState/admin.json' });

   test('admin can post a message', async ({ page, withChannel }) => {
     const channel = await withChannel();           // auto-cleaned in afterEach
     await page.goto(`/chat/${channel.id}`);
     await page.getByTestId(compose.input).fill('hello');
     await page.getByTestId(compose.sendButton).click();
     await expect(page.locator(`[data-testid^="${messages.row('')}"]`).last())
       .toContainText('hello');
   });
   ```
3. **Stream-aware asserts** use `waitForStreamingComplete(page)` from
   `helpers/waiters.ts` instead of arbitrary `setTimeout`.
4. **Two-tab scenarios** open a second `browser.newContext({ storageState: 'storageState/alice.json' })`
   and observe one tab while acting on the other.

---

## Anti-patterns

- **Don't** add waits with `page.waitForTimeout(N)`. Use auto-waiting locators
  or the explicit waiters in `helpers/waiters.ts`.
- **Don't** chain selectors by CSS path. Always anchor on a `data-testid`.
- **Don't** re-introduce the login UI flow in every spec. `auth.setup.ts`
  handles it once via the API; `auth/login-logout.spec.ts` is the single spec
  that exercises the login UI itself.
- **Don't** depend on seed users for state you can mutate (channels, agents,
  messages). Use `withChannel` / `withAgent`. Seed users are stable identities
  used for **multi-actor** scenarios (alice DMs bob, etc.) - never as content
  factories.
- **Don't** call real LLM providers. Agent specs run only when the backend has
  `LLM_STUB=1`, which short-circuits provider selection to a deterministic
  responder. CI sets this for you.

---

## Environment variables

See `.env.example` for the full list. Critical ones:

| Var | Default | Purpose |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:5173` | Where the browser navigates |
| `E2E_API_URL` | `http://localhost:8000` | Where node-side ConnectRPC clients hit the API |
| `E2E_LLM_STUB` | `0` | Mirror of backend `LLM_STUB`. Set to `1` for agent specs |
| `E2E_ADMIN_TOKEN` | (empty) | Bearer used by the `/api/_e2e/llm_stub` debug route |
| `E2E_ORG_SLUG` | (empty) | Optional org slug for login. Empty = first org for the user |
