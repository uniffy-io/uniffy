"""Directory reads: which members come back, which are excluded, how it pages."""

import pytest

from uniffy.core.errors import NotFoundError
from uniffy.core.types import generate_id
from uniffy.domains.people.operations import MAX_PAGE_SIZE, PeopleOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _ids(rows) -> set:
    return {user.id for _, user, _ in rows}


class TestListing:
    async def test_lists_active_members_only(self, session, people) -> None:
        rows, total = await PeopleOperations(session).list_directory(people.org_id)
        assert _ids(rows) == {
            people.ceo_id,
            people.vp_id,
            people.ic_id,
            people.contractor_id,
            people.lead_id,
        }
        assert people.ghost_id not in _ids(rows)
        assert total == 5

    async def test_include_inactive_adds_the_deactivated_member(self, session, people) -> None:
        rows, total = await PeopleOperations(session).list_directory(
            people.org_id, include_inactive=True
        )
        assert people.ghost_id in _ids(rows)
        assert total == 6

    async def test_other_orgs_members_never_appear(self, session, people) -> None:
        rows, _ = await PeopleOperations(session).list_directory(people.org_id)
        assert people.stranger_id not in _ids(rows)

    async def test_member_without_a_profile_row_still_lists(self, session, people) -> None:
        rows, _ = await PeopleOperations(session).list_directory(people.org_id)
        profiles = {user.id: profile for _, user, profile in rows}
        assert people.lead_id in profiles
        assert profiles[people.lead_id] is None

    async def test_profile_row_rides_along(self, session, people) -> None:
        rows, _ = await PeopleOperations(session).list_directory(people.org_id)
        profiles = {user.id: profile for _, user, profile in rows}
        assert profiles[people.vp_id].job_title == "VP Engineering"

    async def test_ordered_by_display_name(self, session, people) -> None:
        rows, _ = await PeopleOperations(session).list_directory(people.org_id)
        names = [user.full_name for _, user, _ in rows]
        assert names == sorted(names, key=str.lower)

    async def test_empty_org_returns_nothing_rather_than_failing(self, session, people) -> None:
        rows, total = await PeopleOperations(session).list_directory(generate_id())
        assert rows == []
        assert total == 0


class TestFilters:
    async def test_search_matches_the_display_name(self, session, people) -> None:
        rows, total = await PeopleOperations(session).list_directory(people.org_id, search="Clara")
        assert _ids(rows) == {people.ic_id}
        assert total == 1

    async def test_search_matches_a_job_title(self, session, people) -> None:
        rows, _ = await PeopleOperations(session).list_directory(people.org_id, search="VP Eng")
        assert _ids(rows) == {people.vp_id}

    async def test_search_matches_a_department(self, session, people) -> None:
        rows, _ = await PeopleOperations(session).list_directory(people.org_id, search="Leadership")
        assert _ids(rows) == {people.ceo_id}

    async def test_search_is_case_insensitive(self, session, people) -> None:
        rows, _ = await PeopleOperations(session).list_directory(people.org_id, search="clara")
        assert _ids(rows) == {people.ic_id}

    async def test_search_matches_the_email(self, session, people) -> None:
        rows, _ = await PeopleOperations(session).list_directory(people.org_id, search="itp-lead")
        assert _ids(rows) == {people.lead_id}

    async def test_department_filter_is_exact(self, session, people) -> None:
        rows, total = await PeopleOperations(session).list_directory(
            people.org_id, department="Engineering"
        )
        assert _ids(rows) == {people.vp_id, people.ic_id, people.contractor_id}
        assert total == 3

    async def test_department_filter_excludes_deactivated(self, session, people) -> None:
        rows, _ = await PeopleOperations(session).list_directory(people.org_id, department="Finance")
        assert rows == []

    async def test_team_filter_narrows_to_active_team_members(self, session, people) -> None:
        rows, total = await PeopleOperations(session).list_directory(
            people.org_id, team_id=people.platform_id
        )
        # The contractor's membership is inactive and the ghost is deactivated.
        assert _ids(rows) == {people.lead_id, people.ic_id}
        assert total == 2

    async def test_access_group_is_not_a_team_filter(self, session, people) -> None:
        rows, _ = await PeopleOperations(session).list_directory(
            people.org_id, team_id=people.access_group_id
        )
        assert rows == []

    async def test_filters_compose(self, session, people) -> None:
        rows, _ = await PeopleOperations(session).list_directory(
            people.org_id, team_id=people.platform_id, department="Engineering"
        )
        assert _ids(rows) == {people.ic_id}

    async def test_composed_filters_can_return_nothing(self, session, people) -> None:
        rows, total = await PeopleOperations(session).list_directory(
            people.org_id, search="Clara", department="Leadership"
        )
        assert rows == []
        assert total == 0


