#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["click>=8.1"]
# ///
"""Uniffy project CLI. Run `./manage.py` for the command tree."""

import os
import shlex
import subprocess
import sys
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


def sh(cmd: list[str], cwd: Path | None = None, check: bool = True, env: dict | None = None) -> int:
    click.secho(f"$ {shlex.join(cmd)}", fg="cyan", err=True)
    full_env = {**os.environ, **HOST_IDS, **(env or {})}
    return subprocess.run(cmd, cwd=cwd or ROOT, check=check, env=full_env).returncode


def sh_ok(cmd: list[str]) -> bool:
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    return result.returncode == 0 and bool(result.stdout.strip())


def compose(*args: str, profiles: list[str] | None = None) -> list[str]:
    cmd = ["docker", "compose"]
    for profile in profiles or []:
        cmd += ["--profile", profile]
    return [*cmd, *args]


def container_running(service: str) -> bool:
    return sh_ok(["docker", "compose", "ps", "-q", "--status", "running", service])


def docker_pnpm(service: str, args: list[str]) -> None:
    svc, filter_, profile = NODE_SERVICES[service]
    if container_running(svc):
        sh(compose("exec", *EXEC_AS_HOST, svc, "pnpm", "--filter", filter_, *args))
    else:
        sh(compose("run", "--rm", "--no-deps", svc, "pnpm", "--filter", filter_, *args, profiles=[profile]))


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
    "--service", "-s", type=click.Choice(["backend", "ui", "mobile", "landing", "all"]), default="all"
)
stack_option = click.option("--stack", type=Stack, default="docker", show_default=True)


@deps.command("install")
@service_option
@stack_option
def deps_install(service: str, stack: str):
    """Sync dependencies from the lockfiles."""
    if stack == "docker":
        if service == "all":
            toolbox_run(["true"])
        elif service == "backend":
            sh(compose("run", "--rm", "--no-deps", "backend", "true", profiles=["dev"]))
        else:
            svc, _, profile = NODE_SERVICES[service]
            sh(compose("run", "--rm", "--no-deps", svc, "true", profiles=[profile]))
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
        args = ["add" if verb == "add" else verb, *(["--dev"] if dev and verb == "add" else []), *packages]
        workspace_cmd("backend", stack, args)
    else:
        args = [verb, *(["--save-dev"] if dev and verb == "add" else []), *packages]
        workspace_cmd(service, stack, args)


@deps.command("add")
@click.argument("packages", nargs=-1, required=True)
@click.option("--service", "-s", type=click.Choice(["backend", "ui", "mobile", "landing"]), required=True)
@stack_option
@click.option("--dev", is_flag=True, help="Add as a dev dependency.")
def deps_add(packages, service, stack, dev):
    """Add packages to a workspace."""
    _mutate(service, stack, "add", packages, dev)


@deps.command("remove")
@click.argument("packages", nargs=-1, required=True)
@click.option("--service", "-s", type=click.Choice(["backend", "ui", "mobile", "landing"]), required=True)
@stack_option
def deps_remove(packages, service, stack):
    """Remove packages from a workspace."""
    _mutate(service, stack, "remove", packages, False)


@deps.command("update")
@click.argument("packages", nargs=-1)
@click.option("--service", "-s", type=click.Choice(["backend", "ui", "mobile", "landing"]), required=True)
@stack_option
def deps_update(packages, service, stack):
    """Update packages (all in range when none given)."""
    if service == "backend":
        workspace_cmd("backend", stack, ["sync", "--upgrade", *(f"--upgrade-package={p}" for p in packages)])
    else:
        workspace_cmd(service, stack, ["update", *packages])


@deps.command("run", context_settings=PASSTHROUGH)
@click.argument("args", nargs=-1, required=True, type=click.UNPROCESSED)
@click.option("--service", "-s", type=click.Choice(["backend", "ui", "mobile", "landing"]), required=True)
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


@stack.command("rebuild")
@click.argument("services", nargs=-1)
def stack_rebuild(services):
    """Rebuild dev images without cache (after a Dockerfile change)."""
    sh(compose("build", "--no-cache", *(services or ("backend", "ui", "deps-manager")), profiles=["dev"]))


