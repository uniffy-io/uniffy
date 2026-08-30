import subprocess
import sys


def _run_fresh(script: str) -> None:
    subprocess.run(
        [sys.executable, "-c", script],
        check=True,
        capture_output=True,
        text=True,
    )


def test_factory_imports_in_a_fresh_process() -> None:
    _run_fresh("import uniffy.factory")


def test_worker_registry_imports_in_a_fresh_process() -> None:
    _run_fresh("import uniffy.workers.registry")


def test_builtin_tool_package_does_not_import_child_modules() -> None:
    _run_fresh(
        """
import importlib
import pkgutil
import sys

name = "uniffy.domains.agents.tools.builtin"
package = importlib.import_module(name)
children = {f"{name}.{item.name}" for item in pkgutil.iter_modules(package.__path__)}
loaded = sorted(children.intersection(sys.modules))
assert loaded == [], loaded
"""
    )


def test_provider_packages_do_not_import_child_modules() -> None:
    _run_fresh(
        """
import importlib
import pkgutil
import sys
from pathlib import Path

import uniffy

root = Path(uniffy.__file__).parent / "domains" / "agents" / "providers"
offenders = {}
packages = [path for path in root.iterdir() if (path / "descriptor.py").is_file()]
for path in packages:
    name = f"uniffy.domains.agents.providers.{path.name}"
    package = importlib.import_module(name)
    children = {f"{name}.{item.name}" for item in pkgutil.iter_modules(package.__path__)}
    loaded = sorted(children.intersection(sys.modules))
    if loaded:
        offenders[name] = loaded
assert offenders == {}, offenders
"""
    )
