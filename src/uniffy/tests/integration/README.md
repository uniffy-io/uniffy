# Integration tests

Tests that need running services. GitHub Actions runs every suite except
`agents/providers/`, with PostgreSQL, Valkey, Meilisearch, RustFS and FFmpeg provisioned for
the job. Unit tests run separately.

Application, migration and media suites run in parallel CI jobs. Migration
tests use four pytest workers, each with isolated scratch databases. Image
builds wait for every integration job to pass. Each job uploads its own JUnit
report and prints the ten slowest tests.

## Layout

`{area}/{suite}/`. The area says whose contract is under test, the suite says
what has to be running. Each suite owns its `conftest.py`; this folder loads
the repo-root `.env` and runs migration tests before the other suites.

| Suite | Needs | Covers |
|---|---|---|
| `agents/providers/` | A paid API key per provider | Anthropic, OpenAI, Google, OpenRouter and xAI: tool round trips and the deferred tool-loading contract |
| `internal/database/` | Postgres; playback tests also need S3 storage and FFmpeg | Transactions, constraints, content queries, encryption, notifications and file lifecycle |
| `internal/migrations/` | Postgres, plus rights to `CREATE DATABASE` | The whole Alembic chain applied to an empty database: reaches head, builds every table the models declare, and survives a second pass |
| `internal/media/` | Valkey, S3 storage, FFmpeg and fixture encoders | Queue admission, video conversion, thumbnails and object range reads |
| `access/`, `chat/`, `directory/people/` | Postgres | Content access, chat behavior and directory queries |

`internal/migrations/` checks fresh installs. Other database suites run
against a database that is already at head, where `upgrade head`
does nothing and reports success; that suite creates a scratch database per
test so a broken or missing migration fails before a deploy finds it. The
static half of the same question (one head, no duplicate ids, no dangling
parent) needs no database at all and already runs in CI as
`tests/unit/migrations/test_migration_chain.py`.

New suites go under the matching area (`internal/valkey/`,
`internal/meilisearch/`, `agents/embeddings/`) rather than growing an
existing one.

Provider tests skip missing keys. Database suites can skip when PostgreSQL is
unavailable locally. CI requires healthy services and successful migrations;
`REQUIRE_DATABASE_TESTS=1` also makes access and internal database fixture
failures fatal. Media tests require working storage and native tools.

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

Run the same selection as CI, including access, chat and directory suites:

```bash
uv run pytest src/uniffy/tests/integration/ --ignore=src/uniffy/tests/integration/agents/providers/
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