@stack.command("recreate")
@profiles_option
@click.option("--detach", "-d", is_flag=True, help="Start and return without tailing logs.")
@click.option("--no-build", is_flag=True, help="Start without rebuilding changed images.")
@click.option("--yes", "-y", is_flag=True, help="Skip the confirmation prompt.")
@click.pass_context
def stack_recreate(ctx, profiles, detach, no_build, yes):
    """Tear down EVERYTHING and start fresh - containers, all volumes, orphans.

    Wipes all data (postgres, valkey, meilisearch, rustfs) plus every tooling
    cache volume (venvs, node_modules, pnpm store, uv cache), then runs the
    same flow as `stack up`.
    """
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
    volumes = [
        "uniffy-local_postgres_data",
        "uniffy-local_valkey_data",
        "uniffy-local_meilisearch_data",
        "uniffy-local_rustfs_data",
        "uniffy-local_rustfs_logs",
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
    click.echo("Done. Tail migrations with: ./manage.py logs -s backend")


@cli.group()
def serve():
    """Run dev processes natively on the host (infra stays in containers)."""


def _watch(target: str) -> list[str]:
    return ["uv", "run", "watchfiles", "--filter", "python", f"python -m uniffy --{target}", "src/uniffy/", "src/gen/python/"]


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
    sh(_watch("worker-egress") if reload else ["uv", "run", "python", "-m", "uniffy", "--worker-egress"])


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
    click.echo("Backend/worker output goes to .logs/*.log - tail with: ./manage.py logs --stack local")
    procs = []
    for target in ("backend", "worker-core", "worker-egress"):
        log = (LOG_DIR / f"{target}.log").open("ab")
        procs.append(subprocess.Popen(_watch(target), cwd=ROOT, stdout=log, stderr=subprocess.STDOUT))
    try:
        sh(["pnpm", "--filter", "uniffy-ui", "dev"])
    finally:
        for proc in procs:
            proc.terminate()


@cli.command()
@click.option("--stack", type=Stack, default="docker", show_default=True)
@click.option("--profile", "-p", "profiles", multiple=True, help="Extra compose profiles (e.g. -p mobile).")
@click.pass_context
def start(ctx, stack, profiles):
    """One-command first start: docker = full containerized stack, local = host deps + infra containers + native processes."""
    if stack == "docker":
        # --build is a cached no-op when Dockerfiles are unchanged, so start
        # always reflects the current image definitions
        sh(compose("up", "-d", "--build", profiles=["core", "dev", *profiles]))
        click.secho("Stack running detached. Ctrl+C stops this log tail, not the stack "
                    "(stop with: ./manage.py stack down)", fg="green")
        # tail app services only; infra (core profile) logs via ./manage.py logs
        sh(compose("logs", "-f", profiles=["dev", *profiles]), check=False)
        return
    if not (ROOT / ".venv").exists() or not (ROOT / "node_modules").exists():
        ctx.invoke(deps_install, service="all", stack="local")
    sh(compose("up", "-d", profiles=["core", *profiles]))
    ctx.invoke(serve_all)


@cli.command()
@click.option("--service", "-s", default=None, help="One service; omit for combined logs.")
@click.option("--stack", type=Stack, default="docker", show_default=True)
def logs(service, stack):
    """Tail logs. docker = compose services; local = processes started by `serve all`."""
    if stack == "docker":
        sh(compose("logs", "-f", *([service] if service else []), profiles=["core", "dev", "mobile"]))
        return
    files = [LOG_DIR / f"{service}.log"] if service else sorted(LOG_DIR.glob("*.log"))
    files = [f for f in files if f.exists()]
    if not files:
        raise click.ClickException("No local log files in .logs/ - start processes with ./manage.py serve all")
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
        "## Python Dependencies\n\n"
    )
    python_rows = subprocess.run(
        ["uv", "run", "pip-licenses", "--format=markdown", "--with-urls", "--ignore-packages", "uniffy"],
        cwd=ROOT, check=True, capture_output=True, text=True,
    ).stdout
    node_json = subprocess.run(
        ["pnpm", "licenses", "list", "--prod", "--json"],
        cwd=ROOT / "src/ui", check=True, capture_output=True, text=True,
    ).stdout
    import json

    rows = []
    for license_name, pkgs in json.loads(node_json).items():
        for pkg in pkgs:
            rows.append((f"{pkg['name']}@{pkg['versions'][0]}", license_name, pkg.get("homepage", "")))
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
    sh(["find", "src/uniffy", "-type", "d", "-name", "__pycache__", "-exec", "rm", "-rf", "{}", "+"], check=False)


