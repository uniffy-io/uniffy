"""Guard: ``/api/superadmin.v1.`` is exactly the operator surface.

Self-hosted deployments block the whole namespace with one reverse-proxy
rule, so every RPC under it must be sysadmin-gated and no operator RPC
may live outside it. Source-scan over the protos, the handler modules,
and the operations they call; no dispatch required.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import uniffy

SRC_DIR = Path(uniffy.__file__).parent.parent
SUPERADMIN_PROTO_DIR = SRC_DIR / "proto" / "superadmin" / "v1"
SUPPORT_CONSENT_PROTO = SRC_DIR / "proto" / "support" / "v1" / "support_consent.proto"
FACTORY = SRC_DIR / "uniffy" / "factory.py"
DOMAINS = SRC_DIR / "uniffy" / "domains"

# Matched against source text, so the pattern has to be a call or a branch.
# A bare `is_system_admin` substring also matches the proto FIELD of that name,
# which several operator RPCs carry in their request message.
GATE_PATTERN = re.compile(r"require_system_admin\s*\(|if not \w+\.is_system_admin\b")

# Every proto file under superadmin/v1 must have an entry here; a new
# operator service ships with its gate mapping or this test fails.
PROTO_TO_MODULES: dict[str, tuple[Path, Path]] = {
    "support_session.proto": (
        DOMAINS / "platform" / "support_session" / "handlers.py",
        DOMAINS / "platform" / "support_session" / "operations.py",
    ),
    "system_config.proto": (
        DOMAINS / "system_config" / "handlers.py",
        DOMAINS / "system_config" / "operations.py",
    ),
    "system_directory.proto": (
        DOMAINS / "platform" / "directory" / "handlers.py",
        DOMAINS / "platform" / "directory" / "operations.py",
    ),
    "system_encryption.proto": (
        DOMAINS / "system_encryption" / "handlers.py",
        DOMAINS / "system_encryption" / "operations.py",
    ),
    "system_mail.proto": (
        DOMAINS / "mail" / "system_handlers.py",
        DOMAINS / "mail" / "system_operations.py",
    ),
    "system_mfa.proto": (
        DOMAINS / "platform" / "mfa" / "handlers.py",
        DOMAINS / "auth" / "mfa" / "operations.py",
    ),
    "platform_audit.proto": (
        DOMAINS / "platform" / "audit" / "handlers.py",
        DOMAINS / "platform" / "audit" / "operations.py",
    ),
}

CONSENT_RPCS = (
    "ApproveSession",
    "RejectSession",
    "RevokeSession",
    "ListOrgSessions",
    "GetOrgConsentMode",
    "SetOrgConsentMode",
)


def _rpc_names(proto_text: str) -> list[str]:
    return re.findall(r"^\s*rpc (\w+)\(", proto_text, flags=re.M)


def _snake(rpc: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", rpc).lower()


def _async_defs(module_path: Path) -> dict[str, str]:
    """Async function name -> source segment (last definition wins)."""
    source = module_path.read_text()
    tree = ast.parse(source)
    out: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef):
            segment = ast.get_source_segment(source, node)
            if segment is not None:
                out[node.name] = segment
    return out


def _awaited_callee_names(method_source: str) -> set[str]:
    names: set[str] = set()
    tree = ast.parse(method_source)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            names.add(node.func.attr)
    return names


def _ungated_rpcs(proto_text: str, handlers: Path, operations: Path) -> list[str]:
    handler_defs = _async_defs(handlers)
    ops_defs = _async_defs(operations)
    ungated: list[str] = []
    for rpc in _rpc_names(proto_text):
        method = handler_defs.get(_snake(rpc))
        if method is None:
            ungated.append(f"{rpc} (no handler method {_snake(rpc)})")
            continue
        if GATE_PATTERN.search(method):
            continue
        gated = any(
            GATE_PATTERN.search(ops_defs[name])
            for name in _awaited_callee_names(method)
            if name in ops_defs
        )
        if not gated:
            ungated.append(rpc)
    return ungated


class TestNamespaceIsTheSurface:
    def test_every_superadmin_proto_is_mapped(self) -> None:
        on_disk = {p.name for p in SUPERADMIN_PROTO_DIR.glob("*.proto")}
        assert on_disk == set(PROTO_TO_MODULES)

    def test_every_superadmin_rpc_is_sysadmin_gated(self) -> None:
        offenders: dict[str, list[str]] = {}
        for proto_name, (handlers, operations) in PROTO_TO_MODULES.items():
            proto_text = (SUPERADMIN_PROTO_DIR / proto_name).read_text()
            ungated = _ungated_rpcs(proto_text, handlers, operations)
            if ungated:
                offenders[proto_name] = ungated
        assert offenders == {}

    def test_the_scan_would_catch_an_ungated_rpc(self, tmp_path: Path) -> None:
        """A guard that cannot fail is not a guard."""
        proto = "service Fake {\n  rpc DoThing(Req) returns (Resp);\n}\n"
        tmp_handlers = tmp_path / "guard_fake_handlers.py"
        tmp_ops = tmp_path / "guard_fake_ops.py"
        tmp_handlers.write_text(
            "async def do_thing(self, request, ctx):\n    return await ops.do_thing()\n"
        )
        tmp_ops.write_text("async def do_thing():\n    return 1\n")
        assert _ungated_rpcs(proto, tmp_handlers, tmp_ops) == ["DoThing"]

    def test_an_is_system_admin_field_does_not_count_as_a_gate(self, tmp_path: Path) -> None:
        """``SetSystemAdmin`` and ``CreateUser`` pass ``is_system_admin`` through
        as a request field; naming it must not satisfy the scan.
        """
        proto = "service Fake {\n  rpc SetSystemAdmin(Req) returns (Resp);\n}\n"
        tmp_handlers = tmp_path / "guard_field_handlers.py"
        tmp_ops = tmp_path / "guard_field_ops.py"
        tmp_handlers.write_text(
            "async def set_system_admin(self, request, ctx):\n"
            "    return await ops.set_system_admin("
            "is_system_admin=request.is_system_admin)\n"
        )
        tmp_ops.write_text(
            "async def set_system_admin(*, is_system_admin):\n    return is_system_admin\n"
        )
        assert _ungated_rpcs(proto, tmp_handlers, tmp_ops) == ["SetSystemAdmin"]


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
        proto_text = (SUPERADMIN_PROTO_DIR / "support_session.proto").read_text()
        leaked = [rpc for rpc in CONSENT_RPCS if f"rpc {rpc}(" in proto_text]
        assert leaked == []

    def test_consent_proto_carries_all_consent_rpcs(self) -> None:
        proto_text = SUPPORT_CONSENT_PROTO.read_text()
        missing = [rpc for rpc in CONSENT_RPCS if f"rpc {rpc}(" not in proto_text]
        assert missing == []