class TestPagination:
    async def test_pages_through_the_org(self, session, people) -> None:
        ops = PeopleOperations(session)
        first, total = await ops.list_directory(people.org_id, page=1, page_size=2)
        second, _ = await ops.list_directory(people.org_id, page=2, page_size=2)
        third, _ = await ops.list_directory(people.org_id, page=3, page_size=2)

        assert total == 5
        assert (len(first), len(second), len(third)) == (2, 2, 1)
        assert _ids(first) | _ids(second) | _ids(third) == {
            people.ceo_id,
            people.vp_id,
            people.ic_id,
            people.contractor_id,
            people.lead_id,
        }

    async def test_total_counts_the_filtered_set_not_the_page(self, session, people) -> None:
        rows, total = await PeopleOperations(session).list_directory(
            people.org_id, page_size=1, department="Engineering"
        )
        assert len(rows) == 1
        assert total == 3

    async def test_page_size_is_capped(self, session, people) -> None:
        """An oversized page_size clamps instead of becoming a full-table read."""
        rows, _ = await PeopleOperations(session).list_directory(
            people.org_id, page_size=MAX_PAGE_SIZE + 10_000
        )
        assert len(rows) == 5

    async def test_page_beyond_the_end_is_empty(self, session, people) -> None:
        rows, total = await PeopleOperations(session).list_directory(
            people.org_id, page=99, page_size=2
        )
        assert rows == []
        assert total == 5

    async def test_page_zero_reads_the_first_page(self, session, people) -> None:
        rows, _ = await PeopleOperations(session).list_directory(people.org_id, page=0, page_size=2)
        assert len(rows) == 2

    async def test_page_size_zero_still_returns_a_row(self, session, people) -> None:
        rows, _ = await PeopleOperations(session).list_directory(people.org_id, page_size=0)
        assert len(rows) == 1


class TestGetPerson:
    async def test_returns_the_member_user_and_profile(self, session, people) -> None:
        member, user, profile = await PeopleOperations(session).get_person(
            people.org_id, people.vp_id
        )
        assert member.organization_id == people.org_id
        assert user.id == people.vp_id
        assert profile.job_title == "VP Engineering"

    async def test_member_without_a_profile_resolves_to_none(self, session, people) -> None:
        _, user, profile = await PeopleOperations(session).get_person(people.org_id, people.lead_id)
        assert user.id == people.lead_id
        assert profile is None

    async def test_deactivated_member_is_not_found(self, session, people) -> None:
        with pytest.raises(NotFoundError):
            await PeopleOperations(session).get_person(people.org_id, people.ghost_id)

    async def test_cross_org_read_is_not_found_rather_than_denied(self, session, people) -> None:
        """Existence must not leak across tenants."""
        with pytest.raises(NotFoundError):
            await PeopleOperations(session).get_person(people.org_id, people.stranger_id)

    async def test_unknown_user_is_not_found(self, session, people) -> None:
        with pytest.raises(NotFoundError):
            await PeopleOperations(session).get_person(people.org_id, generate_id())

    async def test_a_read_never_creates_a_profile_row(self, session, people) -> None:
        ops = PeopleOperations(session)
        assert await ops.get_profile(people.org_id, people.lead_id) is None
        await ops.get_person(people.org_id, people.lead_id)
        assert await ops.get_profile(people.org_id, people.lead_id) is None


class TestDirectReportCounts:
    async def test_counts_per_manager_in_one_pass(self, session, people) -> None:
        counts = await PeopleOperations(session).count_direct_reports(
            people.org_id, [people.ceo_id, people.vp_id, people.lead_id]
        )
        # The ghost reports to the ceo but is deactivated, so only the vp counts.
        assert counts == {people.ceo_id: 1, people.vp_id: 2}

    async def test_empty_input_returns_empty(self, session, people) -> None:
        assert await PeopleOperations(session).count_direct_reports(people.org_id, []) == {}

    async def test_counts_are_org_scoped(self, session, people) -> None:
        counts = await PeopleOperations(session).count_direct_reports(
            people.other_org_id, [people.ceo_id, people.vp_id]
        )
        assert counts == {}
