---
name: uniffy-playwright
description: |
  Use the project MCP infrastructure to inspect the running app from inside Claude Code. Covers the Playwright MCP server (`uniffy-mcp-playwright` container) for headless-browser automation against the dev UI - navigate, snapshot, evaluate JS, capture console + network, and debug runtime state without leaving the conversation.

  TRIGGER when: the user asks you to "open the app", "click around", "check the browser", "use playwright", "drive the UI", "screenshot the page", "inspect runtime state in the browser", "check the console", "verify a fix in the running app", "log in as <user> and ..."; the user offers "do you want to connect to mcp"; a bug needs in-browser reproduction and the dev stack is running; you need to read live YDoc / Redux / window state to confirm a hypothesis.

  SKIP when: the user is asking about MCP / Playwright in general (not the project's setup); the task is pure backend, code-only, or covered by reading tests/logs; the dev stack is not running and the user hasn't asked you to start it.
user_invocable: true
---

# Uniffy MCP Infrastructure

The project ships a Playwright MCP server inside docker so Claude Code can drive a real Chrome against the dev UI. This skill is the operating manual.

## What runs

| Container | Image | Port | Purpose |
|---|---|---|---|
| `uniffy-mcp-playwright` | `uniffy-mcp-playwright` (custom, built from `.docker/dev/mcp-playwright.Dockerfile`) | `8931` (SSE) | Headless Chromium + Playwright MCP server. Claude reaches it via SSE at `http://localhost:8931/sse`. |

Connection wiring lives in `.mcp.json` at the repo root:

```json
{ "mcpServers": { "playwright": { "type": "sse", "url": "http://localhost:8931/sse" } } }
```

The container starts under the `dev` profile (`docker compose --profile dev up` or `./run.sh dev-up`). Compose config: `.docker/compose/dev-tools.yaml`. Image build: `.docker/dev/mcp-playwright.Dockerfile` - it bakes `@playwright/mcp` + `chrome-for-testing` + `chromium-headless-shell` so first request after a cold start does not stall on a 100MB+ download.

## Reaching the dev UI

The browser runs inside the docker network. Localhost from Claude's perspective is **not** localhost from the container's perspective. Use the docker-internal hostname:

- Frontend: `http://host.docker.internal:5173`
- Backend API: `http://host.docker.internal:8000`

The Vite dev server's `server.allowedHosts` includes `host.docker.internal` (see `src/ui/vite.config.ts`). Other hostnames produce `Blocked request. This host ... is not allowed.` - if you see that, the URL is wrong.

## Default credentials (dev only)

Seed user:

- email: `admin@uniffy.io`
- password: `admin` (or `$INITIAL_ADMIN_PASSWORD` if set)

Source of truth: `src/uniffy/db/seed.py:134`. The auth form has two `Sign in` buttons (mode switcher + submit). To submit, target `[data-testid="auth-submit-login"]` directly.

## Login recipe

The login `<input>` elements are typed-only via direct DOM events in newer React versions; the MCP `browser_type` selectors sometimes parse the textbox role oddly and throw. The reliable pattern is `browser_evaluate` to set values via the native `value` setter so React picks them up:

```js
const email = document.querySelector('input[type="email"], input[autocomplete="email"]');
const pwd = document.querySelector('input[type="password"]');
const setVal = (el, v) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
setVal(email, 'admin@uniffy.io');
setVal(pwd, 'admin');
```

Then `browser_click` on `[data-testid="auth-submit-login"]`, then click the workspace card on `/select-org`.

## Core MCP tools

| Tool | When to use |
|---|---|
| `browser_navigate` | Start of every session + page transitions. |
| `browser_snapshot` | Accessibility tree for the current page. Use this before clicking - it gives `ref=eXX` ids you can target. |
| `browser_click` / `browser_type` | Standard interactions. Use `target` = `ref=eXX` from the snapshot, OR a CSS / `data-testid` selector. |
| `browser_evaluate` | The escape hatch. Run arbitrary JS in the page context. Reach `window.__milkdownEditor`, `window.__milkdownEditorView`, Redux store (`window.store` if exposed), CSS-only queries, Y.Doc internals. |
| `browser_console_messages` | Pull console logs. Pass `level: "error"` + `all: true` to inspect everything since session start. |
| `browser_network_requests` | Inspect XHR/WebSocket traffic. Filter with the `filter` regex param. |
| `browser_take_screenshot` | Visual verification. Prefer `browser_snapshot` for action targeting (cheaper, structured). |
| `browser_press_key` / `browser_wait_for` | Keyboard shortcuts, async waits. `browser_wait_for` accepts `time` (seconds), `text`, or `textGone`. |

## Inspecting Yjs / Milkdown state

The notes editor exposes globals for debugging:

- `window.__milkdownEditor` - the Crepe-wrapped Milkdown editor
- `window.__milkdownEditorView` - the underlying ProseMirror `EditorView`

To read live YDoc state (e.g. confirm `Y.Text("markdown")` is being mirrored from PM transactions):

```js
const view = window.__milkdownEditorView;
for (const p of view.state.plugins) {
  const st = p.getState ? p.getState(view.state) : null;
  if (st?.binding?.doc) {
    const doc = st.binding.doc;
    const ytext = doc.share.get('markdown');
    const frag = doc.share.get('prosemirror');
    return {
      ytextLen: ytext?._length,
      ytextSample: ytext?.toString().slice(0, 200),
      fragmentLen: frag?.length,
    };
  }
}
```

The `y-sync$` plugin holds the binding; its `state.binding.doc` is the live `Y.Doc`.

## Operating the container

| Action | Command |
|---|---|
| Build / rebuild image | `docker compose build mcp-playwright` |
| Start | `docker compose --profile dev up -d mcp-playwright` (or `./run.sh mcp-up`) |
| Logs | `docker logs uniffy-mcp-playwright --tail 100 -f` |
| Restart (e.g. after image rebuild) | `docker compose restart mcp-playwright` |
| Tear down | `docker compose --profile dev down mcp-playwright` |

After editing the Dockerfile, rebuild and restart - the running container still uses the old image until then.

## Selector gotchas

- `browser_type` with `target` as the snapshot's `textbox` role description sometimes throws `Unexpected token while parsing css selector`. Fall back to `browser_evaluate` with the native setter pattern above.
- Tree nodes in the notes sidebar are not always React-routable links - many fire via `onClick` on a `div[data-node-id="..."]`. Use `browser_evaluate` to click the chevron `<button>` child to expand a folder before clicking the leaf.
- `strict mode violation: resolved to N elements` means the selector is ambiguous. Prefer `data-testid` attributes, or address by index via the snapshot `ref`.

## Workflow template

1. `browser_navigate` to `http://host.docker.internal:5173`.
2. `browser_snapshot` - confirm page state.
3. If unauthenticated, run the login recipe above.
4. Navigate to the failing surface (`/notes/<id>`, `/chat/...`, etc).
5. `browser_console_messages` with `level: "error", all: true` to capture any uncaught errors.
6. `browser_evaluate` for runtime state confirmation (YDoc, Redux, window globals).
7. `browser_take_screenshot` only when the user asks for visual evidence - the accessibility tree is faster and cheaper.
