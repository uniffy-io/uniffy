"""Default channel enrollment refuses a user without an active organization membership."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import MembershipRequiredError
from uniffy.core.types import generate_id
from uniffy.domains.chat.channels import membership


async def test_a_missing_membership_raises_the_typed_refusal_before_any_enrollment() -> None:
    session = MagicMock()
    session.execute = AsyncMock()
    session.add_all = MagicMock()

    with (
        patch.object(membership, "get_active_membership", AsyncMock(return_value=None)),
        pytest.raises(MembershipRequiredError),
    ):
        await membership.stage_default_channel_memberships(session, generate_id(), generate_id())

    session.execute.assert_not_awaited()
    session.add_all.assert_not_called()
