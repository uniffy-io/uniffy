from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.domains.directory import projection


async def test_global_user_refresh_reaches_every_active_organization() -> None:
    session = MagicMock()
    search_indexer = MagicMock()
    user = User(email="user@example.com", username="user")
    organizations = [generate_id(), generate_id()]
    directory = MagicMock()
    directory.active_organization_ids = AsyncMock(return_value=organizations)
    directory.index_for_organization = AsyncMock()

    with (
        patch.object(projection, "UserDirectoryProjection", return_value=directory),
        patch.object(projection, "cache_invalidate_by_tag", AsyncMock()) as invalidate_user,
        patch.object(projection, "invalidate_chart", AsyncMock()) as invalidate_chart,
    ):
        await projection.refresh_global_user(session, search_indexer, user)

    invalidate_user.assert_awaited_once_with(f"user:{user.id}")
    assert [call.args[0] for call in invalidate_chart.await_args_list] == organizations
    assert [call.args[1] for call in directory.index_for_organization.await_args_list] == (
        organizations
    )
