"""Unit checks for live PostgreSQL tag visibility computation."""

from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import true

from uniffy.core.auth.permissions.visible_sets import compute_visible_tag_ids
from uniffy.core.types import generate_id


class TestComputeVisibleTagIds:
    async def test_inactive_actor_has_no_visible_tags(self) -> None:
        session = MagicMock()
        access_query = MagicMock()
        access_query.is_active_member = AsyncMock(return_value=False)
        access_query.has_support_access = AsyncMock(return_value=False)

        with patch(
            "uniffy.core.auth.permissions.visible_sets.ContentAccessQuery",
            return_value=access_query,
        ):
            result = await compute_visible_tag_ids(
                session,
                user_id=generate_id(),
                organization_id=generate_id(),
            )

        assert result == set()
        session.execute.assert_not_called()

    async def test_candidate_ids_bound_the_live_query(self) -> None:
        session = MagicMock()
        tag_id = generate_id()
        execute_result = MagicMock()
        execute_result.scalars.return_value.all.return_value = [tag_id]
        session.execute = AsyncMock(return_value=execute_result)
        access_query = MagicMock()
        access_query.is_active_member = AsyncMock(return_value=True)
        access_query.build_accessible_filter = AsyncMock(return_value=true())
        checker = MagicMock()
        checker.is_org_admin = AsyncMock(return_value=False)
        checker.is_domain_admin = AsyncMock(return_value=False)

        with (
            patch(
                "uniffy.core.auth.permissions.visible_sets.ContentAccessQuery",
                return_value=access_query,
            ),
            patch(
                "uniffy.core.auth.permissions.visible_sets.PermissionChecker",
                return_value=checker,
            ),
        ):
            result = await compute_visible_tag_ids(
                session,
                user_id=generate_id(),
                organization_id=generate_id(),
                candidate_tag_ids={tag_id},
            )

        assert result == {tag_id}
