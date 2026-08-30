"""Profile writes: who may write which field, what the directory owns, and the
audit trail every write leaves behind.

Members own personal facts, admins own org facts, and a directory-managed field
belongs to neither.
"""

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select

from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.search import SearchIndexer
from uniffy.core.types import generate_id
from uniffy.domains.people.operations import MAX_PROFILE_LINKS, PeopleOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _no_search():
    return patch("uniffy.domains.people.operations.sync_people_search", AsyncMock())


def _operations(session) -> PeopleOperations:
    return PeopleOperations(session, MagicMock(spec=SearchIndexer))


async def _audit_rows(session, org_id, resource_id) -> list[AuditEvent]:
    result = await session.execute(
        select(AuditEvent).where(
            AuditEvent.organization_id == org_id,
            AuditEvent.resource_id == resource_id,
        )
    )
    return list(result.scalars().all())


class TestSelfService:
    async def test_writes_a_personal_field(self, session, people) -> None:
        with _no_search():
            profile = await _operations(session).update_my_profile(
                people.org_id, people.ic_id, {"bio": "Ships backends."}
            )
        assert profile.bio == "Ships backends."

    async def test_creates_the_row_for_a_member_without_one(self, session, people) -> None:
        ops = _operations(session)
        assert await ops.get_profile(people.org_id, people.lead_id) is None
        with _no_search():
            await ops.update_my_profile(people.org_id, people.lead_id, {"timezone": "Europe/Sofia"})
        stored = await ops.get_profile(people.org_id, people.lead_id)
        assert stored.timezone == "Europe/Sofia"

    async def test_org_facts_are_not_self_service(self, session, people) -> None:
        with _no_search(), pytest.raises(ValidationError):
            await _operations(session).update_my_profile(
                people.org_id, people.ic_id, {"job_title": "Principal Engineer"}
            )

    async def test_start_date_is_not_self_service(self, session, people) -> None:
        with _no_search(), pytest.raises(ValidationError):
            await _operations(session).update_my_profile(
                people.org_id, people.ic_id, {"start_date": date(2020, 1, 1)}
            )

    async def test_a_write_leaves_an_audit_row_naming_the_fields(self, session, people) -> None:
        with _no_search():
            await _operations(session).update_my_profile(
                people.org_id, people.ic_id, {"bio": "Hi", "timezone": "UTC"}
            )
        rows = await _audit_rows(session, people.org_id, people.ic_id)
        assert [row.action for row in rows] == [Action.PERSON_PROFILE_UPDATED]
        assert rows[0].details["changed_keys"] == ["bio", "timezone"]
        assert rows[0].actor_user_id == people.ic_id

    async def test_a_timezone_edit_refreshes_the_search_doc(self, session, people) -> None:
        with patch("uniffy.domains.people.operations.sync_people_search", AsyncMock()) as fanout:
            await _operations(session).update_my_profile(
                people.org_id, people.ic_id, {"timezone": "Asia/Tokyo"}
            )
        fanout.assert_awaited_once()

    async def test_a_bio_edit_leaves_the_search_doc_alone(self, session, people) -> None:
        with patch("uniffy.domains.people.operations.sync_people_search", AsyncMock()) as fanout:
            await _operations(session).update_my_profile(
                people.org_id, people.ic_id, {"bio": "Fanout-free."}
            )
        fanout.assert_not_awaited()

    async def test_writing_the_same_value_audits_nothing(self, session, people) -> None:
        ops = _operations(session)
        with _no_search():
            await ops.update_my_profile(people.org_id, people.ic_id, {"bio": "Same"})
            await ops.update_my_profile(people.org_id, people.ic_id, {"bio": "Same"})
        rows = await _audit_rows(session, people.org_id, people.ic_id)
        assert len(rows) == 1

    async def test_a_deactivated_member_cannot_write(self, session, people) -> None:
        with _no_search(), pytest.raises(NotFoundError):
            await _operations(session).update_my_profile(
                people.org_id, people.ghost_id, {"bio": "Still here"}
            )

    async def test_a_non_member_cannot_write(self, session, people) -> None:
        with _no_search(), pytest.raises(NotFoundError):
            await _operations(session).update_my_profile(
                people.org_id, people.stranger_id, {"bio": "Wrong tenant"}
            )


