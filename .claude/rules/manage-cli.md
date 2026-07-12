---
paths:
  - "**/*"
---

# Project CLI (manage.py)

All project commands go through `./manage.py`, a PEP 723 uv script (click). `./manage.py --help` shows the full tree.

## Command map

| Purpose | Command |
|---|---|
| First start, everything | `./manage.py start` (docker) / `start --stack local` (host app, infra in docker) |
| Compose lifecycle | `./manage.py stack up\|down\|rebuild\|reset-data` (`-p mobile` etc., default profiles core+dev) |
| Logs | `./manage.py logs [-s <service>] [--stack local\|docker]` - docker tails compose services; local tails `.logs/*.log` written by `serve all` |
| Host dev processes | `./manage.py serve backend\|worker-core\|worker-egress\|ui\|landing\|mobile\|all` |
| Dependencies | `./manage.py deps install\|add\|remove\|update\|run -s backend\|ui\|mobile\|landing [--stack local\|docker]` |
| Codegen | `./manage.py proto` (defaults to the toolbox container), `licenses`, `clean` |
| Quality | `./manage.py lint [-s backend\|ui\|mobile\|cli]`, `format`, `test [-s backend\|ui\|cli]`, `bench` |
| Database | `./manage.py db shell\|migrate` |
| unictl (Go) | `./manage.py cli build\|install\|run\|lint\|test` |
| Landing | `./manage.py landing build\|preview\|deploy` |
| Toolbox shell | `./manage.py toolbox <cmd>` (deps-manager container: pnpm + uv + buf) |

Every command with a `--stack` option defaults to `docker` (`deps`, `proto`, `licenses`, `lint`, `test`, `format`, `bench`, `db migrate`). Host toolchains run only on explicit `--stack local` - a default must never implicitly create `.venv` or `node_modules` on the host. `serve` (host dev processes) and `cli` (Go) are host-only by definition.

## Detect the stack before managing dependencies

When installing, adding, removing, or updating dependencies, detect which mode is in use instead of guessing:

1. `docker compose ps --status running` shows backend/ui/mobile containers up -> use `--stack docker` (the default).
2. No containers running but host `.venv/bin/python` and `node_modules` exist -> the developer works natively -> use `--stack local`. A bare `.venv` directory without `bin/python` does not count (empty or root-owned leftovers).
3. Neither -> use `--stack docker`; never implicitly install toolchains onto the host.

Lockfile and package.json changes land on the bind mount in docker mode, so git sees them either way.

## Supply-chain policy

`pnpm-workspace.yaml` sets `minimumReleaseAge` (5 days): versions younger than the window are refused at resolution time, and lockfile entries are re-verified on install. This applies identically on host and in containers - do not bypass it (no `--config.minimum-release-age=0`, no `trustLockfile`). If a fresh, deliberately chosen version is blocked, surface it to the user; waiting or a scoped `minimumReleaseAgeExclude` is their call.
