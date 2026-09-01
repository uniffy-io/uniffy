"""Gates on handlers that previously extracted the caller identity and dropped it.

Each case here pins a specific escalation: an org read reachable without
membership, an upload record readable across tenants, and a platform
operator reading org-wide usage from a plain member seat.
"""

from contextlib import asynccontextmanager
import ast
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.types import generate_id
from uniffy.domains.chat.categories.reader import ChatCategoryReader

ORG = generate_id()
ACTOR = generate_id()


def test_rpc_handlers_do_not_parse_request_organization_scope_directly() -> None:
    domains = Path(__file__).parents[3] / "domains"
    offenders: list[str] = []
    for path in domains.rglob("*handlers.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not node.args:
                continue
            if not isinstance(node.func, ast.Name) or node.func.id != "UUID":
                continue
            argument = node.args[0]
            if (
                isinstance(argument, ast.Attribute)
                and argument.attr == "organization_id"
                and isinstance(argument.value, ast.Name)
                and argument.value.id == "request"
            ):
                offenders.append(f"{path}:{node.lineno}")
    assert offenders == []


def test_request_organization_must_match_authenticated_scope() -> None:
    from uniffy.core.auth import principal

    other_org = generate_id()
    with patch.object(principal, "current_organization_id", return_value=ORG):
        with pytest.raises(ConnectError) as exc_info:
            principal.resolve_organization_id(str(other_org))

    assert exc_info.value.code == Code.PERMISSION_DENIED


@pytest.mark.parametrize(
    "_membership_state",
    ["non-member", "deactivated"],
    ids=["non-member", "deactivated"],
)
async def test_list_categories_requires_active_membership(_membership_state) -> None:
    """Reachable with no credentials at all before the fix."""
    session = MagicMock()
    session.execute = AsyncMock()
    access = MagicMock()
    access.require_org_member = AsyncMock(
        side_effect=PermissionDeniedError("access", "organization")
    )
    ops = ChatCategoryReader(session, access=access)

    with pytest.raises(PermissionDeniedError):
        await ops.list_categories(ACTOR, ORG)

    session.execute.assert_not_awaited()


async def test_list_categories_allows_a_plain_member() -> None:
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(scalars=lambda: MagicMock(all=lambda: [])))
    access = MagicMock()
    access.require_org_member = AsyncMock()
    ops = ChatCategoryReader(session, access=access)

    assert await ops.list_categories(ACTOR, ORG) == []


def _upload_status_ctx(session):
    @asynccontextmanager
    async def fake_open_session():
        yield session

    return (
        patch(
            "uniffy.domains.files.rpc.uploads.current_user_id",
            MagicMock(return_value=ACTOR),
        ),
        patch("uniffy.domains.files.rpc.uploads.open_session", fake_open_session),
    )


async def test_get_upload_status_hides_another_users_upload() -> None:
    """The response carries filename and size, so a foreign hit is a leak."""
    from uniffy_proto.files.v1.files_pb2 import GetUploadStatusRequest

    from uniffy.domains.files.handlers import FilesHandlers

    upload_id = generate_id()
    foreign = SimpleNamespace(
        id=upload_id,
        user_id=generate_id(),
        filename="acquisition-terms.pdf",
        total_size=1024,
        total_chunks=2,
    )

    session = MagicMock()
    ops = MagicMock()
    ops.get_upload_status = AsyncMock(return_value=foreign)
    ops.list_completed_part_numbers = AsyncMock(return_value=[1])

    patch_user, patch_session = _upload_status_ctx(session)
    with (
        patch_user,
        patch_session,
        patch("uniffy.domains.files.rpc.uploads.FileOperations", MagicMock(return_value=ops)),
        pytest.raises(ConnectError) as exc_info,
    ):
        handlers = FilesHandlers()
        handlers.storage = MagicMock()
        handlers.search_indexer = MagicMock()
        await handlers.get_upload_status(
            GetUploadStatusRequest(upload_id=str(upload_id)), MagicMock()
        )

    assert exc_info.value.code == Code.NOT_FOUND
    ops.list_completed_part_numbers.assert_not_awaited()


def test_usage_stats_does_not_widen_for_a_system_admin_member() -> None:
    """`is_system_admin` must not substitute for an org-admin role.

    Cross-tenant reach belongs to an audited SupportSession, so a platform
    operator on a plain member seat sees only their own usage rows.
    """
    import inspect

    from uniffy.domains.agents.runtime import handlers as runtime_handlers

    # Asserted at source level because the handler needs a live session to
    # reach the branch. The invariant is that no system-admin check exists
    # here at all, which is stable across refactors of the surrounding code.
    source = inspect.getsource(runtime_handlers.RuntimeHandlers.get_usage_stats)
    assert "is_system_admin" not in source