class TestValueValidation:
    async def test_birthday_must_be_month_day(self, session, people) -> None:
        with _no_search(), pytest.raises(ValidationError):
            await _operations(session).update_my_profile(
                people.org_id, people.ic_id, {"birthday": "1990-04-12"}
            )

    async def test_a_valid_birthday_is_stored(self, session, people) -> None:
        with _no_search():
            profile = await _operations(session).update_my_profile(
                people.org_id, people.ic_id, {"birthday": "04-12"}
            )
        assert profile.birthday == "04-12"

    async def test_an_impossible_month_is_rejected(self, session, people) -> None:
        with _no_search(), pytest.raises(ValidationError):
            await _operations(session).update_my_profile(
                people.org_id, people.ic_id, {"birthday": "13-01"}
            )

    async def test_an_overlong_bio_is_rejected(self, session, people) -> None:
        with _no_search(), pytest.raises(ValidationError):
            await _operations(session).update_my_profile(
                people.org_id, people.ic_id, {"bio": "x" * 2001}
            )

    async def test_too_many_links_are_rejected(self, session, people) -> None:
        links = [
            {"label": f"l{i}", "url": "https://example.com"} for i in range(MAX_PROFILE_LINKS + 1)
        ]
        with _no_search(), pytest.raises(ValidationError):
            await _operations(session).update_my_profile(
                people.org_id, people.ic_id, {"links": links}
            )

    async def test_a_malformed_link_is_rejected(self, session, people) -> None:
        with _no_search(), pytest.raises(ValidationError):
            await _operations(session).update_my_profile(
                people.org_id, people.ic_id, {"links": [{"label": "no url"}]}
            )

    async def test_well_formed_links_round_trip(self, session, people) -> None:
        links = [{"label": "Blog", "url": "https://example.com"}]
        with _no_search():
            profile = await _operations(session).update_my_profile(
                people.org_id, people.ic_id, {"links": links}
            )
        assert profile.links == links


class TestAdminWrites:
    async def test_an_admin_writes_org_facts(self, session, people) -> None:
        with _no_search():
            profile = await _operations(session).update_person_profile(
                people.org_id,
                people.vp_id,
                people.ic_id,
                {"job_title": "Staff Engineer", "office_location": "Sofia"},
            )
        assert profile.job_title == "Staff Engineer"
        assert profile.office_location == "Sofia"

    async def test_the_owner_counts_as_an_admin(self, session, people) -> None:
        with _no_search():
            profile = await _operations(session).update_person_profile(
                people.org_id, people.ceo_id, people.ic_id, {"department": "Platform"}
            )
        assert profile.department == "Platform"

    async def test_a_member_cannot_edit_another_member(self, session, people) -> None:
        with _no_search(), pytest.raises(PermissionDeniedError):
            await _operations(session).update_person_profile(
                people.org_id, people.ic_id, people.lead_id, {"job_title": "Boss"}
            )

    async def test_an_admin_cannot_write_personal_fields(self, session, people) -> None:
        with _no_search(), pytest.raises(ValidationError):
            await _operations(session).update_person_profile(
                people.org_id, people.vp_id, people.ic_id, {"bio": "Written by my boss"}
            )

    async def test_the_audit_row_names_the_admin_as_actor(self, session, people) -> None:
        with _no_search():
            await _operations(session).update_person_profile(
                people.org_id, people.vp_id, people.ic_id, {"job_title": "Staff Engineer"}
            )
        rows = await _audit_rows(session, people.org_id, people.ic_id)
        assert rows[0].actor_user_id == people.vp_id

    async def test_editing_a_deactivated_member_is_not_found(self, session, people) -> None:
        with _no_search(), pytest.raises(NotFoundError):
            await _operations(session).update_person_profile(
                people.org_id, people.vp_id, people.ghost_id, {"job_title": "Analyst"}
            )