@cli.command()
@click.option("--service", "-s", type=click.Choice(["all", "backend", "ui", "mobile", "cli"]), default="all")
@stack_option
def lint(service, stack):
    """Run linters (all = backend + ui + cli, matching pre-commit expectations)."""
    if service in ("backend", "all"):
        workspace_cmd("backend", stack, ["run", "ruff", "check", "src/uniffy/", "--exclude", "src/gen", "--fix"])
    if service in ("ui", "all"):
        workspace_cmd("ui", stack, ["lint"])
    if service == "mobile":
        workspace_cmd("mobile", stack, ["lint"])
        workspace_cmd("mobile", stack, ["format:check"])
    if service in ("cli", "all"):
        sh(["go", "vet", "./..."], cwd=ROOT / "src/unictl")


@cli.command("format")
@stack_option
def format_cmd(stack):
    """Format backend code (ruff)."""
    workspace_cmd("backend", stack, ["run", "ruff", "format", "src/uniffy/", "--exclude", "src/gen"])


@cli.command()
@click.option("--service", "-s", type=click.Choice(["backend", "ui", "cli"]), default="backend", show_default=True)
@stack_option
def test(service, stack):
    """Run tests for a service."""
    if service == "backend":
        workspace_cmd("backend", stack, ["run", "pytest", "src/uniffy/tests/", "--ignore=src/uniffy/tests/benchmarks/"])
    elif service == "ui":
        workspace_cmd("ui", stack, ["test"])
    else:
        sh(["go", "test", "./..."], cwd=ROOT / "src/unictl")


@cli.command()
@stack_option
def bench(stack):
    """Run backend performance benchmarks."""
    workspace_cmd("backend", stack, [
        "run", "pytest", "src/uniffy/tests/benchmarks/",
        "--benchmark-only", "--benchmark-group-by=func", "--benchmark-sort=mean",
        "--benchmark-columns=min,max,mean,stddev,rounds",
    ])


@cli.group()
def db():
    """Database operations."""


@db.command("shell")
def db_shell():
    sh(compose("exec", "postgres", "psql", "-U", "uniffy", "-d", "uniffy"))


@db.command("migrate")
@stack_option
def db_migrate(stack):
    workspace_cmd("backend", stack, ["run", "alembic", "-c", "src/uniffy/alembic.ini", "upgrade", "head"])


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


@landing.command("build")
def landing_build():
    sh(["pnpm", "--filter", "uniffy-landing", "build"])


@landing.command("preview")
@click.pass_context
def landing_preview(ctx):
    """Build and preview via Wrangler Pages (BG geo-block active under CF_PAGES)."""
    ctx.invoke(landing_build)
    sh(["pnpm", "exec", "wrangler", "pages", "dev", "dist"], cwd=ROOT / "src/landing")


@landing.command("deploy")
@click.pass_context
def landing_deploy(ctx):
    """Build and deploy to Cloudflare Pages (project: uniffy-landing)."""
    if not os.environ.get("CLOUDFLARE_API_TOKEN") and not (Path.home() / ".wrangler/config/default.toml").exists():
        click.secho("Warning: CLOUDFLARE_API_TOKEN not set and no Wrangler login detected.", fg="yellow")
    ctx.invoke(landing_build)
    sh(["pnpm", "exec", "wrangler", "pages", "deploy", "dist",
        "--project-name", "uniffy-landing", "--branch", "main", "--commit-dirty=true"],
       cwd=ROOT / "src/landing")
    click.echo("Deploy complete. Geo-block active: only cf-ipcountry=BG is served.")


if __name__ == "__main__":
    try:
        cli(prog_name="./manage.py")
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
    except KeyboardInterrupt:
        sys.exit(130)
