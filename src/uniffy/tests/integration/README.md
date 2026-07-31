# Integration tests

Tests that need a real service behind them: an LLM provider API, a database,
a mail relay. They cost real money or real infrastructure, so they are
local-only for now: no CI wiring, run them deliberately.

## Layout

One subfolder per suite, each with its own `conftest.py` for suite-specific
fixtures; this folder's `conftest.py` only loads the repo-root `.env`.

| Folder | Covers |
|---|---|
| `providers/` | LLM provider APIs (Anthropic, OpenAI, Google, OpenRouter, xAI): tool round trips and the deferred tool-loading contract |
| `database/` | Domain operations against a real Postgres, where a mock would test the mock: encryption round trips, unique constraints, gate ordering against loaded rows |

Add new suites as sibling folders (e.g. `github/` for the GitHub integration,
`mail/` for a live SMTP relay) rather than growing an existing one.

A suite whose service is absent skips rather than fails: `providers/` skips
per missing key, `database/` skips whole when nothing answers on the
configured `DATABASE_URL`.

## Isolation from the unit suite

The unit runner (`./manage.py test -s backend`, CI) targets
`src/uniffy/tests/unit/` explicitly and never collects this folder.

## Running

```bash
./manage.py test -s integration                 # everything (docker stack)
./manage.py test -s integration --stack local   # host venv

# Direct pytest, e.g. one suite or one provider:
uv run pytest src/uniffy/tests/integration/providers/ -k anthropic -v
```

## Credentials and models (providers suite)

Keys are read from the environment, falling back to the repo-root `.env`:

| Provider | Env var |
|---|---|
| anthropic | `CLAUDE_API_KEY` |
| openai | `OPENAI_API_KEY` |
| google | `GOOGLE_GENAI_API_KEY` |
| openrouter | `OPENROUTER_API_KEY` |
| xai | `XAI_API_KEY` |

A provider whose key is missing is skipped, not failed. Each provider runs its
cheapest sensible model (see `DEFAULT_MODELS` in `providers/conftest.py`);
override with `UNIFFY_ITEST_MODEL_<PROVIDER>`, e.g.
`UNIFFY_ITEST_MODEL_OPENAI=gpt-5.5`.

These tests assert model BEHAVIOR (following the load-then-call pattern), so
a weak model can fail them without anything being broken in Uniffy. If one
provider fails while others pass, rerun it alone before digging.
