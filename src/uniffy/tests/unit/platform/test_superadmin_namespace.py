"""Guard: ``/api/superadmin.v1.`` is exactly the operator surface.

Self-hosted deployments block the whole namespace with one reverse-proxy
rule, so every RPC under it must be sysadmin-gated. Handler and operation
modules are discovered from their live proto imports.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import uniffy

SRC_DIR = Path(uniffy.__file__).parent.parent
SUPERADMIN_PROTO_DIR = SRC_DIR / "proto" / "schema" / "superadmin" / "v1"
SUPPORT_CONSENT_PROTO = SRC_DIR / "proto" / "schema" / "support" / "v1" / "support_consent.proto"
FACTORY = SRC_DIR / "uniffy" / "factory.py"
DOMAINS = SRC_DIR / "uniffy" / "domains"

# Matched against source text, so the pattern has to be a call or a branch.
# A bare `is_system_admin` substring also matches the proto FIELD of that name,
# which several operator RPCs carry in their request message.
GATE_PATTERN = re.compile(r"require_system_admin\s*\(|if not \w+\.is_system_admin\b")


def _rpc_names(proto_text: str) -> list[str]:
    return re.findall(r"^\s*rpc (\w+)\(", proto_text, flags=re.M)


def _snake(rpc: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", rpc).lower()


def _async_defs(module_path: Path) -> dict[str, list[str]]:
    source = module_path.read_text()
    tree = ast.parse(source)
    out: dict[str, list[str]] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef):
            segment = ast.get_source_segment(source, node)
            if segment is not None:
                out.setdefault(node.name, []).append(segment)
    return out


def _awaited_callee_names(method_source: str) -> set[str]:
    names: set[str] = set()
    tree = ast.parse(method_source)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            names.add(node.func.attr)
    return names


def _handler_modules(proto_path: Path) -> tuple[Path, ...]:
    proto_import = f"uniffy_proto.superadmin.v1.{proto_path.stem}_pb2"
    return tuple(path for path in DOMAINS.rglob("*handlers.py") if proto_import in path.read_text())


def _imported_domain_modules(module_path: Path) -> tuple[Path, ...]:
    tree = ast.parse(module_path.read_text())
    modules: list[Path] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom):
            continue
        if node.module is None or not node.module.startswith("uniffy.domains."):
            continue
        candidate = SRC_DIR.joinpath(*node.module.split("."))
        module_file = candidate.with_suffix(".py")
        package_file = candidate / "__init__.py"
        if module_file.is_file():
            modules.append(module_file)
        elif package_file.is_file():
            modules.append(package_file)
    return tuple(dict.fromkeys(modules))


def _merge_async_defs(module_paths: tuple[Path, ...]) -> dict[str, list[str]]:
    merged: dict[str, list[str]] = {}
    for path in module_paths:
        for name, segments in _async_defs(path).items():
            merged.setdefault(name, []).extend(segments)
    return merged


def _ungated_rpcs(proto_text: str, handlers: tuple[Path, ...]) -> list[str]:
    handler_defs = _merge_async_defs(handlers)
    dependencies = tuple(
        dict.fromkeys(
            dependency for handler in handlers for dependency in _imported_domain_modules(handler)
        )
    )
    callable_defs = _merge_async_defs((*handlers, *dependencies))
    ungated: list[str] = []
    for rpc in _rpc_names(proto_text):
        methods = handler_defs.get(_snake(rpc), [])
        if not methods:
            ungated.append(f"{rpc} (no handler method {_snake(rpc)})")
            continue
        if any(GATE_PATTERN.search(method) for method in methods):
            continue
        callees = {callee for method in methods for callee in _awaited_callee_names(method)}
        gated = any(
            GATE_PATTERN.search(candidate)
            for name in callees
            for candidate in callable_defs.get(name, [])
        )
        if not gated:
            ungated.append(rpc)
    return ungated


class TestNamespaceIsTheSurface:
    def test_every_superadmin_proto_has_handlers(self) -> None:
        protos = list(SUPERADMIN_PROTO_DIR.glob("*.proto"))
        assert protos, "No operator schemas found for authorization checks"
        missing = [path.name for path in protos if not _handler_modules(path)]
        assert missing == []

    def test_every_superadmin_rpc_is_sysadmin_gated(self) -> None:
        offenders: dict[str, list[str]] = {}
        for proto_path in SUPERADMIN_PROTO_DIR.glob("*.proto"):
            proto_text = proto_path.read_text()
            ungated = _ungated_rpcs(proto_text, _handler_modules(proto_path))
            if ungated:
                offenders[proto_path.name] = ungated
        assert offenders == {}

    def test_the_scan_would_catch_an_ungated_rpc(self, tmp_path: Path) -> None:
        """A guard that cannot fail is not a guard."""
        proto = "service Fake {\n  rpc DoThing(Req) returns (Resp);\n}\n"
        tmp_handlers = tmp_path / "guard_fake_handlers.py"
        tmp_handlers.write_text(
            "async def do_thing(self, request, ctx):\n    return await ops.do_thing()\n"
        )
        assert _ungated_rpcs(proto, (tmp_handlers,)) == ["DoThing"]

    def test_an_is_system_admin_field_does_not_count_as_a_gate(self, tmp_path: Path) -> None:
        """``SetSystemAdmin`` and ``CreateUser`` pass ``is_system_admin`` through
        as a request field; naming it must not satisfy the scan.
        """
        proto = "service Fake {\n  rpc SetSystemAdmin(Req) returns (Resp);\n}\n"
        tmp_handlers = tmp_path / "guard_field_handlers.py"
        tmp_handlers.write_text(
            "async def set_system_admin(self, request, ctx):\n"
            "    return await ops.set_system_admin("
            "is_system_admin=request.is_system_admin)\n"
        )
        assert _ungated_rpcs(proto, (tmp_handlers,)) == ["SetSystemAdmin"]


class TestTenantServicesCarryNoSysadminGate:
    def test_organizations_handlers(self) -> None:
        source = (DOMAINS / "organizations" / "handlers.py").read_text()
        assert "require_system_admin" not in source
        assert "is_system_admin" not in source

    def test_users_handlers(self) -> None:
        source = (DOMAINS / "users" / "handlers.py").read_text()
        assert "require_system_admin" not in source
        assert "is_system_admin" not in source


class TestConsentLivesOutsideTheNamespace:
    def test_factory_mounts_the_consent_service(self) -> None:
        assert '"/support.v1.SupportConsentService"' in FACTORY.read_text()

    def test_superadmin_support_proto_has_no_consent_rpcs(self) -> None:
        consent_rpcs = set(_rpc_names(SUPPORT_CONSENT_PROTO.read_text()))
        operator_rpcs = {
            rpc
            for proto_path in SUPERADMIN_PROTO_DIR.glob("*.proto")
            for rpc in _rpc_names(proto_path.read_text())
        }
        assert consent_rpcs
        assert consent_rpcs.isdisjoint(operator_rpcs)
