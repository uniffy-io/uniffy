#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["click>=8.1"]
# ///
"""Uniffy project CLI. Run `./manage.py` for the command tree."""

import json
import os
import re
import shlex
import subprocess
import sys
import tomllib
from datetime import UTC, datetime
from pathlib import Path

import click

ROOT = Path(__file__).resolve().parent
LOG_DIR = ROOT / ".logs"

Stack = click.Choice(["local", "docker"])

# service -> (compose service, pnpm filter, compose profile); backend uses uv
NODE_SERVICES = {
    "ui": ("ui", "uniffy-ui", "dev"),
    "landing": ("landing", "uniffy-landing", "dev"),
    "mobile": ("mobile", "uniffy-mobile", "mobile"),
}

# Production images: (dockerfile, registry repository). Both build from the
# repo root through the whitelist in .dockerignore.
IMAGES = {
    "backend": ("src/uniffy/Dockerfile", "ghcr.io/uniffy-io/uniffy"),
    "frontend": ("src/ui/Dockerfile", "ghcr.io/uniffy-io/uniffy-frontend"),
}

# Image tooling runs from digest-pinned images, never from a host install.
IMAGE_TOOLS = {
    "hadolint": (
        "hadolint/hadolint:v2.15.1"
        "@sha256:32dac94127fd60b7b7e3fbfc65e1383b9b5e25c9bfd7b8536de7a539fe68a12d"
    ),
    # v1.16.0; the registry publishes no version tags, so the digest is the pin.
    "structure-test": (
        "gcr.io/gcp-runtimes/container-structure-test:latest"
        "@sha256:377f9a9bc00376b9fa6dc6a3a020dbe40e84ebe9481b71969aa3ff9d1c9ea17e"
    ),
    "trivy": (
        "aquasec/trivy:0.74.0"
        "@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969"
    ),
}

DOCKER_SOCKET = "/var/run/docker.sock"

REPO_URL = "https://github.com/uniffy-io/uniffy"
VERIFY_DOCS_URL = "https://uniffy.io/docs/deployment/verify/"
RELEASE_TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$")

# Release notes list commits per area by the paths they touch. Anything outside
# these prefixes is core; a commit spanning areas is listed under each.
RELEASE_AREAS = {
    "Landing": ("src/landing/",),
    "Mobile": ("src/mobile/",),
}
# GitHub caps a release body at 125000 characters; the rest is one link away.
RELEASE_NOTES_MAX_COMMITS = 200

PASSTHROUGH = {"ignore_unknown_options": True}


# Injected into every command so container entrypoints can drop to the host
# user - bind-mounted writes then stay host-owned instead of root-owned.
HOST_IDS = (
    {"HOST_UID": str(os.getuid()), "HOST_GID": str(os.getgid())} if hasattr(os, "getuid") else {}
)

# `compose exec` bypasses the entrypoint privilege drop, so exec'd commands
# pass the user explicitly. HOME points at the dir the entrypoint created.
EXEC_AS_HOST = (
    ["--user", f"{os.getuid()}:{os.getgid()}", "--env", "HOME=/tmp/home"]
    if hasattr(os, "getuid")
    else []
)


def sh(
    cmd: list[str],
    cwd: Path | None = None,
    check: bool = True,
    env: dict | None = None,
    stdin=None,
) -> int:
    click.secho(f"$ {shlex.join(cmd)}", fg="cyan", err=True)
    full_env = {**os.environ, **HOST_IDS, **(env or {})}
    return subprocess.run(cmd, cwd=cwd or ROOT, check=check, env=full_env, stdin=stdin).returncode


