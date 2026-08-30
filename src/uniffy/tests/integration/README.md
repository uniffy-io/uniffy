# Integration tests

Tests that need something running behind them. Local-only: CI provisions no
services, so the unit runner targets `src/uniffy/tests/unit/` and never
collects this tree. Run these deliberately.

## Layout

`{area}/{suite}/`. The area says whose contract is under test, the suite says
what has to be running. Each suite owns its `conftest.py`; this folder's only
loads the repo-root `.env`.

| Suite | Needs | Covers |
|---|---|---|
| `agents/providers/` | A paid API key per provider | Anthropic, OpenAI, Google, OpenRouter and xAI: tool round trips and the deferred tool-loading contract |
| `internal/database/` | Postgres | Integrations-slice security: `OrgCipher` round trips, cross-org isolation, unique constraints, admin-gate ordering, and what an error string leaks |
| `internal/migrations/` | Postgres, plus rights to `CREATE DATABASE` | The whole Alembic chain applied to an empty database: reaches head, builds every table the models declare, and survives a second pass |

`internal/migrations/` is the one that makes wiring CI worth it. Every other
check runs against a database that is already at head, where `upgrade head`
does nothing and reports success; that suite creates a scratch database per
test so a broken or missing migration fails before a deploy finds it. The
static half of the same question (one head, no duplicate ids, no dangling
parent) needs no database at all and already runs in CI as
`tests/unit/migrations/test_migration_chain.py`.

New suites go under the matching area (`internal/valkey/`,
`internal/meilisearch/`, `agents/embeddings/`) rather than growing an
existing one.

**A suite whose service is absent skips rather than fails.** `providers/`
skips per missing key, `database/` skips whole when nothing answers on
`DATABASE_URL`. A run with nothing up reports skips, not a wall of
connection errors.

## Cost

`agents/providers/` spends real money on every run and asserts the behavior
of models we do not control, so a weak model can fail it with nothing broken
here. `internal/` is free and deterministic. Target a subtree when you only
mean one:

```bash
./manage.py test -s integration                          # everything
uv run pytest src/uniffy/tests/integration/internal/     # free half
uv run pytest src/uniffy/tests/integration/agents/ -k anthropic -v
```

## Running

```bash
./manage.py test -s integration                 # docker stack
./manage.py test -s integration --stack local   # host venv
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

Each provider runs its cheapest sensible model (see `DEFAULT_MODELS` in
`agents/providers/conftest.py`); override with `UNIFFY_ITEST_MODEL_<PROVIDER>`,
e.g. `UNIFFY_ITEST_MODEL_OPENAI=gpt-5.5`. If one provider fails while others
pass, rerun it alone before digging.
