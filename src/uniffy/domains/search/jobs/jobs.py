"""Run search projection recovery work."""

from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.json_codec import loads
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.task import Task
from uniffy.core.models.search import SearchRemovalQueue
from uniffy.core.search.engine import SearchEngineError, search_filter_from_data
from uniffy.core.search.indexer import SEARCH_INDEXER_CTX_KEY, SearchIndexer
from uniffy.domains.calendar.search import refresh_event_search_projection
from uniffy.domains.notes.search import refresh_note_search_projection
from uniffy.domains.projects.search.projection import refresh_task_search_projection
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.ops import get_ops_client

logger = logger.bind(component="search.jobs.jobs")

_LOCK_KEY = "search_removal_flush:lock"
FLUSH_SEARCH_REMOVALS_JOB_TIMEOUT_SECONDS = 300
_LOCK_TTL_SECONDS = FLUSH_SEARCH_REMOVALS_JOB_TIMEOUT_SECONDS + 30
_FLUSH_BATCH = 500

# One day of continuous 5-minute failures; from here every run logs an
# error so a stuck-but-retriable queue surfaces to the operator.
_ATTEMPTS_ALERT_THRESHOLD = 288


def _payload_ids(payload: dict[str, Any], key: str) -> list[UUID]:
    return [UUID(value) for value in payload.get(key, [])]


async def reindex_renamed_content(ctx: dict[str, Any], payload_json: str) -> dict[str, int]:
    payload = loads(payload_json)
    organization_id = UUID(payload["organization_id"])
    note_ids = _payload_ids(payload, "note_ids")
    event_ids = _payload_ids(payload, "event_ids")
    task_ids = _payload_ids(payload, "task_ids")

    async with open_session() as session:
        notes = list(
            (
                await session.execute(
                    select(Note).where(
                        Note.organization_id == organization_id,
                        Note.id.in_(note_ids),
                        Note.is_deleted == False,  # noqa: E712
                    )
                )
            )
            .scalars()
            .all()
        )
        events = list(
            (
                await session.execute(
                    select(CalendarEvent).where(
                        CalendarEvent.organization_id == organization_id,
                        CalendarEvent.id.in_(event_ids),
                    )
                )
            )
            .scalars()
            .all()
        )
        tasks = list(
            (
                await session.execute(
                    select(Task).where(
                        Task.organization_id == organization_id,
                        Task.id.in_(task_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

        search_indexer: SearchIndexer = ctx[SEARCH_INDEXER_CTX_KEY]
        for note in notes:
            await refresh_note_search_projection(session, note, search_indexer)

        for event in events:
            await refresh_event_search_projection(session, event, search_indexer)

        for task in tasks:
            await refresh_task_search_projection(session, task, search_indexer)

    return {
        "notes": len(notes),
        "events": len(events),
        "tasks": len(tasks),
    }


async def _acquire_lock() -> str | None:
    client = get_ops_client()
    if client is None:
        return None
    try:
        return await acquire_owned_job_lock(client, _LOCK_KEY, _LOCK_TTL_SECONDS)
    except Exception:
        logger.warning("search removal flush lock SET NX failed")
        return None


async def _release_lock(token: str) -> None:
    client = get_ops_client()
    if client is None:
        return
    try:
        await release_owned_job_lock(client, _LOCK_KEY, token)
    except Exception:
        logger.warning("search removal flush lock release failed")


async def flush_search_removals(ctx: dict[str, Any]) -> dict[str, Any]:
    """Retry queued removals and delete rows after engine acknowledgement."""
    lock_token = await _acquire_lock()
    if lock_token is None:
        return {"status": "locked"}

    try:
        async with open_session() as session:
            rows = (
                (
                    await session.execute(
                        select(SearchRemovalQueue)
                        .order_by(SearchRemovalQueue.created_at)
                        .limit(_FLUSH_BATCH)
                    )
                )
                .scalars()
                .all()
            )
            if not rows:
                return {"status": "empty"}

            search_indexer: SearchIndexer = ctx[SEARCH_INDEXER_CTX_KEY]
            search = search_indexer.search
            flushed = 0
            failed = 0
            dropped = 0
            stuck = 0
            for row in rows:
                try:
                    if row.urn:
                        await search.delete_document(row.urn, row.organization_id)
                    elif row.filter_spec:
                        await search.delete_documents(search_filter_from_data(row.filter_spec))
                    await session.delete(row)
                    flushed += 1
                except (SearchEngineError, ValueError) as exc:
                    if isinstance(exc, ValueError) or not exc.retryable:
                        logger.error(
                            "Dropping unexecutable search removal",
                            code=getattr(exc, "code", None),
                            row_id=str(row.id),
                        )
                        await session.delete(row)
                        dropped += 1
                    else:
                        row.attempts += 1
                        failed += 1
                        if row.attempts >= _ATTEMPTS_ALERT_THRESHOLD:
                            stuck += 1
                except Exception:
                    row.attempts += 1
                    failed += 1
                    if row.attempts >= _ATTEMPTS_ALERT_THRESHOLD:
                        stuck += 1
            await session.commit()

        if stuck:
            logger.error(
                f"search removal flush: {stuck} rows failing for over a day; "
                "the search engine has been rejecting them - investigate"
            )
        if flushed or failed or dropped:
            logger.info(f"search removal flush: flushed={flushed} failed={failed} dropped={dropped}")
        return {
            "status": "completed",
            "flushed": flushed,
            "failed": failed,
            "dropped": dropped,
        }
    finally:
        await _release_lock(lock_token)
