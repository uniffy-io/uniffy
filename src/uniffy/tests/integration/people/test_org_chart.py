"""Org chart assembly: tree shape, and the guards that keep a malformed
manager graph from hanging the read path.

The write path rejects cycles, so the cycles here are written straight to the
table - which is exactly the state the read-time guard exists for (a directory
sync, a manual fix, or two racing `set_manager` calls).
"""

import pytest
from sqlalchemy import update

from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.people.profile import PeopleProfile
from uniffy.core.types import generate_id
from uniffy.domains.people.chart import build_org_chart_payload
from uniffy.domains.people.operations import MAX_CHART_DEPTH

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _set_manager_row(session, org_id, user_id, manager_id) -> None:
    """Write the edge directly, bypassing the cycle guard on the write path."""
    result = await session.execute(
        update(PeopleProfile)
        .where(
            PeopleProfile.organization_id == org_id,
            PeopleProfile.user_id == user_id,
        )
        .values(manager_user_id=manager_id)
    )
    if result.rowcount == 0:
        session.add(
            PeopleProfile(organization_id=org_id, user_id=user_id, manager_user_id=manager_id)
        )
    await session.commit()


async def _seed_chain(session, people, length: int) -> list:
    """A straight reporting line `length` deep, hung off no one."""
    suffix = generate_id().hex[:8]
    chain = []
    previous = None
    for index in range(length):
        user = User(
            email=f"itp-chain{index}-{suffix}@test.local",
            username=f"itp-chain{index}-{suffix}",
            full_name=f"Chain {index:03d}",
            hashed_password="x",
        )
        session.add(user)
        await session.flush()
        session.add(
            OrganizationMember(
                user_id=user.id,
                organization_id=people.org_id,
                role=OrganizationRole.MEMBER,
            )
        )
        session.add(
            PeopleProfile(organization_id=people.org_id, user_id=user.id, manager_user_id=previous)
        )
        previous = user.id
        chain.append(user.id)
        people.user_ids.append(user.id)
    await session.commit()
    return chain


def _by_id(payload) -> dict:
    return {node["user_id"]: node for node in payload["nodes"]}


class TestShape:
    async def test_every_active_member_is_a_node(self, session, people) -> None:
        payload = await build_org_chart_payload(session, people.org_id)
        assert set(_by_id(payload)) == {
            str(people.ceo_id),
            str(people.vp_id),
            str(people.ic_id),
            str(people.contractor_id),
            str(people.lead_id),
        }

    async def test_deactivated_member_is_absent(self, session, people) -> None:
        payload = await build_org_chart_payload(session, people.org_id)
        assert str(people.ghost_id) not in _by_id(payload)

    async def test_manager_edges_are_carried(self, session, people) -> None:
        nodes = _by_id(await build_org_chart_payload(session, people.org_id))
        assert nodes[str(people.vp_id)]["manager_user_id"] == str(people.ceo_id)
        assert nodes[str(people.ic_id)]["manager_user_id"] == str(people.vp_id)

    async def test_members_without_a_manager_are_roots(self, session, people) -> None:
        payload = await build_org_chart_payload(session, people.org_id)
        assert set(payload["root_user_ids"]) == {str(people.ceo_id), str(people.lead_id)}
        assert payload["truncated"] is False

    async def test_descendant_counts_are_recursive(self, session, people) -> None:
        nodes = _by_id(await build_org_chart_payload(session, people.org_id))
        assert nodes[str(people.ceo_id)]["descendant_count"] == 3
        assert nodes[str(people.vp_id)]["descendant_count"] == 2
        assert nodes[str(people.ic_id)]["descendant_count"] == 0

    async def test_profile_facts_are_denormalized_onto_nodes(self, session, people) -> None:
        nodes = _by_id(await build_org_chart_payload(session, people.org_id))
        assert nodes[str(people.vp_id)]["job_title"] == "VP Engineering"
        assert nodes[str(people.vp_id)]["department"] == "Engineering"

    async def test_a_member_without_a_profile_still_renders(self, session, people) -> None:
        node = _by_id(await build_org_chart_payload(session, people.org_id))[str(people.lead_id)]
        assert node["display_name"] == "Emil Lead"
        assert node["job_title"] is None
        assert node["manager_user_id"] is None

    async def test_active_team_memberships_ride_along(self, session, people) -> None:
        nodes = _by_id(await build_org_chart_payload(session, people.org_id))
        assert [team["group_id"] for team in nodes[str(people.ic_id)]["teams"]] == [
            str(people.platform_id)
        ]
        # The contractor's team row is inactive.
        assert nodes[str(people.contractor_id)]["teams"] == []

    async def test_team_nodes_accompany_the_people(self, session, people) -> None:
        payload = await build_org_chart_payload(session, people.org_id)
        teams = {team["group_id"] for team in payload["teams"]}
        assert teams == {str(people.platform_id), str(people.infra_id)}

    async def test_other_orgs_never_bleed_in(self, session, people) -> None:
        payload = await build_org_chart_payload(session, people.org_id)
        assert str(people.stranger_id) not in _by_id(payload)

    async def test_org_with_no_members_is_empty_not_broken(self, session, people) -> None:
        payload = await build_org_chart_payload(session, generate_id())
        assert payload["nodes"] == []
        assert payload["root_user_ids"] == []
        assert payload["truncated"] is False