def git_out(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()


def sh_ok(cmd: list[str]) -> bool:
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    return result.returncode == 0 and bool(result.stdout.strip())


def compose(*args: str, profiles: list[str] | None = None) -> list[str]:
    cmd = ["docker", "compose"]
    for profile in profiles or []:
        cmd += ["--profile", profile]
    return [*cmd, *args]


def compose_project() -> str:
    """The docker compose project name - the prefix on every volume and network."""
    out = subprocess.run(
        ["docker", "compose", "config", "--format", "json"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return json.loads(out)["name"]


def container_running(service: str) -> bool:
    # Enable every profile: a bare `compose ps` hides services whose profile is
    # not active (e.g. mobile), so a running container would read as stopped.
    return sh_ok([
        "docker",
        "compose",
        "--profile",
        "core",
        "--profile",
        "dev",
        "--profile",
        "mobile",
        "ps",
        "-q",
        "--status",
        "running",
        service,
    ])


def docker_pnpm(
    service: str,
    args: list[str],
    env_keys: tuple[str, ...] = (),
    publish: tuple[str, ...] = (),
) -> None:
    svc, filter_, profile = NODE_SERVICES[service]
    # Bare `--env KEY` makes compose read the value from this process's
    # environment, so secrets never appear in the echoed command line.
    env_flags = [flag for key in env_keys if os.environ.get(key) for flag in ("--env", key)]
    if container_running(svc) and not publish:
        sh(compose("exec", *EXEC_AS_HOST, *env_flags, svc, "pnpm", "--filter", filter_, *args))
    else:
        # exec cannot add port mappings, so anything with `publish` gets a
        # one-off container even while the dev service is running.
        port_flags = [flag for port in publish for flag in ("--publish", port)]
        sh(
            compose(
                "run",
                "--rm",
                "--no-deps",
                *env_flags,
                *port_flags,
                svc,
                "pnpm",
                "--filter",
                filter_,
                *args,
                profiles=[profile],
            )
        )


def docker_uv(args: list[str]) -> None:
    if container_running("backend"):
        sh(compose("exec", *EXEC_AS_HOST, "backend", "uv", *args))
    else:
        sh(compose("run", "--rm", "--no-deps", "backend", "uv", *args, profiles=["dev"]))


def toolbox_run(args: list[str]) -> None:
    sh(compose("run", "--rm", "--no-deps", "deps-manager", *args, profiles=["dev"]))


def workspace_cmd(service: str, stack: str, args: list[str]) -> None:
    if service == "backend":
        sh(["uv", *args]) if stack == "local" else docker_uv(args)
    else:
        if stack == "local":
            sh(["pnpm", "--filter", NODE_SERVICES[service][1], *args])
        else:
            docker_pnpm(service, args)


@click.group()
def cli():
    """Uniffy project CLI.

    Most commands take --stack local|docker: local runs the host toolchain,
    docker runs inside the dev containers (nothing installed on the host).
    """


@cli.group()
def deps():
    """Install and manipulate dependencies per workspace."""


service_option = click.option(
    "--service",
    "-s",
    type=click.Choice(["backend", "ui", "mobile", "landing", "all"]),
    default="all",
)
stack_option = click.option("--stack", type=Stack, default="docker", show_default=True)


BACKEND_COMPOSE_SERVICES = (("backend", "dev"), ("worker-core", "dev"), ("worker-egress", "dev"))


def _docker_sync(compose_svc: str, profile: str) -> None:
    """Bring one container's dependency volumes in line with the lockfiles.

    Every app container owns separate anonymous volumes (node_modules, .venv),
    so a lock change only reaches a RUNNING container by re-running its
    entrypoint - restart does exactly that (chown pass + hash-guarded frozen
    install). A throwaway `compose run` would install into fresh anonymous
    volumes and discard them; it is only useful to pre-warm the shared store
    when the container is not running.
    """
    if container_running(compose_svc):
        sh(compose("restart", compose_svc, profiles=[profile]))
    else:
        sh(compose("run", "--rm", "--no-deps", compose_svc, "true", profiles=[profile]))


def _resync_after_lock_change(service: str) -> None:
    """Restart the sibling backend containers after a backend dependency change.

    Only backend has siblings that need it: backend, worker-core and
    worker-egress run the same `uniffy` package from a shared lockfile into
    separate `.venv` volumes, so a new dep reaches them only on an entrypoint
    re-run. Node workspaces install distinct `--filter`ed subsets into
    container-private node_modules, so a dep added to one (e.g. ui) never
    changes another's (landing / mobile) install - those self-heal on their
    next start via the entrypoint lockfile-hash guard.
    """
    if service != "backend":
        return
    for svc, profile in BACKEND_COMPOSE_SERVICES:
        if svc != "backend" and container_running(svc):
            sh(compose("restart", svc, profiles=[profile]))


@deps.command("install")
@service_option
@stack_option
def deps_install(service: str, stack: str):
    """Sync dependencies from the lockfiles (restarts running containers in docker mode)."""
    if stack == "docker":
        if service == "all":
            toolbox_run(["true"])
            for svc, profile in [
                *BACKEND_COMPOSE_SERVICES,
                *((s, p) for s, _, p in NODE_SERVICES.values()),
            ]:
                if container_running(svc):
                    sh(compose("restart", svc, profiles=[profile]))
        elif service == "backend":
            _docker_sync("backend", "dev")
            _resync_after_lock_change("backend")
        else:
            svc, _, profile = NODE_SERVICES[service]
            _docker_sync(svc, profile)
            _resync_after_lock_change(service)
        return
    if service in ("backend", "all"):
        sh(["uv", "sync"])
    if service in ("ui", "mobile", "landing"):
        sh(["pnpm", "install", "--filter", f"{NODE_SERVICES[service][1]}..."])
    elif service == "all":
        sh(["pnpm", "install"])
        sh(["go", "mod", "tidy"], cwd=ROOT / "src/gen/go")
        sh(["go", "mod", "tidy"], cwd=ROOT / "src/unictl")


def _mutate(service: str, stack: str, verb: str, packages: tuple[str, ...], dev: bool):
    if service == "backend":
        args = [
            "add" if verb == "add" else verb,
            *(["--dev"] if dev and verb == "add" else []),
            *packages,
        ]
        workspace_cmd("backend", stack, args)
    else:
        args = [verb, *(["--save-dev"] if dev and verb == "add" else []), *packages]
        workspace_cmd(service, stack, args)
    if stack == "docker":
        _resync_after_lock_change(service)


@deps.command("add")
@click.argument("packages", nargs=-1, required=True)
@click.option(
    "--service", "-s", type=click.Choice(["backend", "ui", "mobile", "landing"]), required=True
)
@stack_option
@click.option("--dev", is_flag=True, help="Add as a dev dependency.")
def deps_add(packages, service, stack, dev):
    """Add packages to a workspace (pkg@version also pins upgrades/downgrades)."""
    _mutate(service, stack, "add", packages, dev)


@deps.command("remove")
@click.argument("packages", nargs=-1, required=True)
@click.option(
    "--service", "-s", type=click.Choice(["backend", "ui", "mobile", "landing"]), required=True
)
@stack_option
def deps_remove(packages, service, stack):
    """Remove packages from a workspace."""
    _mutate(service, stack, "remove", packages, False)


@deps.command("update")
@click.argument("packages", nargs=-1)
@click.option(
    "--service", "-s", type=click.Choice(["backend", "ui", "mobile", "landing"]), required=True
)
@stack_option
def deps_update(packages, service, stack):
    """Update packages (all in range when none given)."""
    if service == "backend":
        if packages:
            # Bare `uv sync --upgrade` upgrades the WHOLE lock; scope to the named
            # packages by re-locking just those, then install.
            workspace_cmd("backend", stack, ["lock", *(f"--upgrade-package={p}" for p in packages)])
            workspace_cmd("backend", stack, ["sync"])
        else:
            workspace_cmd("backend", stack, ["sync", "--upgrade"])
    else:
        workspace_cmd(service, stack, ["update", *packages])
    if stack == "docker":
        _resync_after_lock_change(service)


@deps.command("run", context_settings=PASSTHROUGH)
@click.argument("args", nargs=-1, required=True, type=click.UNPROCESSED)
@click.option(
    "--service", "-s", type=click.Choice(["backend", "ui", "mobile", "landing"]), required=True
)
@stack_option
def deps_run(args, service, stack):
    """Raw pnpm (node) or uv (backend) passthrough for a workspace."""
    workspace_cmd(service, stack, list(args))


@cli.command(context_settings=PASSTHROUGH)
@click.argument("args", nargs=-1, required=True, type=click.UNPROCESSED)
def toolbox(args):
    """Run a command in the deps-manager toolbox (pnpm, uv, buf). Try: toolbox bash"""
    toolbox_run(list(args))


@cli.group()
def stack():
    """Docker compose stack lifecycle."""


profiles_option = click.option(
    "--profile", "-p", "profiles", multiple=True, default=("core", "dev"), show_default=True
)


@stack.command("up")
@profiles_option
@click.option("--detach", "-d", is_flag=True, help="Start and return without tailing logs.")
@click.option("--no-build", is_flag=True, help="Start without rebuilding changed images.")
def stack_up(profiles, detach, no_build):
    """Start the containerized stack (edge on :80, direct ports for tooling).

    Starts detached, rebuilding images whose Dockerfile/context changed
    (cached, so a no-op when nothing changed), then tails logs. Ctrl+C stops
    the tail only - the stack keeps running.
    """
    sh(compose("up", "-d", *([] if no_build else ["--build"]), profiles=list(profiles)))
    if detach:
        return
    try:
        sh(compose("logs", "-f", "--tail", "50", profiles=list(profiles)), check=False)
    except KeyboardInterrupt:
        pass


@stack.command("down")
@profiles_option
def stack_down(profiles):
    sh(compose("down", profiles=list(profiles)))


def _image_siblings(target: str) -> list[tuple[str, str]]:
    """Every (service, profile) sharing one built image with `target`.

    backend/worker-core/worker-egress share `uniffy-dev-backend`;
    ui/landing/mobile share `uniffy-dev-node`. Rebuilding one must recreate its
    siblings so the new image and the entrypoint's frozen dep-sync reach them all.
    """
    node = [(name, prof) for name, (_, _, prof) in NODE_SERVICES.items()]
    if target in ("backend", "worker-core", "worker-egress"):
        return list(BACKEND_COMPOSE_SERVICES)
    if target in NODE_SERVICES:
        return node
    return [(target, "dev")]


@stack.command("rebuild")
@click.argument("services", nargs=-1)
def stack_rebuild(services):
    """Rebuild dev images without cache (after a Dockerfile change) and recreate the running containers on them."""
    targets = services or ("backend", "ui", "deps-manager")
    sh(compose("build", "--no-cache", *targets, profiles=["dev"]))
    by_profile: dict[str, list[str]] = {}
    for svc, profile in {s: p for t in targets for s, p in _image_siblings(t)}.items():
        if container_running(svc):
            by_profile.setdefault(profile, []).append(svc)
    for profile, running in by_profile.items():
        sh(compose("up", "-d", "--no-deps", *running, profiles=[profile]))


@stack.command("recreate")
@click.argument("services", nargs=-1)
@profiles_option
@click.option("--detach", "-d", is_flag=True, help="Start and return without tailing logs.")
@click.option("--no-build", is_flag=True, help="Start without rebuilding changed images.")
@click.option("--yes", "-y", is_flag=True, help="Skip the confirmation prompt.")
@click.pass_context
def stack_recreate(ctx, services, profiles, detach, no_build, yes):
    """Recreate containers so compose changes (command, env, volumes) take effect.

    With SERVICES, force-recreate just those containers and nothing else - the
    surgical way to apply an edited command/env without a rebuild or data loss.
    With no SERVICES, tear down EVERYTHING and start fresh: all containers, all
    volumes (postgres/valkey/meilisearch/rustfs plus every cache volume) and
    orphans, then run the `stack up` flow.
    """
    if services:
        sh(
            compose(
                "up",
                "-d",
                "--force-recreate",
                "--no-deps",
                *services,
                profiles=["core", "dev", "mobile"],
            )
        )
        return
    if not yes:
        click.confirm(
            "This deletes ALL containers and volumes for every profile (data is gone). Continue?",
            abort=True,
        )
    sh(compose("down", "--volumes", "--remove-orphans", profiles=["all"]))
    ctx.invoke(stack_up, profiles=profiles, detach=detach, no_build=no_build)


@stack.command("reset-data")
def stack_reset_data():
    """Wipe postgres/valkey/meilisearch/rustfs volumes and restart the backend."""
    prefix = compose_project()
    volumes = [
        f"{prefix}_{suffix}"
        for suffix in (
            "postgres_data",
            "valkey_data",
            "meilisearch_data",
            "rustfs_data",
            "rustfs_logs",
        )
    ]
    click.echo("This will WIPE these docker volumes (data is gone):")
    for volume in volumes:
        click.echo(f"  {volume}")
    click.echo("UI and landing stay running; backend + workers restart to re-run migrations.")
    click.confirm("Continue?", abort=True)
    infra = ["postgres", "valkey", "meilisearch", "rustfs"]
    sh(compose("stop", *infra))
    sh(compose("rm", "-f", *infra))
    sh(["docker", "volume", "rm", *volumes])
    sh(compose("up", "-d", *infra))
    sh(compose("restart", "backend", "worker-core", "worker-egress"))
    sh(compose("up", "-d", "--no-deps", "seeder"))
    click.echo("Done. Tail migrations with: ./manage.py logs -s backend")
    click.echo("Demo data reseeds in the background: ./manage.py logs -s seeder")


@cli.group()
def serve():
    """Run dev processes natively on the host (infra stays in containers)."""


def _watch(target: str) -> list[str]:
    return [
        "uv",
        "run",
        "watchfiles",
        "--filter",
        "python",
        f"python -m uniffy --{target}",
        "src/uniffy/",
        "src/gen/python/",
    ]


@serve.command("backend")
@click.option("--reload/--no-reload", default=True, show_default=True)
def serve_backend(reload):
    sh(_watch("backend") if reload else ["uv", "run", "python", "-m", "uniffy", "--backend"])


@serve.command("worker-core")
@click.option("--reload/--no-reload", default=True, show_default=True)
def serve_worker_core(reload):
    sh(_watch("worker-core") if reload else ["uv", "run", "python", "-m", "uniffy", "--worker-core"])


@serve.command("worker-egress")
@click.option("--reload/--no-reload", default=True, show_default=True)
def serve_worker_egress(reload):
    sh(
        _watch("worker-egress")
        if reload
        else ["uv", "run", "python", "-m", "uniffy", "--worker-egress"]
    )


@serve.command("ui")
def serve_ui():
    sh(["pnpm", "--filter", "uniffy-ui", "dev"])


@serve.command("landing")
def serve_landing():
    sh(["pnpm", "--filter", "uniffy-landing", "dev"])


@serve.command("mobile")
@click.option("--web", is_flag=True, help="Web build instead of the Metro QR flow.")
def serve_mobile(web):
    args = ["pnpm", "--filter", "uniffy-mobile", "exec", "expo", "start"]
    sh([*args, "--web", "--port", "8081"] if web else args)


@serve.command("all")
def serve_all():
    """Backend + both workers + vite, all native with hot reload."""
    LOG_DIR.mkdir(exist_ok=True)
    click.echo("Backend :8000, Frontend :5173, workers core + egress")
    click.echo(
        "Backend/worker output goes to .logs/*.log - tail with: ./manage.py logs --stack local"
    )
    procs = []
    for target in ("backend", "worker-core", "worker-egress"):
        log = (LOG_DIR / f"{target}.log").open("ab")
        procs.append(
            subprocess.Popen(_watch(target), cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        )
    try:
        sh(["pnpm", "--filter", "uniffy-ui", "dev"])
    finally:
        for proc in procs:
            proc.terminate()


@cli.command()
@click.option("--stack", type=Stack, default="docker", show_default=True)
@click.option(
    "--profile", "-p", "profiles", multiple=True, help="Extra compose profiles (e.g. -p mobile)."
)
@click.pass_context
def start(ctx, stack, profiles):
    """One-command first start: docker = full containerized stack, local = host deps + infra containers + native processes."""
    if stack == "docker":
        # --build is a cached no-op when Dockerfiles are unchanged, so start
        # always reflects the current image definitions
        sh(compose("up", "-d", "--build", profiles=["core", "dev", *profiles]))
        click.secho(
            "Stack running detached. Ctrl+C stops this log tail, not the stack "
            "(stop with: ./manage.py stack down)",
            fg="green",
        )
        # tail app services only; infra (core profile) logs via ./manage.py logs
        sh(compose("logs", "-f", profiles=["dev", *profiles]), check=False)
        return
    if not (ROOT / ".venv").exists() or not (ROOT / "node_modules").exists():
        ctx.invoke(deps_install, service="all", stack="local")
    sh(compose("up", "-d", profiles=["core", *profiles]))
    ctx.invoke(serve_all)


@cli.command()
@click.option(
    "--service",
    "-s",
    "services",
    multiple=True,
    help="Service(s) to tail; repeatable (-s backend -s ui). Omit for all.",
)
@click.option("--stack", type=Stack, default="docker", show_default=True)
def logs(services, stack):
    """Tail logs. docker = compose services; local = processes started by `serve all`."""
    if stack == "docker":
        sh(compose("logs", "-f", *services, profiles=["core", "dev", "mobile"]))
        return
    files = [LOG_DIR / f"{s}.log" for s in services] if services else sorted(LOG_DIR.glob("*.log"))
    files = [f for f in files if f.exists()]
    if not files:
        raise click.ClickException(
            "No local log files in .logs/ - start processes with ./manage.py serve all"
        )
    sh(["tail", "-n", "100", "-F", *(str(f) for f in files)])


@cli.command()
@click.option("--stack", type=Stack, default="docker", show_default=True)
def proto(stack):
    """Generate protobuf code for python, typescript, and go."""
    if stack == "docker":
        toolbox_run(["uv", "run", "manage.py", "proto", "--stack", "local"])
        sh(["go", "mod", "tidy"], cwd=ROOT / "src/gen/go", check=False)
        sh(["go", "mod", "tidy"], cwd=ROOT / "src/unictl", check=False)
        return
    click.echo("Generating protobuf code...")
    gen_python = ROOT / "src/gen/python/src/uniffy_proto"
    sh(["rm", "-rf", str(gen_python)])
    packages = sorted(p.name for p in (ROOT / "src/proto").iterdir() if p.is_dir())
    for pkg in packages:
        sh(["rm", "-rf", str(ROOT / "src/gen/typescript" / pkg)])
    sh(["find", "src/gen/go", "-name", "*.go", "-delete"], check=False)
    sh(["buf", "generate"], env={"PATH": f"{ROOT}/src/ui/node_modules/.bin:{os.environ['PATH']}"})
    (gen_python / "__init__.py").write_text(
        "import os\nimport sys\n\nsys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))\n"
    )
    for pkg in packages:
        (gen_python / pkg / "v1").mkdir(parents=True, exist_ok=True)
        (gen_python / pkg / "__init__.py").touch()
        (gen_python / pkg / "v1" / "__init__.py").touch()
    # go mod tidy needs go, absent in the toolbox image; the docker branch
    # runs it on the host after generation
    if stack == "local":
        sh(["go", "mod", "tidy"], cwd=ROOT / "src/gen/go", check=False)
        sh(["go", "mod", "tidy"], cwd=ROOT / "src/unictl", check=False)
    click.echo("Protobuf code generated (python, typescript, go)")


@cli.command()
@click.option("--stack", type=Stack, default="docker", show_default=True)
def licenses(stack):
    """Regenerate docs/LICENSES.md from the python and node dependency trees."""
    if stack == "docker":
        toolbox_run(["uv", "run", "manage.py", "licenses", "--stack", "local"])
        return
    click.echo("Generating third-party licenses...")
    out = ROOT / "docs/LICENSES.md"
    header = (
        "# Third-Party Licenses\n\n"
        "This file lists all third-party dependencies used in Uniffy and their licenses.\n\n"
        "This file is auto-generated by running `./manage.py licenses`.\n\n"
        "Third-party trademarks (provider names and logos) are covered separately "
        "in [TRADEMARKS.md](./TRADEMARKS.md).\n\n"
        "## Python Dependencies\n\n"
    )
    python_rows = subprocess.run(
        [
            "uv",
            "run",
            "pip-licenses",
            "--format=markdown",
            "--with-urls",
            "--ignore-packages",
            "uniffy",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    node_json = subprocess.run(
        ["pnpm", "licenses", "list", "--prod", "--json"],
        cwd=ROOT / "src/ui",
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    rows = []
    for license_name, pkgs in json.loads(node_json).items():
        for pkg in pkgs:
            rows.append((
                f"{pkg['name']}@{pkg['versions'][0]}",
                license_name,
                pkg.get("homepage", ""),
            ))
    node_table = "\n".join(f"| {name} | {lic} | {home} |" for name, lic, home in sorted(rows))
    out.write_text(
        f"{header}{python_rows}\n## Node.js Dependencies\n\n"
        f"| Package | License | Homepage |\n|---------|---------|----------|\n{node_table}\n"
    )
    click.echo(f"Third-party licenses generated in {out.relative_to(ROOT)}")


@cli.command()
def clean():
    """Remove generated code and build caches."""
    sh(["rm", "-rf", "src/gen/python/src/uniffy_proto"])
    for pkg in (ROOT / "src/proto").iterdir():
        if pkg.is_dir():
            sh(["rm", "-rf", f"src/gen/typescript/{pkg.name}"])
    sh(["find", "src/gen/go", "-name", "*.go", "-delete"], check=False)
    sh(["rm", "-rf", "src/ui/dist", "src/ui/node_modules/.vite"])
    sh(
        [
            "find",
            "src/uniffy",
            "-type",
            "d",
            "-name",
            "__pycache__",
            "-exec",
            "rm",
            "-rf",
            "{}",
            "+",
        ],
        check=False,
    )


@cli.command()
@click.option(
    "--service", "-s", type=click.Choice(["all", "backend", "ui", "mobile", "cli"]), default="all"
)
@stack_option
@click.option("--fix/--check", default=True, help="Apply safe fixes or only report violations.")
def lint(service, stack, fix):
    """Run linters (all = backend + ui + cli, matching pre-commit expectations)."""
    if service in ("backend", "all"):
        workspace_cmd("backend", stack, ["run", "lint-imports"])
        _lint_backend_security(stack)
        workspace_cmd(
            "backend",
            stack,
            ["run", "python", "lint/capabilities.py", "src/uniffy"],
        )
        workspace_cmd("backend", stack, ["run", "ty", "check", "src/uniffy"])
        ruff_args = ["run", "ruff", "check", "src/uniffy/", "--exclude", "src/gen"]
        if fix:
            ruff_args.append("--fix")
        workspace_cmd(
            "backend",
            stack,
            ruff_args,
        )
        workspace_cmd(
            "backend",
            stack,
            ["run", "ruff", "format", "src/uniffy/", "--exclude", "src/gen", "--check"],
        )
    if service in ("ui", "all"):
        workspace_cmd("ui", stack, ["lint"])
        workspace_cmd("ui", stack, ["format:check"])
    if service == "mobile":
        workspace_cmd("mobile", stack, ["lint"])
        workspace_cmd("mobile", stack, ["format:check"])
    if service in ("cli", "all"):
        sh(["go", "vet", "./..."], cwd=ROOT / "src/unictl")


def _ruff_security_selectors() -> list[str]:
    config = tomllib.loads((ROOT / "pyproject.toml").read_text())
    lint_config = config["tool"]["ruff"]["lint"]
    configured_selectors = [lint_config["select"], lint_config.get("extend-select", [])]
    if any(
        not isinstance(values, list) or not all(isinstance(value, str) for value in values)
        for values in configured_selectors
    ):
        raise click.ClickException("Ruff select settings must be lists of rule selectors")
    selectors = [selector for values in configured_selectors for selector in values]

    security_selectors = [
        selector
        for selector in selectors
        if selector == "S"
        or (selector.startswith("S") and selector[1:].isdigit())
        or (selector.startswith("TID") and selector[3:].isdigit())
    ]
    if not security_selectors:
        raise click.ClickException("No Ruff security selectors are enabled in pyproject.toml")
    return security_selectors


def _lint_backend_security(stack: str) -> None:
    workspace_cmd(
        "backend",
        stack,
        [
            "run",
            "ruff",
            "check",
            "src/uniffy/",
            "--exclude",
            "src/gen",
            "--select",
            ",".join(_ruff_security_selectors()),
            "--ignore-noqa",
        ],
    )


@cli.command("lint-security")
@stack_option
def lint_security(stack: str) -> None:
    """Run security lint without honoring source-level suppressions."""
    _lint_backend_security(stack)


@cli.command()
@stack_option
def gitleaks(stack):
    """Scan the full git history for leaked secrets (allowlist in .gitleaks.toml)."""
    if stack == "docker":
        toolbox_run(["gitleaks", "git", "--redact", "--verbose", "/app"])
    else:
        sh(["gitleaks", "git", "--redact", "--verbose", str(ROOT)])


@cli.command("format")
@click.option(
    "--service", "-s", type=click.Choice(["all", "backend", "ui", "mobile"]), default="all"
)
@stack_option
def format_cmd(service, stack):
    """Format code (ruff for backend, oxfmt for the node workspaces)."""
    if service in ("backend", "all"):
        workspace_cmd(
            "backend", stack, ["run", "ruff", "format", "src/uniffy/", "--exclude", "src/gen"]
        )
    if service in ("ui", "all"):
        workspace_cmd("ui", stack, ["format"])
    if service == "mobile":
        workspace_cmd("mobile", stack, ["format"])


@cli.command(context_settings=PASSTHROUGH)
@click.argument("args", nargs=-1, type=click.UNPROCESSED)
@click.option(
    "--service",
    "-s",
    type=click.Choice(["backend", "ui", "mobile", "cli", "integration"]),
    default="backend",
    show_default=True,
)
@stack_option
def test(args, service, stack):
    """Run tests for a service (integration needs live services; the provider suite costs money)."""
    if service == "backend":
        workspace_cmd("backend", stack, ["run", "pytest", "src/uniffy/tests/unit/", *args])
    elif service == "integration":
        workspace_cmd(
            "backend", stack, ["run", "pytest", "src/uniffy/tests/integration/", "-v", *args]
        )
    elif service in ("ui", "mobile"):
        workspace_cmd(service, stack, ["test", *args])
    else:
        sh(["go", "test", "./...", *args], cwd=ROOT / "src/unictl")


@cli.command(context_settings=PASSTHROUGH)
@click.argument("args", nargs=-1, type=click.UNPROCESSED)
@stack_option
def bench(args, stack):
    """Run backend performance benchmarks."""
    workspace_cmd(
        "backend",
        stack,
        [
            "run",
            "pytest",
            "src/uniffy/tests/benchmarks/",
            "--benchmark-only",
            "--benchmark-group-by=func",
            "--benchmark-sort=mean",
            "--benchmark-columns=min,max,mean,stddev,rounds",
            *args,
        ],
    )


@cli.group()
def db():
    """Database operations."""


@db.command("shell")
def db_shell():
    sh(compose("exec", "postgres", "psql", "-U", "uniffy", "-d", "uniffy"))


@db.command("migrate")
@stack_option
def db_migrate(stack):
    workspace_cmd(
        "backend", stack, ["run", "alembic", "-c", "src/uniffy/alembic.ini", "upgrade", "head"]
    )


@cli.group("cli")
def unictl():
    """unictl Go CLI."""


@unictl.command("build")
def cli_build():
    sh(["go", "build", "-o", "unictl", "."], cwd=ROOT / "src/unictl")
    click.echo("Built: src/unictl/unictl")


@unictl.command("install")
def cli_install():
    sh(["go", "install", "."], cwd=ROOT / "src/unictl")


@unictl.command("run", context_settings=PASSTHROUGH)
@click.argument("args", nargs=-1, type=click.UNPROCESSED)
def cli_run(args):
    sh(["go", "run", ".", *args], cwd=ROOT / "src/unictl")


@unictl.command("lint")
def cli_lint():
    sh(["go", "vet", "./..."], cwd=ROOT / "src/unictl")


@unictl.command("test")
def cli_test():
    sh(["go", "test", "./..."], cwd=ROOT / "src/unictl")


@cli.group()
def landing():
    """Marketing landing page build and deploy."""


# Wrangler inside the container cannot reuse a host login, so docker deploys
# authenticate through these host env vars forwarded into the run.
LANDING_DEPLOY_ENV = ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID")


@landing.command("build")
@stack_option
def landing_build(stack):
    """Build the static site into src/landing/dist."""
    if stack == "docker":
        docker_pnpm("landing", ["build"])
    else:
        sh(["pnpm", "--filter", "uniffy-landing", "build"])


@landing.command("preview")
@stack_option
@click.pass_context
def landing_preview(ctx, stack):
    """Build and preview via Wrangler Pages (BG geo-block active under CF_PAGES)."""
    ctx.invoke(landing_build, stack=stack)
    if stack == "docker":
        docker_pnpm(
            "landing",
            ["exec", "wrangler", "pages", "dev", "dist", "--ip", "0.0.0.0", "--port", "8788"],
            publish=("8788:8788",),
        )
    else:
        sh(["pnpm", "exec", "wrangler", "pages", "dev", "dist"], cwd=ROOT / "src/landing")


@landing.command("deploy")
@stack_option
@click.pass_context
def landing_deploy(ctx, stack):
    """Build and deploy to Cloudflare Pages (project: uniffy-landing)."""
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if stack == "docker" and not token:
        raise click.ClickException(
            "CLOUDFLARE_API_TOKEN is not set. The container cannot reach a host "
            "Wrangler login, so export the token or deploy with --stack local."
        )
    if (
        stack == "local"
        and not token
        and not (Path.home() / ".wrangler/config/default.toml").exists()
    ):
        click.secho(
            "Warning: CLOUDFLARE_API_TOKEN not set and no Wrangler login detected.", fg="yellow"
        )
    ctx.invoke(landing_build, stack=stack)
    deploy_args = [
        "pages",
        "deploy",
        "dist",
        "--project-name",
        "uniffy-landing",
        "--branch",
        "main",
        "--commit-dirty=true",
    ]
    if stack == "docker":
        docker_pnpm("landing", ["exec", "wrangler", *deploy_args], env_keys=LANDING_DEPLOY_ENV)
    else:
        sh(["pnpm", "exec", "wrangler", *deploy_args], cwd=ROOT / "src/landing")
    click.echo("Deploy complete. Geo-block active: only cf-ipcountry=BG is served.")


@cli.group()
def image():
    """Production images: build, lint, test, scan. Host docker daemon only, no --stack."""


image_option = click.option(
    "--service", "-s", type=click.Choice([*IMAGES, "all"]), default="all", show_default=True
)
tag_option = click.option("--tag", default="dev", show_default=True, help="Image tag.")


def _image_targets(service: str) -> list[tuple[str, str, str]]:
    names = list(IMAGES) if service == "all" else [service]
    return [(name, *IMAGES[name]) for name in names]


@image.command("build")
@image_option
@tag_option
@click.option("--platform", help="Target platform(s), e.g. linux/amd64,linux/arm64.")
@click.option("--push", is_flag=True, help="Push to the registry instead of loading locally.")
def image_build(service, tag, platform, push):
    """Build with the names, build args, and labels the release pipeline uses."""
    if platform and "," in platform and not push:
        raise click.BadParameter("a multi-platform build cannot be loaded locally; add --push")
    version = git_out("describe", "--tags", "--always", "--dirty")
    revision = git_out("rev-parse", "HEAD")
    created = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    for _, dockerfile, repo in _image_targets(service):
        cmd = [
            "docker",
            "buildx",
            "build",
            "--file",
            dockerfile,
            "--target",
            "runtime",
            "--tag",
            f"{repo}:{tag}",
            "--build-arg",
            f"VERSION={version}",
            "--build-arg",
            f"REVISION={revision}",
            "--label",
            f"org.opencontainers.image.created={created}",
        ]
        if platform:
            cmd += ["--platform", platform]
        cmd += ["--push" if push else "--load", "."]
        sh(cmd)


@image.command("lint")
@image_option
def image_lint(service):
    """hadolint over the production Dockerfiles."""
    config = ROOT / ".docker/prod/hadolint.yaml"
    for _, dockerfile, _ in _image_targets(service):
        with open(ROOT / dockerfile, "rb") as handle:
            sh(
                [
                    "docker",
                    "run",
                    "--rm",
                    "-i",
                    "-v",
                    f"{config}:/.config/hadolint.yaml:ro",
                    IMAGE_TOOLS["hadolint"],
                ],
                stdin=handle,
            )


@image.command("test")
@image_option
@tag_option
def image_test(service, tag):
    """container-structure-test specs from .docker/prod/tests against local images."""
    tests = ROOT / ".docker/prod/tests"
    for name, _, repo in _image_targets(service):
        sh([
            "docker",
            "run",
            "--rm",
            "-v",
            f"{DOCKER_SOCKET}:{DOCKER_SOCKET}",
            "-v",
            f"{tests}:/tests:ro",
            IMAGE_TOOLS["structure-test"],
            "test",
            "--image",
            f"{repo}:{tag}",
            "--config",
            f"/tests/{name}.yaml",
        ])


def _trivy(args: list[str], mounts: list[str] = ()) -> None:
    cmd = ["docker", "run", "--rm", "-v", f"{DOCKER_SOCKET}:{DOCKER_SOCKET}"]
    cmd += ["-v", "uniffy-trivy-cache:/root/.cache/"]
    for mount in mounts:
        cmd += ["-v", mount]
    sh([*cmd, IMAGE_TOOLS["trivy"], "image", *args])


@image.command("scan")
@image_option
@tag_option
@click.option("--severity", default="CRITICAL,HIGH", show_default=True)
def image_scan(service, tag, severity):
    """Trivy scan of local images; fails on fixable findings at or above --severity."""
    ignorefile = ROOT / ".docker/prod/trivyignore"
    for _, _, repo in _image_targets(service):
        _trivy(
            [
                "--scanners",
                "vuln",
                "--exit-code",
                "1",
                "--severity",
                severity,
                "--ignore-unfixed",
                "--ignorefile",
                "/trivyignore",
                f"{repo}:{tag}",
            ],
            mounts=[f"{ignorefile}:/trivyignore:ro"],
        )


@image.command("sbom")
@image_option
@tag_option
@click.option(
    "--out-dir",
    type=click.Path(file_okay=False, path_type=Path),
    default=ROOT / "reports",
    show_default=True,
)
def image_sbom(service, tag, out_dir):
    """Write an SPDX JSON SBOM per image into --out-dir as sbom-<image>.spdx.json."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, _, repo in _image_targets(service):
        _trivy(
            ["--format", "spdx-json", "--output", f"/out/sbom-{name}.spdx.json", f"{repo}:{tag}"],
            mounts=[f"{out_dir.resolve()}:/out"],
        )


@cli.group()
def release():
    """Release helpers the release workflow runs; usable locally for a preview."""


def _release_version(tag: str) -> tuple[int, int, int, int, int]:
    """Sort key for a release tag; a stable release orders after its candidates."""
    match = RELEASE_TAG.match(tag)
    if match is None:
        raise click.BadParameter(f"{tag} is not vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-rc.N")
    major, minor, patch, rc = match.groups()
    return (int(major), int(minor), int(patch), 1 if rc is None else 0, int(rc or 0))


def _previous_release(tag: str, ref: str) -> str | None:
    """Latest stable release before tag that is reachable from ref. Candidates never
    count, so a candidate's notes span everything since the current release."""
    version = _release_version(tag)
    stable = [
        candidate
        for candidate in git_out("tag", "--merged", ref, "--list", "v*").split()
        if RELEASE_TAG.match(candidate)
        and _release_version(candidate) < version
        and _release_version(candidate)[3] == 1
    ]
    return max(stable, key=_release_version, default=None)


def _release_tags(tag: str) -> list[str]:
    """Image tags the release carries, mirroring the merge job: a stable release gets
    MAJOR.MINOR.PATCH, MAJOR.MINOR, MAJOR from 1.0 on, and latest; a candidate its
    version only."""
    major, minor, _, stable, _ = _release_version(tag)
    version = tag[1:]
    if not stable:
        return [version]
    return [version, f"{major}.{minor}", *([str(major)] if major else []), "latest"]


def _release_commits(range_spec: str) -> list[tuple[str, str, list[str]]]:
    """(sha, subject, paths) for every non-merge commit in the range, newest first."""
    out = git_out(
        "-c",
        "core.quotePath=false",
        "log",
        "--no-merges",
        "--format=%x00%H %s",
        "--name-only",
        range_spec,
    )
    commits = []
    for chunk in out.split("\x00")[1:]:
        head, _, body = chunk.partition("\n")
        sha, _, subject = head.partition(" ")
        commits.append((sha, subject, [line for line in body.splitlines() if line]))
    return commits


def _release_areas(paths: list[str]) -> list[str]:
    prefixes = tuple(prefix for group in RELEASE_AREAS.values() for prefix in group)
    areas = ["Core"] if not paths or any(not p.startswith(prefixes) for p in paths) else []
    areas += [
        area for area, group in RELEASE_AREAS.items() if any(p.startswith(group) for p in paths)
    ]
    return areas


def _release_notes(tag: str, ref: str, pins: list[str]) -> str:
    previous = _previous_release(tag, ref)
    commits = _release_commits(f"{previous}..{ref}" if previous else ref)
    grouped: dict[str, list[str]] = {area: [] for area in ("Core", *RELEASE_AREAS)}
    for sha, subject, paths in commits:
        for area in _release_areas(paths):
            grouped[area].append(f"- {subject} ([{sha[:8]}]({REPO_URL}/commit/{sha}))")

    count = f"{len(commits)} commit" + ("" if len(commits) == 1 else "s")
    if previous:
        history = f"{REPO_URL}/compare/{previous}...{tag}"
        lines = [
            f"{count} since [{previous}]({REPO_URL}/releases/tag/{previous}) ([compare]({history}))."
        ]
    else:
        history = f"{REPO_URL}/commits/{tag}"
        lines = [f"First release, {count} ([history]({history}))."]
    for area, entries in grouped.items():
        shown = entries[:RELEASE_NOTES_MAX_COMMITS]
        if len(entries) > len(shown):
            shown.append(f"- and {len(entries) - len(shown)} more in the [full history]({history})")
        lines += ["", f"### {area}", "", *(shown or ["No changes."])]

    by_tag = [f"{repo}:{t}" for _, repo in IMAGES.values() for t in _release_tags(tag)]
    refs = pins or [f"{repo}@sha256:<digest from images.txt>" for _, repo in IMAGES.values()]
    identity = f"{REPO_URL}/.github/workflows/release.yml@refs/tags/{tag}"
    flags = '--certificate-oidc-issuer "$COSIGN_ISSUER" --certificate-identity "$COSIGN_IDENTITY"'
    lines += [
        "",
        "### Container Images",
        "",
        "Both images are multi-arch indexes for linux/amd64 and linux/arm64.",
        "",
        "- By tag",
        "",
        "  ```",
        *(f"  {ref}" for ref in by_tag),
        "  ```",
        "",
        "- By digest (recommended for deployment pins)",
        "",
        "  ```",
        *(f"  {ref}" for ref in refs),
        "  ```",
        "",
        "### Verify",
        "",
        "`images.txt` below is this list, signed. Both digests are signed as well, and each"
        " carries its SBOM as an attestation. The signing identity is the release workflow"
        " running for this tag. Check with cosign 3.0 or newer:",
        "",
        "```bash",
        "COSIGN_ISSUER=https://token.actions.githubusercontent.com",
        f"COSIGN_IDENTITY={identity}",
        "cosign verify-blob images.txt --bundle images.txt.sigstore.json \\",
        f"  {flags}",
        *(line for ref in refs for line in (f"cosign verify {ref} \\", f"  {flags}")),
        "```",
        "",
        "`Verified OK` on every command means you hold what this run built. The SBOM check,"
        f" the GitHub CLI route, and a Kyverno policy for your cluster are in {VERIFY_DOCS_URL}",
        "",
    ]
    return "\n".join(lines)


@release.command("notes")
@click.argument("tag")
@click.option(
    "--ref", help="Commit the range ends at; defaults to TAG, so HEAD previews an unpushed tag."
)
@click.option(
    "--images",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    help="The release pinset; its image lines fill the verify section.",
)
@click.option(
    "--out",
    type=click.Path(dir_okay=False, path_type=Path),
    help="Write the notes here instead of stdout.",
)
def release_notes(tag, ref, images, out):
    """Markdown notes for TAG: commits since the previous release by area, images, verification."""
    _release_version(tag)
    pins = []
    if images:
        pins = [
            stripped
            for line in images.read_text().splitlines()
            if (stripped := line.strip()) and not stripped.startswith("#")
        ]
    text = _release_notes(tag, ref or tag, pins)
    if out:
        out.write_text(text)
        click.secho(f"wrote {out}", fg="green", err=True)
    else:
        click.echo(text, nl=False)


if __name__ == "__main__":
    try:
        cli(prog_name="./manage.py")
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
    except KeyboardInterrupt:
        sys.exit(130)
