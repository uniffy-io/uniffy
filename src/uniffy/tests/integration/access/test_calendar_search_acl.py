"""Events are search candidates for whoever reaches them through their calendar.

The container fields are computed from PostgreSQL rows and pushed to every event
document on the calendar by a durable, versioned refresh; these cases assert the
computed access, the queue rows, and the documents the job patches.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.search_acl_refresh import CalendarSearchAclRefresh
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.search import SearchIndexer
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.search.policy import SearchContainerAccess
from uniffy.core.search.workspace import WorkspaceSearch
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    RecurrencePattern,
    SubjectType,
    generate_id,
)
from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.domains.scheduling.calendar.calendars.operations import CalendarOperations
from uniffy.domains.scheduling.calendar.calendars.search import (
    calendar_search_access,
    event_document_ids,
    record_calendar_search_acl_refresh,
)
from uniffy.domains.scheduling.calendar.jobs import search as calendar_search_jobs
from uniffy.domains.scheduling.calendar.operations import CalendarEventOperations
from uniffy.domains.search.operations import SearchOperations
from uniffy.infrastructure.search import MeiliSearchEngine

pytestmark = pytest.mark.asyncio(loop_scope="session")

START = datetime.now(UTC).replace(microsecond=0) + timedelta(days=2)


async def _calendar(session, access, *, access_mode=AccessMode.EXPLICIT_MEMBERS, baseline=None):
    calendar = Calendar(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Team",
        access_mode=access_mode,
        baseline_role=baseline,
    )
    session.add(calendar)
    await session.commit()
    return calendar


def _member(access, calendar_id, subject_type, subject_id, role, *, expires_at=None):
    return ContentMember(
        organization_id=access.org_id,
        content_type=ContentType.CALENDAR,
        content_id=calendar_id,
        subject_type=subject_type,
        subject_id=subject_id,
        role=role,
        added_by_user_id=access.member_id,
        expires_at=expires_at,
    )


def _event(access, calendar_id, **fields) -> CalendarEvent:
    return CalendarEvent(
        organization_id=access.org_id,
        organizer_id=access.member_id,
        calendar_id=calendar_id,
        title=fields.pop("title", "sync"),
        start_time=fields.pop("start_time", START),
        end_time=fields.pop("end_time", START + timedelta(hours=1)),
        access_mode=AccessMode.OWNER_ONLY,
        **fields,
    )


class TestCalendarSearchAccess:
    async def test_names_the_owner_and_live_members_but_not_the_blocked(
        self, session, access
    ) -> None:
        calendar = await _calendar(session, access)
        session.add_all([
            _member(access, calendar.id, SubjectType.USER, access.peer_id, ContentRole.EDITOR),
            _member(access, calendar.id, SubjectType.USER, access.ghost_id, ContentRole.BLOCKED),
            _member(
                access,
                calendar.id,
                SubjectType.USER,
                access.admin_id,
                ContentRole.VIEWER,
                expires_at=datetime.now(UTC) - timedelta(minutes=1),
            ),
            _member(
                access, calendar.id, SubjectType.GROUP, access.access_group_id, ContentRole.VIEWER
            ),
        ])
        await session.commit()

        granted = await calendar_search_access(session, access.org_id, calendar.id)

        assert granted == SearchContainerAccess(
            user_ids=(access.member_id, access.peer_id),
            group_ids=(access.access_group_id,),
            open_to_org=False,
        )

    async def test_an_open_calendar_reaches_the_whole_organization(self, session, access) -> None:
        calendar = await _calendar(
            session, access, access_mode=AccessMode.OPEN_TO_ORG, baseline=ContentRole.VIEWER
        )

        granted = await calendar_search_access(session, access.org_id, calendar.id)

        assert granted.open_to_org is True

    async def test_a_deleted_calendar_grants_nothing(self, session, access) -> None:
        calendar = await _calendar(
            session, access, access_mode=AccessMode.OPEN_TO_ORG, baseline=ContentRole.VIEWER
        )
        calendar.is_deleted = True
        await session.commit()

        assert (
            await calendar_search_access(session, access.org_id, calendar.id)
            == SearchContainerAccess()
        )


class TestIndexing:
    async def test_an_event_is_indexed_with_its_calendars_access(self, session, access) -> None:
        calendar = await _calendar(session, access)
        session.add(
            _member(access, calendar.id, SubjectType.USER, access.peer_id, ContentRole.VIEWER)
        )
        await session.commit()
        indexer = AsyncMock(spec=SearchIndexer)

        await CalendarEventOperations(session, indexer).create(
            user_id=access.member_id,
            organization_id=access.org_id,
            title="planning",
            start_time=START,
            end_time=START + timedelta(hours=1),
            calendar_id=calendar.id,
        )

        container = indexer.index.await_args.kwargs["container"]
        assert set(container.user_ids) == {access.member_id, access.peer_id}


class TestRefreshQueue:
    async def test_sharing_a_calendar_records_a_refresh(self, session, access) -> None:
        calendar = await _calendar(session, access)
        calendar_id = calendar.id

        await ContentMembersOperations(session, AsyncMock(spec=SearchIndexer)).add_member(
            actor_user_id=access.member_id,
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR,
            content_id=calendar_id,
            subject_type=SubjectType.USER,
            subject_id=access.peer_id,
            role=ContentRole.VIEWER,
        )

        assert await session.get(CalendarSearchAclRefresh, calendar_id) is not None

    async def test_moving_a_deleted_calendars_events_refreshes_the_target(
        self, session, access
    ) -> None:
        source = await _calendar(session, access)
        target = await _calendar(session, access)
        session.add(_event(access, source.id))
        await session.commit()
        source_id, target_id = source.id, target.id

        await CalendarOperations(session, AsyncMock(spec=SearchIndexer)).delete_calendar(
            access.member_id, access.org_id, source_id, target_calendar_id=target_id
        )

        assert await session.get(CalendarSearchAclRefresh, target_id) is not None


class TestRefreshJob:
    async def test_patches_every_event_on_the_calendar_and_clears_the_row(
        self, session, access
    ) -> None:
        calendar = await _calendar(session, access)
        elsewhere = await _calendar(session, access)
        master = _event(access, calendar.id, recurrence_pattern=RecurrencePattern.DAILY)
        session.add(master)
        await session.flush()
        # An edited occurrence always shares its series' calendar.
        override = _event(
            access,
            calendar.id,
            recurrence_id=master.id,
            start_time=START + timedelta(days=1),
            end_time=START + timedelta(days=1, hours=1),
        )
        gone = _event(access, calendar.id, is_deleted=True)
        unrelated = _event(access, elsewhere.id)
        session.add_all([override, gone, unrelated])
        session.add(
            _member(access, calendar.id, SubjectType.USER, access.peer_id, ContentRole.VIEWER)
        )
        await record_calendar_search_acl_refresh(session, access.org_id, calendar.id)
        await session.commit()
        calendar_id, master_id, override_id = calendar.id, master.id, override.id

        search = MagicMock()
        search.update_container_access = AsyncMock(return_value=2)
        result = await calendar_search_jobs._process_calendar(calendar_id, search)

        assert result == {"status": "complete", "updated": 2}
        document_ids, granted = search.update_container_access.await_args.args
        assert set(document_ids) == set(event_document_ids(access.org_id, [master_id, override_id]))
        assert set(granted.user_ids) == {access.member_id, access.peer_id}
        session.expire_all()
        assert await session.get(CalendarSearchAclRefresh, calendar_id) is None

    async def test_a_refresh_recorded_mid_run_survives(self, session, access) -> None:
        calendar = await _calendar(session, access)
        session.add(_event(access, calendar.id))
        await record_calendar_search_acl_refresh(session, access.org_id, calendar.id)
        await session.commit()
        calendar_id = calendar.id

        async def share_meanwhile(*_args):
            await record_calendar_search_acl_refresh(session, access.org_id, calendar_id)
            await session.commit()
            return 1

        search = MagicMock()
        search.update_container_access = AsyncMock(side_effect=share_meanwhile)
        result = await calendar_search_jobs._process_calendar(calendar_id, search)

        assert result == {"status": "superseded", "updated": 1}
        session.expire_all()
        queued = await session.get(CalendarSearchAclRefresh, calendar_id)
        assert queued is not None and queued.version == 2

    async def test_a_failed_patch_keeps_the_row_and_counts_the_attempt(
        self, session, access
    ) -> None:
        calendar = await _calendar(session, access)
        session.add(_event(access, calendar.id))
        await record_calendar_search_acl_refresh(session, access.org_id, calendar.id)
        await session.commit()
        calendar_id = calendar.id

        search = MagicMock()
        search.update_container_access = AsyncMock(side_effect=RuntimeError("search down"))
        with pytest.raises(RuntimeError):
            await calendar_search_jobs._process_calendar(calendar_id, search)

        session.expire_all()
        queued = await session.get(CalendarSearchAclRefresh, calendar_id)
        assert queued is not None and queued.attempts == 1

    async def test_a_deleted_calendars_events_are_patched_to_no_access(
        self, session, access
    ) -> None:
        calendar = await _calendar(session, access)
        session.add(_event(access, calendar.id))
        await record_calendar_search_acl_refresh(session, access.org_id, calendar.id)
        calendar.is_deleted = True
        await session.commit()
        calendar_id = calendar.id

        search = MagicMock()
        search.update_container_access = AsyncMock(return_value=1)
        result = await calendar_search_jobs._process_calendar(calendar_id, search)

        assert result == {"status": "complete", "updated": 1}
        assert search.update_container_access.await_args.args[1] == SearchContainerAccess()

    async def test_nothing_queued_is_a_no_op(self, session, access) -> None:
        calendar = await _calendar(session, access)
        search = MagicMock()
        search.update_container_access = AsyncMock()

        assert await calendar_search_jobs._process_calendar(calendar.id, search) == {
            "status": "empty"
        }
        search.update_container_access.assert_not_awaited()


class TestLiveSearch:
    async def test_calendar_members_find_its_events_until_the_share_ends(
        self, session, access
    ) -> None:
        search = WorkspaceSearch(MeiliSearchEngine())
        await search.startup()
        calendar = await _calendar(session, access)
        share = _member(access, calendar.id, SubjectType.USER, access.peer_id, ContentRole.VIEWER)
        session.add(share)
        title = f"CalendarShared{generate_id().hex[:12]}"
        event = _event(access, calendar.id, title=title)
        session.add(event)
        await session.commit()
        calendar_id = calendar.id
        urn = build_content_urn(ContentType.CALENDAR_EVENT, event.id)
        await CalendarEventOperations(session, SearchIndexer(search))._index_for_search(event)
        operations = SearchOperations(session, search)

        async def candidates(user_id) -> int:
            page = await search.search(title, access.org_id, user_id)
            return len(page.hits)

        # Indexing (and the settings update for new filterable fields) is asynchronous.
        for _ in range(100):
            if await candidates(access.member_id):
                break
            await asyncio.sleep(0.1)

        try:
            shared_results, _, _ = await operations.search(access.peer_id, access.org_id, title)
            assert [result.urn for result in shared_results] == [urn]
            assert await candidates(access.admin_id) == 0

            await session.delete(share)
            calendar.access_mode = AccessMode.OPEN_TO_ORG
            calendar.baseline_role = ContentRole.VIEWER
            await record_calendar_search_acl_refresh(session, access.org_id, calendar_id)
            await session.commit()
            await calendar_search_jobs._process_calendar(calendar_id, search)
            assert await candidates(access.admin_id) == 1

            calendar.access_mode = AccessMode.OWNER_ONLY
            calendar.baseline_role = None
            await record_calendar_search_acl_refresh(session, access.org_id, calendar_id)
            await session.commit()
            await calendar_search_jobs._process_calendar(calendar_id, search)
            assert await candidates(access.peer_id) == 0
            assert await candidates(access.admin_id) == 0
            assert await candidates(access.member_id) == 1
        finally:
            await search.delete_document(urn, access.org_id)
            await search.shutdown()
