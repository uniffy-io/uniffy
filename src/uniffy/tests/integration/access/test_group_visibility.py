"""Private groups list for their own members; only admins see the full set.

A private group's roster is the subject list of whatever content it holds
grants on, so exposing it to non-members leaks the sharing graph. That is a
statement about rows, so it is checked against rows.
"""

import pytest
from sqlalchemy import select

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.login.group import Group
from uniffy.domains.groups.naming import ensure_name_available
from uniffy.domains.groups.operations import GroupOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _listed(session, access, actor_id, **kwargs) -> set:
    rows, _ = await GroupOperations(session).list_in_organization(
        access.org_id, actor_id, page_size=100, **kwargs
    )
    return {group.id for group, _count in rows}


class TestPrivateGroupVisibility:
    async def test_a_member_of_a_private_group_sees_it(self, session, access) -> None:
        assert access.private_group_id in await _listed(session, access, access.member_id)

    async def test_a_non_member_does_not_see_it(self, session, access) -> None:
        assert access.private_group_id not in await _listed(session, access, access.peer_id)

    async def test_an_org_admin_does_not_see_it_by_default(self, session, access) -> None:
        """Admin power is opt-in through include_private, not implicit."""
        assert access.private_group_id not in await _listed(session, access, access.admin_id)

    async def test_public_groups_are_visible_to_everyone(self, session, access) -> None:
        for actor_id in (access.member_id, access.peer_id, access.admin_id):
            listed = await _listed(session, access, actor_id)
            assert access.access_group_id in listed
            assert access.team_id in listed

    async def test_include_private_shows_the_full_set_to_an_admin(
        self, session, access
    ) -> None:
        listed = await _listed(session, access, access.admin_id, include_private=True)
        assert access.private_group_id in listed

    async def test_include_private_is_refused_for_an_ordinary_member(
        self, session, access
    ) -> None:
        with pytest.raises(PermissionDeniedError):
            await _listed(session, access, access.peer_id, include_private=True)

    async def test_a_non_member_of_the_org_is_refused(self, session, access) -> None:
        with pytest.raises(PermissionDeniedError):
            await _listed(session, access, access.outsider_id)

    async def test_a_deactivated_member_is_refused(self, session, access) -> None:
        with pytest.raises(PermissionDeniedError):
            await _listed(session, access, access.ghost_id)

    async def test_the_total_matches_the_visible_rows(self, session, access) -> None:
        rows, total = await GroupOperations(session).list_in_organization(
            access.org_id, access.peer_id, page_size=100
        )
        assert total == len(rows)


class TestNameNamespace:
    async def _name_of(self, session, group_id) -> str:
        return (
            await session.execute(select(Group.name).where(Group.id == group_id))
        ).scalar_one()

    async def test_an_existing_name_is_rejected(self, session, access) -> None:
        taken = await self._name_of(session, access.team_id)
        with pytest.raises(ValidationError) as exc:
            await ensure_name_available(session, access.org_id, taken)
        assert "already exists" in str(exc.value)

    async def test_the_check_is_case_insensitive(self, session, access) -> None:
        taken = await self._name_of(session, access.team_id)
        with pytest.raises(ValidationError):
            await ensure_name_available(session, access.org_id, taken.upper())

    async def test_teams_and_access_groups_share_one_namespace(
        self, session, access
    ) -> None:
        access_group_name = await self._name_of(session, access.access_group_id)
        with pytest.raises(ValidationError):
            await ensure_name_available(session, access.org_id, access_group_name)

    async def test_a_free_name_passes(self, session, access) -> None:
        await ensure_name_available(session, access.org_id, "Nobody Uses This Name")

    async def test_the_namespace_is_per_org(self, session, access) -> None:
        taken = await self._name_of(session, access.team_id)
        await ensure_name_available(session, access.other_org_id, taken)
