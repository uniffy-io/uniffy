from unittest.mock import MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.defaults import (
    resolve_access_policy,
    resolve_creation_policy,
    resolve_effective_policy,
)
from uniffy.core.errors import ValidationError
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id


@pytest.mark.parametrize(
    "content_type",
    [
        ContentType.NOTE,
        ContentType.FILE,
        ContentType.FOLDER,
        ContentType.PROJECT,
        ContentType.AGENT,
        ContentType.AGENT_CRON_TASK,
        ContentType.ROOM,
        ContentType.CALENDAR_EVENT,
    ],
)
@pytest.mark.parametrize("requested_mode", [None, AccessMode.OWNER_ONLY])
async def test_personal_creation_stays_private_under_open_org_defaults(
    content_type: ContentType, requested_mode: AccessMode | None
) -> None:
    policy = await resolve_creation_policy(
        MagicMock(spec=AsyncSession), generate_id(), content_type, requested_mode, None
    )

    assert policy == (AccessMode.OWNER_ONLY, None)
    for org_role in (ContentRole.VIEWER, ContentRole.EDITOR, ContentRole.ADMIN):
        assert resolve_effective_policy(*policy, AccessMode.OPEN_TO_ORG, org_role) == (
            AccessMode.OWNER_ONLY,
            None,
        )


async def test_organization_creation_inherits_the_live_baseline() -> None:
    policy = await resolve_creation_policy(
        MagicMock(spec=AsyncSession),
        generate_id(),
        ContentType.PROJECT,
        AccessMode.OPEN_TO_ORG,
        None,
    )

    for org_role in (ContentRole.VIEWER, ContentRole.EDITOR):
        assert resolve_effective_policy(*policy, AccessMode.OPEN_TO_ORG, org_role) == (
            AccessMode.OPEN_TO_ORG,
            org_role,
        )


async def test_explicit_organization_role_overrides_defaults() -> None:
    policy = await resolve_creation_policy(
        MagicMock(spec=AsyncSession),
        generate_id(),
        ContentType.NOTE,
        AccessMode.OPEN_TO_ORG,
        ContentRole.COMMENTER,
    )

    assert resolve_effective_policy(*policy, AccessMode.OPEN_TO_ORG, ContentRole.EDITOR) == (
        AccessMode.OPEN_TO_ORG,
        ContentRole.COMMENTER,
    )


async def test_invited_content_does_not_inherit_org_access() -> None:
    policy = await resolve_creation_policy(
        MagicMock(spec=AsyncSession),
        generate_id(),
        ContentType.FILE,
        AccessMode.EXPLICIT_MEMBERS,
        None,
    )

    assert resolve_effective_policy(*policy, AccessMode.OPEN_TO_ORG, ContentRole.EDITOR) == (
        AccessMode.EXPLICIT_MEMBERS,
        None,
    )


@pytest.mark.parametrize(
    ("mode", "baseline"),
    [
        (None, ContentRole.EDITOR),
        (AccessMode.OPEN_TO_ORG, ContentRole.OWNER),
        (AccessMode.OPEN_TO_ORG, ContentRole.BLOCKED),
    ],
)
async def test_invalid_creation_policy_is_rejected(
    mode: AccessMode | None, baseline: ContentRole
) -> None:
    with pytest.raises(ValidationError):
        await resolve_creation_policy(
            MagicMock(spec=AsyncSession), generate_id(), ContentType.PROJECT, mode, baseline
        )


async def test_explicit_inheritance_mutations_keep_their_meaning() -> None:
    assert await resolve_access_policy(
        MagicMock(spec=AsyncSession), generate_id(), ContentType.PROJECT, None, None
    ) == (None, None)
