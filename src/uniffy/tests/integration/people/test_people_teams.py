"""Team reads and structure writes over TEAM-kind groups.

An ACCESS group is a permission bundle with no org meaning, so every read here
has to prove it stays out; an inactive membership has to confer nothing.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select, update

from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.login.group import Group
from uniffy.core.search import SearchIndexer
from uniffy.core.types import generate_id
from uniffy.domains.people.teams import (
    get_team,
    list_team_nodes,
    search_team_nodes,
    teams_for_users,
    update_team,
    user_team_ids,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _no_search():
    indexer = MagicMock()
    indexer.index_team = AsyncMock()
    return patch("uniffy.domains.people.teams.TeamSearchIndexer", return_value=indexer)


def _search_indexer() -> SearchIndexer:
    return MagicMock(spec=SearchIndexer)


async def _audit_actions(session, org_id, resource_id) -> list[str]:
    result = await session.execute(
        select(AuditEvent.action).where(
            AuditEvent.organization_id == org_id,
            AuditEvent.resource_id == resource_id,
        )
    )
    return [row[0] for row in result.all()]


class TestTeamsForUsers:
    async def test_maps_members_to_their_teams(self, session, people) -> None:
        teams = await teams_for_users(session, people.org_id, [people.ic_id])
        assert [team["group_id"] for team in teams[people.ic_id]] == [str(people.platform_id)]

    async def test_access_groups_are_not_teams(self, session, people) -> None:
        """The ic belongs to both a team and an access group."""
        teams = await teams_for_users(session, people.org_id, [people.ic_id])
        assert str(people.access_group_id) not in {team["group_id"] for team in teams[people.ic_id]}

    async def test_inactive_membership_confers_nothing(self, session, people) -> None:
        teams = await teams_for_users(session, people.org_id, [people.contractor_id])
        assert teams.get(people.contractor_id) is None

    async def test_carries_the_lead(self, session, people) -> None:
        teams = await teams_for_users(session, people.org_id, [people.lead_id])
        assert teams[people.lead_id][0]["lead_user_id"] == str(people.lead_id)

    async def test_empty_input_returns_empty(self, session, people) -> None:
        assert await teams_for_users(session, people.org_id, []) == {}

    async def test_scoped_to_the_org(self, session, people) -> None:
        teams = await teams_for_users(session, people.other_org_id, [people.ic_id])
        assert teams == {}


class TestUserTeamIds:
    async def test_returns_only_active_team_membership(self, session, people) -> None:
        assert await user_team_ids(session, people.org_id, people.ic_id) == [people.platform_id]

    async def test_inactive_membership_is_excluded(self, session, people) -> None:
        assert await user_team_ids(session, people.org_id, people.contractor_id) == []

    async def test_scoped_to_the_org(self, session, people) -> None:
        assert await user_team_ids(session, people.other_org_id, people.ic_id) == []


class TestListTeamNodes:
    async def test_lists_teams_only(self, session, people) -> None:
        nodes = await list_team_nodes(session, people.org_id)
        assert {node["group_id"] for node in nodes} == {
            str(people.platform_id),
            str(people.infra_id),
        }

    async def test_carries_parent_and_lead_edges(self, session, people) -> None:
        nodes = {node["group_id"]: node for node in await list_team_nodes(session, people.org_id)}
        assert nodes[str(people.infra_id)]["parent_group_id"] == str(people.platform_id)
        assert nodes[str(people.platform_id)]["lead_user_id"] == str(people.lead_id)
        assert nodes[str(people.platform_id)]["parent_group_id"] is None

    async def test_a_parent_cycle_in_the_table_is_broken_in_the_payload(
        self, session, people
    ) -> None:
        # Close the loop directly; the write path would reject this.
        await session.execute(
            update(Group)
            .where(Group.id == people.platform_id)
            .values(parent_group_id=people.infra_id)
        )
        await session.commit()

        nodes = {node["group_id"]: node for node in await list_team_nodes(session, people.org_id)}
        parents = [node["parent_group_id"] for node in nodes.values()]
        assert None in parents

    async def test_empty_org_lists_nothing(self, session, people) -> None:
        assert await list_team_nodes(session, generate_id()) == []


class TestSearchTeamNodes:
    async def test_searches_name_and_caps_results(self, session, people) -> None:
        nodes, total = await search_team_nodes(
            session,
            people.org_id,
            search="plat",
            limit=1,
        )
        assert [node["group_id"] for node in nodes] == [str(people.platform_id)]
        assert total == 1

    async def test_access_groups_never_match(self, session, people) -> None:
        nodes, total = await search_team_nodes(
            session,
            people.org_id,
            search="Access",
        )
        assert nodes == []
        assert total == 0


class TestGetTeam:
    async def test_returns_the_node_and_its_active_members(self, session, people) -> None:
        node, member_ids = await get_team(session, people.org_id, people.platform_id)
        assert node["group_id"] == str(people.platform_id)
        # The contractor is inactive in the team, the ghost inactive in the org.
        assert set(member_ids) == {str(people.lead_id), str(people.ic_id)}

    async def test_deactivated_org_member_is_excluded(self, session, people) -> None:
        _, member_ids = await get_team(session, people.org_id, people.platform_id)
        assert str(people.ghost_id) not in member_ids

    async def test_an_access_group_is_not_a_team(self, session, people) -> None:
        with pytest.raises(NotFoundError):
            await get_team(session, people.org_id, people.access_group_id)

    async def test_another_orgs_team_is_not_found(self, session, people) -> None:
        with pytest.raises(NotFoundError):
            await get_team(session, people.other_org_id, people.platform_id)

    async def test_unknown_team_is_not_found(self, session, people) -> None:
        with pytest.raises(NotFoundError):
            await get_team(session, people.org_id, generate_id())


class TestUpdateTeam:
    async def test_sets_the_lead_and_audits_it(self, session, people) -> None:
        with _no_search():
            node = await update_team(
                session,
                _search_indexer(),
                people.org_id,
                people.ceo_id,
                people.infra_id,
                lead_user_id=people.vp_id,
            )
        assert node["lead_user_id"] == str(people.vp_id)
        assert Action.TEAM_LEAD_CHANGED in await _audit_actions(
            session, people.org_id, people.infra_id
        )

    async def test_clears_the_lead(self, session, people) -> None:
        with _no_search():
            node = await update_team(
                session,
                _search_indexer(),
                people.org_id,
                people.ceo_id,
                people.platform_id,
                lead_user_id=None,
            )
        assert node["lead_user_id"] is None

    async def test_lead_must_be_an_active_member(self, session, people) -> None:
        with _no_search(), pytest.raises(ValidationError):
            await update_team(
                session,
                _search_indexer(),
                people.org_id,
                people.ceo_id,
                people.infra_id,
                lead_user_id=people.ghost_id,
            )

    async def test_lead_from_another_org_is_rejected(self, session, people) -> None:
        with _no_search(), pytest.raises(ValidationError):
            await update_team(
                session,
                _search_indexer(),
                people.org_id,
                people.ceo_id,
                people.infra_id,
                lead_user_id=people.stranger_id,
            )

    async def test_sets_the_parent_and_audits_it(self, session, people) -> None:
        with _no_search():
            await update_team(
                session,
                _search_indexer(),
                people.org_id,
                people.ceo_id,
                people.infra_id,
                parent_group_id=None,
            )
            node = await update_team(
                session,
                _search_indexer(),
                people.org_id,
                people.ceo_id,
                people.infra_id,
                parent_group_id=people.platform_id,
            )
        assert node["parent_group_id"] == str(people.platform_id)
        assert Action.TEAM_PARENT_CHANGED in await _audit_actions(
            session, people.org_id, people.infra_id
        )

    async def test_a_team_cannot_parent_itself(self, session, people) -> None:
        with _no_search(), pytest.raises(ValidationError):
            await update_team(
                session,
                _search_indexer(),
                people.org_id,
                people.ceo_id,
                people.infra_id,
                parent_group_id=people.infra_id,
            )

    async def test_a_parent_cycle_is_rejected(self, session, people) -> None:
        """infra already reports to platform; platform may not report to infra."""
        with _no_search(), pytest.raises(ValidationError):
            await update_team(
                session,
                _search_indexer(),
                people.org_id,
                people.ceo_id,
                people.platform_id,
                parent_group_id=people.infra_id,
            )

    async def test_an_access_group_cannot_be_a_parent(self, session, people) -> None:
        with _no_search(), pytest.raises(ValidationError):
            await update_team(
                session,
                _search_indexer(),
                people.org_id,
                people.ceo_id,
                people.infra_id,
                parent_group_id=people.access_group_id,
            )

    async def test_an_access_group_cannot_be_updated_as_a_team(self, session, people) -> None:
        with _no_search(), pytest.raises(NotFoundError):
            await update_team(
                session,
                _search_indexer(),
                people.org_id,
                people.ceo_id,
                people.access_group_id,
                lead_user_id=people.ceo_id,
            )

    async def test_an_unchanged_call_writes_no_audit_row(self, session, people) -> None:
        with _no_search():
            await update_team(
                session,
                _search_indexer(),
                people.org_id,
                people.ceo_id,
                people.platform_id,
                lead_user_id=people.lead_id,
            )
        assert await _audit_actions(session, people.org_id, people.platform_id) == []