class TestDeadEdges:
    async def test_report_of_a_deactivated_manager_becomes_a_root(self, session, people) -> None:
        await _set_manager_row(session, people.org_id, people.lead_id, people.ghost_id)
        payload = await build_org_chart_payload(session, people.org_id)

        assert str(people.lead_id) in payload["root_user_ids"]
        assert _by_id(payload)[str(people.lead_id)]["manager_user_id"] is None
        assert payload["truncated"] is False

    async def test_a_report_of_a_deactivated_manager_is_not_hidden(self, session, people) -> None:
        await _set_manager_row(session, people.org_id, people.lead_id, people.ghost_id)
        assert str(people.lead_id) in _by_id(await build_org_chart_payload(session, people.org_id))

    async def test_manager_in_another_org_is_a_dead_edge(self, session, people) -> None:
        await _set_manager_row(session, people.org_id, people.lead_id, people.stranger_id)
        payload = await build_org_chart_payload(session, people.org_id)
        assert _by_id(payload)[str(people.lead_id)]["manager_user_id"] is None


class TestCycleGuard:
    async def test_two_node_cycle_terminates_and_reports_truncated(self, session, people) -> None:
        # vp -> ceo already; close the loop.
        await _set_manager_row(session, people.org_id, people.ceo_id, people.vp_id)
        payload = await build_org_chart_payload(session, people.org_id)

        assert payload["truncated"] is True
        assert {str(people.ceo_id), str(people.vp_id)} <= set(_by_id(payload))

    async def test_cycle_members_are_force_rooted(self, session, people) -> None:
        await _set_manager_row(session, people.org_id, people.ceo_id, people.vp_id)
        payload = await build_org_chart_payload(session, people.org_id)

        roots = set(payload["root_user_ids"])
        assert roots & {str(people.ceo_id), str(people.vp_id)}

    async def test_everyone_stays_reachable_through_a_cycle(self, session, people) -> None:
        await _set_manager_row(session, people.org_id, people.ceo_id, people.vp_id)
        payload = await build_org_chart_payload(session, people.org_id)
        assert len(payload["nodes"]) == 5

    async def test_self_management_written_directly_still_terminates(self, session, people) -> None:
        await _set_manager_row(session, people.org_id, people.lead_id, people.lead_id)
        payload = await build_org_chart_payload(session, people.org_id)

        assert payload["truncated"] is True
        assert str(people.lead_id) in _by_id(payload)


class TestDepthCap:
    async def test_a_chain_deeper_than_the_cap_truncates_cleanly(self, session, people) -> None:
        await _seed_chain(session, people, MAX_CHART_DEPTH + 5)
        payload = await build_org_chart_payload(session, people.org_id)

        assert payload["truncated"] is True
        # Truncation is about the walk, not about dropping people.
        assert len(payload["nodes"]) == 5 + MAX_CHART_DEPTH + 5

    async def test_a_chain_within_the_cap_does_not_truncate(self, session, people) -> None:
        await _seed_chain(session, people, MAX_CHART_DEPTH - 10)
        payload = await build_org_chart_payload(session, people.org_id)
        assert payload["truncated"] is False
