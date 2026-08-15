"""Drain the search removal queue.

``SearchIndexer`` records every removal in ``search_removal_queue`` before
calling Meilisearch and clears the row on success (write-ahead). Whatever
survives - an outage, a crash mid-call - lands here: retry the Meilisearch
delete, drop the row once it goes through. Steady-state cost is one empty
SELECT per run.
"""

from typing import Any

from loguru import logger
from meilisearch_python_sdk.errors import MeilisearchApiError
from sqlalchemy import select

from uniffy.core.models.search import SearchRemovalQueue
from uniffy.core.search.meilisearch import get_meilisearch_client
from uniffy.core.valkey.ops import _get_ops_client
from uniffy.db.session import open_session

logger = logger.bind(component="workers.search_removals")

_LOCK_KEY = "search_removal_flush:lock"
_LOCK_TTL_SECONDS = 240
_FLUSH_BATCH = 500

# Meilisearch rejects these synchronously and always will; retrying is
# pointless and poison rows at the front of the created_at-ordered batch
# would starve everything behind them.
_PERMANENT_ERROR_CODES = {
    "invalid_document_filter",
    "missing_document_filter",
    "invalid_document_id",
}

# One day of continuous 5-minute failures; from here every run logs an
# error so a stuck-but-retriable queue surfaces to the operator.
_ATTEMPTS_ALERT_THRESHOLD = 288


async def _acquire_lock() -> bool:
    client = _get_ops_client()
    if client is None:
        return False
    try:
        return bool(await client.set(_LOCK_KEY, "1", ex=_LOCK_TTL_SECONDS, nx=True))
    except Exception:
        logger.warning("search removal flush lock SET NX failed")
        return False


async def _release_lock() -> None:
    client = _get_ops_client()
    if client is None:
        return
    try:
        await client.delete(_LOCK_KEY)
    except Exception:
        logger.warning("search removal flush lock release failed")


async def flush_search_removals(ctx: dict[str, Any]) -> dict[str, Any]:
    """Retry queued removals; delete the row once Meilisearch confirms."""
    if not await _acquire_lock():
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

            client = get_meilisearch_client()
            flushed = 0
            failed = 0
            dropped = 0
            stuck = 0
            for row in rows:
                try:
                    if row.urn:
                        await client.delete_document(row.urn, row.organization_id)
                    elif row.filter_expr:
                        await client.delete_documents_by_filter_expr(row.filter_expr)
                    await session.delete(row)
                    flushed += 1
                except MeilisearchApiError as exc:
                    if exc.code in _PERMANENT_ERROR_CODES:
                        logger.error(
                            f"Dropping unexecutable search removal ({exc.code}): "
                            f"urn={row.urn} filter={row.filter_expr}"
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
                "Meilisearch has been rejecting them - investigate"
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
        await _release_lock()
