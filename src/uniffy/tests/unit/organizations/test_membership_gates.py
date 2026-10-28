"""Organization gates tell a missing membership apart from a missing role, with one message."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import MembershipRequiredError, PermissionDeniedError
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.types import generate_id
from uniffy.domains.organizations.operations import OrganizationOperations

_MEMBERSHIP = "uniffy.domains.organizations.operations.get_active_membership"

GATE_MESSAGES = {
    "require_org_member": "Permission denied: Requires organization membership",
    "require_org_admin": "Permission denied: Requires organization admin privileges",
    "require_org_owner": "Permission denied: Requires organization owner privileges",
}


async def _refusal(gate: str, membership: OrganizationMember | None) -> PermissionDeniedError:
    operations = OrganizationOperations(MagicMock())
    with (
        patch(_MEMBERSHIP, AsyncMock(return_value=membership)),
        pytest.raises(PermissionDeniedError) as refused,
    ):
        await getattr(operations, gate)(generate_id(), generate_id())
    return refused.value


@pytest.mark.parametrize("gate", sorted(GATE_MESSAGES))
async def test_a_missing_membership_raises_the_typed_refusal(gate: str) -> None:
    error = await _refusal(gate, None)

    assert isinstance(error, MembershipRequiredError)
    assert str(error) == GATE_MESSAGES[gate]


@pytest.mark.parametrize("gate", ["require_org_admin", "require_org_owner"])
async def test_a_member_without_the_role_gets_a_plain_refusal(gate: str) -> None:
    member = OrganizationMember(
        user_id=generate_id(),
        organization_id=generate_id(),
        role=OrganizationRole.MEMBER,
    )

    error = await _refusal(gate, member)

    assert not isinstance(error, MembershipRequiredError)
    assert str(error) == GATE_MESSAGES[gate]