class TestDirectoryManagedFields:
    async def test_a_managed_field_rejects_an_admin_write(self, session, people) -> None:
        with _no_search(), pytest.raises(ValidationError):
            await _operations(session).update_person_profile(
                people.org_id,
                people.vp_id,
                people.contractor_id,
                {"job_title": "Locally renamed"},
            )

    async def test_a_managed_field_rejects_a_self_write(self, session, people) -> None:
        ops = _operations(session)
        profile = await ops.get_profile(people.org_id, people.contractor_id)
        profile.managed_fields = ["work_phone"]
        await session.commit()

        with _no_search(), pytest.raises(ValidationError):
            await ops.update_my_profile(people.org_id, people.contractor_id, {"work_phone": "+000"})

    async def test_unmanaged_fields_on_the_same_row_still_write(self, session, people) -> None:
        with _no_search():
            profile = await _operations(session).update_person_profile(
                people.org_id,
                people.vp_id,
                people.contractor_id,
                {"office_location": "Remote"},
            )
        assert profile.office_location == "Remote"


class TestSetManager:
    async def test_an_admin_sets_the_edge(self, session, people) -> None:
        profile = await _operations(session).set_manager(
            people.org_id, people.vp_id, people.lead_id, people.ceo_id
        )
        assert profile.manager_user_id == people.ceo_id

    async def test_clearing_the_edge(self, session, people) -> None:
        profile = await _operations(session).set_manager(
            people.org_id, people.vp_id, people.ic_id, None
        )
        assert profile.manager_user_id is None

    async def test_a_member_cannot_set_a_manager(self, session, people) -> None:
        with pytest.raises(PermissionDeniedError):
            await _operations(session).set_manager(
                people.org_id, people.ic_id, people.lead_id, people.ceo_id
            )

    async def test_self_management_is_rejected(self, session, people) -> None:
        with pytest.raises(ValidationError):
            await _operations(session).set_manager(
                people.org_id, people.vp_id, people.ic_id, people.ic_id
            )

    async def test_a_direct_cycle_is_rejected(self, session, people) -> None:
        """The ic already reports to the vp."""
        with pytest.raises(ValidationError):
            await _operations(session).set_manager(
                people.org_id, people.vp_id, people.vp_id, people.ic_id
            )

    async def test_a_deeper_cycle_is_rejected(self, session, people) -> None:
        """ceo <- vp <- ic; the ceo may not report to the ic."""
        with pytest.raises(ValidationError):
            await _operations(session).set_manager(
                people.org_id, people.vp_id, people.ceo_id, people.ic_id
            )

    async def test_a_deactivated_manager_is_not_found(self, session, people) -> None:
        with pytest.raises(NotFoundError):
            await _operations(session).set_manager(
                people.org_id, people.vp_id, people.lead_id, people.ghost_id
            )

    async def test_a_manager_from_another_org_is_not_found(self, session, people) -> None:
        with pytest.raises(NotFoundError):
            await _operations(session).set_manager(
                people.org_id, people.vp_id, people.lead_id, people.stranger_id
            )

    async def test_an_unknown_target_is_not_found(self, session, people) -> None:
        with pytest.raises(NotFoundError):
            await _operations(session).set_manager(
                people.org_id, people.vp_id, generate_id(), people.ceo_id
            )

    async def test_the_change_is_audited_with_both_ends(self, session, people) -> None:
        await _operations(session).set_manager(
            people.org_id, people.vp_id, people.ic_id, people.ceo_id
        )
        rows = await _audit_rows(session, people.org_id, people.ic_id)
        assert [row.action for row in rows] == [Action.PERSON_MANAGER_CHANGED]
        assert rows[0].details == {
            "previous_manager_user_id": str(people.vp_id),
            "manager_user_id": str(people.ceo_id),
        }

    async def test_setting_the_same_manager_audits_nothing(self, session, people) -> None:
        await _operations(session).set_manager(
            people.org_id, people.vp_id, people.ic_id, people.vp_id
        )
        assert await _audit_rows(session, people.org_id, people.ic_id) == []

    async def test_the_new_edge_reaches_the_chart(self, session, people) -> None:
        ops = _operations(session)
        await ops.set_manager(people.org_id, people.vp_id, people.lead_id, people.ceo_id)
        counts = await ops.count_direct_reports(people.org_id, [people.ceo_id])
        assert counts[people.ceo_id] == 2
