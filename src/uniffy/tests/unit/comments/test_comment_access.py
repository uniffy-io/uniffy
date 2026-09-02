from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.types import ContentRole, ContentType, generate_id
from uniffy.domains.comments.access import CommentTargetAccess
from uniffy.domains.permissions.access import (
    ResourceAccessDecision,
    ResourceAccessPurpose,
    ResourceKey,
    ResourceRowState,
)


def _access_with_role(role: ContentRole | None):
    access = CommentTargetAccess(MagicMock())
    key = ResourceKey(ContentType.NOTE, generate_id())
    access._resources.resolve = AsyncMock(  # type: ignore[method-assign]
        return_value={
            key: ResourceAccessDecision(
                key=key,
                row_state=ResourceRowState.LIVE,
                can_view=role is not None,
                role=role,
            )
        }
    )
    return access, key


@pytest.mark.parametrize(
    ("method_name", "role"),
    [
        ("require_view", ContentRole.VIEWER),
        ("require_comment", ContentRole.COMMENTER),
        ("require_edit", ContentRole.EDITOR),
    ],
)
async def test_point_gate_uses_authoritative_resolver(method_name, role) -> None:
    user_id = generate_id()
    organization_id = generate_id()
    access, key = _access_with_role(role)

    await getattr(access, method_name)(
        user_id,
        organization_id,
        key.content_type,
        key.content_id,
    )

    access._resources.resolve.assert_awaited_once_with(
        actor_id=user_id,
        organization_id=organization_id,
        keys=[key],
        purpose=ResourceAccessPurpose.REFERENCE,
    )


@pytest.mark.parametrize(
    ("method_name", "role"),
    [
        ("require_view", None),
        ("require_comment", ContentRole.VIEWER),
        ("require_edit", ContentRole.COMMENTER),
    ],
)
async def test_point_gate_enforces_capability_floor(method_name, role) -> None:
    access, key = _access_with_role(role)

    with pytest.raises(PermissionDeniedError):
        await getattr(access, method_name)(
            generate_id(),
            generate_id(),
            key.content_type,
            key.content_id,
        )


@pytest.mark.parametrize("row_state", [ResourceRowState.MISSING, ResourceRowState.DELETED])
async def test_missing_and_deleted_targets_are_not_found(row_state) -> None:
    access, key = _access_with_role(ContentRole.EDITOR)
    access._resources.resolve.return_value[key] = ResourceAccessDecision(
        key=key,
        row_state=row_state,
        can_view=False,
    )

    with pytest.raises(NotFoundError):
        await access.require_view(
            generate_id(),
            generate_id(),
            key.content_type,
            key.content_id,
        )


async def test_unsupported_target_is_not_found_without_resolution() -> None:
    access, _ = _access_with_role(ContentRole.OWNER)

    with pytest.raises(NotFoundError):
        await access.require_view(
            generate_id(),
            generate_id(),
            ContentType.ROOM,
            generate_id(),
        )

    access._resources.resolve.assert_not_awaited()
