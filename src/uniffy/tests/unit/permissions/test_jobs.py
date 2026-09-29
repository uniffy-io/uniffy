from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from uniffy.core.search.indexer import SEARCH_INDEXER_CTX_KEY, build_content_urn
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.domains.permissions.jobs.contracts import REINDEX_ORG_CONTENT_FOR_DEFAULTS
from uniffy.domains.permissions.jobs.jobs import (
    _BATCH_SIZE,
    _model_for,
    reindex_org_content_for_defaults,
)
from uniffy.vendor.arq import Retry


class _Checker:
    get_org_defaults = AsyncMock(return_value=(AccessMode.OPEN_TO_ORG, ContentRole.EDITOR))

    def __init__(self, session) -> None:
        self.session = session


def _ctx(bulk: AsyncMock, **extra) -> dict:
    return {SEARCH_INDEXER_CTX_KEY: SimpleNamespace(update_access_policy_bulk=bulk), **extra}


def _row(access_mode: AccessMode | None = None, baseline_role: ContentRole | None = None):
    return SimpleNamespace(id=uuid4(), access_mode=access_mode, baseline_role=baseline_role)


def _session_for(rows: list[SimpleNamespace]):
    session = AsyncMock()
    session.execute.return_value = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))

    @asynccontextmanager
    async def open_session() -> AsyncIterator[AsyncMock]:
        yield session

    return session, open_session


@contextmanager
def _worker_patches(open_session) -> Iterator[None]:
    with (
        patch("uniffy.domains.permissions.jobs.jobs._model_for", return_value=object()),
        patch("uniffy.domains.permissions.jobs.jobs.PermissionChecker", _Checker),
        patch(
            "uniffy.domains.permissions.jobs.jobs._keyset_query",
            return_value=object(),
        ),
        patch("uniffy.domains.permissions.jobs.jobs.open_session", open_session),
    ):
        yield


def test_folder_and_room_have_defaults_reindexers() -> None:
    assert _model_for(ContentType.FOLDER).__name__ == "Folder"
    assert _model_for(ContentType.ROOM).__name__ == "Room"


async def test_page_writes_one_batch_of_resolved_policies() -> None:
    organization_id = uuid4()
    inheriting = _row()
    open_without_baseline = _row(AccessMode.OPEN_TO_ORG, None)
    _session, open_session = _session_for([inheriting, open_without_baseline])
    bulk = AsyncMock()

    with _worker_patches(open_session):
        result = await reindex_org_content_for_defaults(
            _ctx(bulk, job_try=1),
            str(organization_id),
            ContentType.NOTE.value,
        )

    assert result["processed"] == 2
    bulk.assert_awaited_once_with(
        organization_id,
        [
            (
                build_content_urn(ContentType.NOTE, inheriting.id),
                AccessMode.OPEN_TO_ORG,
                ContentRole.EDITOR,
            ),
            (
                build_content_urn(ContentType.NOTE, open_without_baseline.id),
                AccessMode.OPEN_TO_ORG,
                ContentRole.EDITOR,
            ),
        ],
    )


async def test_project_reindex_records_and_enqueues_child_refresh() -> None:
    organization_id = uuid4()
    row = _row()
    session, open_session = _session_for([row])
    bulk = AsyncMock()

    with (
        _worker_patches(open_session),
        patch(
            "uniffy.domains.permissions.jobs.jobs.record_project_search_acl_refresh",
            AsyncMock(),
        ) as record,
        patch(
            "uniffy.domains.permissions.jobs.jobs.enqueue_project_search_acl_refresh",
            AsyncMock(),
        ) as enqueue,
    ):
        result = await reindex_org_content_for_defaults(
            _ctx(bulk, job_try=1),
            str(organization_id),
            ContentType.PROJECT.value,
        )

    assert result == {
        "status": "complete",
        "processed": 1,
        "succeeded": 1,
        "failed": 0,
    }
    record.assert_awaited_once_with(session, organization_id, row.id)
    enqueue.assert_awaited_once_with(row.id)
    session.commit.assert_awaited_once()


async def test_batch_failure_rolls_back_and_retries_the_page() -> None:
    session, open_session = _session_for([_row()])
    bulk = AsyncMock(side_effect=RuntimeError("index failed"))

    with _worker_patches(open_session), pytest.raises(Retry):
        await reindex_org_content_for_defaults(
            _ctx(bulk, job_try=2),
            str(uuid4()),
            ContentType.NOTE.value,
        )

    session.rollback.assert_awaited_once()
    session.commit.assert_not_awaited()


async def test_full_page_enqueues_cursor_scoped_continuation() -> None:
    organization_id = uuid4()
    rows = [_row() for _ in range(_BATCH_SIZE)]
    rows.sort(key=lambda row: row.id)
    _session, open_session = _session_for(rows)
    bulk = AsyncMock()
    enqueue = AsyncMock()

    with (
        _worker_patches(open_session),
        patch("uniffy.domains.permissions.jobs.jobs.enqueue_job", enqueue),
    ):
        result = await reindex_org_content_for_defaults(
            _ctx(bulk, job_try=1, job_id="initial"),
            str(organization_id),
            ContentType.NOTE.value,
            run_id="revision",
        )

    cursor = rows[-1].id
    assert result["status"] == "queued"
    assert bulk.await_count == 1
    enqueue.assert_awaited_once_with(
        REINDEX_ORG_CONTENT_FOR_DEFAULTS,
        str(organization_id),
        ContentType.NOTE.value,
        str(cursor),
        "revision",
        _job_id=(
            f"reindex_defaults_page:{organization_id}:{ContentType.NOTE.value}:revision:{cursor}"
        ),
    )


async def test_the_page_writes_through_the_worker_indexer() -> None:
    """The real job is handed its indexer by the worker, never builds one."""
    _session, open_session = _session_for([_row()])
    bulk = AsyncMock()

    with (
        patch("uniffy.domains.permissions.jobs.jobs._keyset_query", return_value=object()),
        patch("uniffy.domains.permissions.jobs.jobs.open_session", open_session),
        patch("uniffy.domains.permissions.jobs.jobs.PermissionChecker", _Checker),
    ):
        await reindex_org_content_for_defaults(
            _ctx(bulk, job_try=1), str(uuid4()), ContentType.CALENDAR_EVENT.value
        )

    bulk.assert_awaited_once()


def test_calendars_reindex_when_their_default_changes() -> None:
    assert _model_for(ContentType.CALENDAR).__name__ == "Calendar"


async def test_calendar_reindex_records_and_enqueues_its_events_refresh() -> None:
    organization_id = uuid4()
    row = _row()
    session, open_session = _session_for([row])
    bulk = AsyncMock()

    with (
        _worker_patches(open_session),
        patch(
            "uniffy.domains.permissions.jobs.jobs.record_calendar_search_acl_refresh",
            AsyncMock(),
        ) as record,
        patch(
            "uniffy.domains.permissions.jobs.jobs.enqueue_calendar_search_acl_refresh",
            AsyncMock(),
        ) as enqueue,
    ):
        await reindex_org_content_for_defaults(
            _ctx(bulk, job_try=1), str(organization_id), ContentType.CALENDAR.value
        )

    record.assert_awaited_once_with(session, organization_id, row.id)
    enqueue.assert_awaited_once_with(row.id)
