from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import generate_id
from uniffy.domains.directory.people.policy import ResolvedProfilePolicy
from uniffy.domains.directory.people.reader import PeopleReader


async def test_directory_policy_is_enforced_for_members() -> None:
    session = MagicMock()
    organization_id = generate_id()
    actor_id = generate_id()
    membership = MagicMock(role=OrganizationRole.MEMBER)
    org_ops = MagicMock()
    org_ops.require_org_member = AsyncMock(return_value=membership)

    with (
        patch(
            "uniffy.domains.directory.people.reader.OrganizationOperations",
            return_value=org_ops,
        ),
        patch(
            "uniffy.domains.directory.people.reader.load_profile_policy",
            AsyncMock(
                return_value=ResolvedProfilePolicy(
                    organization_id=organization_id,
                    directory_enabled=False,
                )
            ),
        ),
        pytest.raises(PermissionDeniedError, match="directory is disabled"),
    ):
        await PeopleReader(session).list_people(
            actor_user_id=actor_id,
            organization_id=organization_id,
        )

    org_ops.require_org_member.assert_awaited_once_with(actor_id, organization_id)


async def test_direct_person_lookup_still_requires_active_org_membership() -> None:
    session = MagicMock()
    organization_id = generate_id()
    actor_id = generate_id()
    target_id = generate_id()
    membership = MagicMock(role=OrganizationRole.MEMBER)
    org_ops = MagicMock()
    org_ops.require_org_member = AsyncMock(return_value=membership)
    payload = {"user_id": str(target_id), "display_name": "Target"}

    with (
        patch(
            "uniffy.domains.directory.people.reader.OrganizationOperations",
            return_value=org_ops,
        ),
        patch(
            "uniffy.domains.directory.people.reader.load_person_payload",
            AsyncMock(return_value=payload),
        ) as load_payload,
    ):
        result, is_admin = await PeopleReader(session).get_person(
            actor_user_id=actor_id,
            organization_id=organization_id,
            target_user_id=target_id,
        )

    assert result == payload
    assert is_admin is False
    org_ops.require_org_member.assert_awaited_once_with(actor_id, organization_id)
    load_payload.assert_awaited_once_with(session, organization_id, target_id)
