# arq (vendored, valkey-backed)

Vendored from [arq](https://github.com/samuelcolvin/arq) **0.28.0**, with its Redis client swapped for
**valkey-py** so the platform runs a single Redis-protocol client (valkey) end to end.

## Changes vs upstream

- `redis.*` imports → `valkey.*` (valkey-py is an API-compatible fork; `Redis` / `ConnectionPool` are kept
  as aliases, `RedisError` maps to `valkey.exceptions.ValkeyError`).
- **Public API renamed to Valkey terms:** `RedisSettings`→`ValkeySettings`, `ArqRedis`→`ArqValkey`, the
  worker `redis_settings`/`redis_pool` params + the `WorkerSettings.redis_settings` attribute →
  `valkey_settings`/`valkey_pool`, and the `ctx['redis']` job key → `ctx['valkey']`.
- `ValkeySettings.from_dsn` accepts the `valkey://` / `valkeys://` URL schemes alongside `redis://`.
- Module logging routes through **loguru** via `arq/_logging.py` (a stdlib-shaped adapter), so arq's logs
  land in the platform logger; arq's `%`-style call sites are kept as-is. (`cli.py`'s `dictConfig` remains
  but is vestigial — the worker logs via the adapter.)
- `log_valkey_info` logs `valkey_version` (Valkey advertises a fixed `redis_version` compatibility value, so
  upstream's startup line read e.g. `7.2.4` against a 9.x server).

The API is renamed to Valkey terms (no longer a drop-in for upstream's Redis names). To pull upstream
changes, re-diff against the tagged release and re-apply the import swap + the renames above.
