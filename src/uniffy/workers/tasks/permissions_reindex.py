"""Reindex content when an org's permission defaults change.

Meilisearch stores the resolved policy per document; inheriting rows
(`access_mode IS NULL`) flip their effective policy and must be rewritten or
the search ACL drifts. Bursts of defaults toggles coalesce via ARQ `_job_id`.
"""

from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.types import ContentType
from uniffy.db import open_session

LOGGER_COMPONENT = "permissions.reindex"

_BATCH_SIZE = 500


async def reindex_org_content_for_defaults(
    ctx: dict[str, Any],
    organization_id: str,
    content_type_value: str,
) -> dict[str, Any]:
    """Reindex every row of `content_type_value` in the org."""
    org_id = UUID(organization_id)
    try:
        content_type = ContentType(content_type_value)
    except ValueError:
        return {"status": "skipped", "reason": f"unknown content type {content_type_value}"}

    processed = 0
    async with open_session() as session:
        ops_cls, query_factory = _domain_for(content_type)
        if ops_cls is None:
            return {"status": "skipped", "reason": "no_indexer_for_type"}

        ops = ops_cls(session)
        query = query_factory(org_id)
        result = await session.execute(query)
        rows = list(result.scalars().all())

        for start in range(0, len(rows), _BATCH_SIZE):
            batch = rows[start : start + _BATCH_SIZE]
            for row in batch:
                try:
                    await ops._index_for_search(row)
                except Exception:
                    logger.warning(
                        f"reindex_org_content_for_defaults: failed for "
                        f"{content_type.value} {getattr(row, 'id', '?')}",
                        component=LOGGER_COMPONENT,
                    )
                processed += 1

        await session.commit()

    logger.info(
        f"reindex_org_content_for_defaults org={org_id} ct={content_type.value} "
        f"processed={processed}",
        component=LOGGER_COMPONENT,
    )
    return {"status": "complete", "processed": processed}


def _domain_for(content_type: ContentType):
    """Return `(operations_cls, query_factory)` for a content type, or `(None, None)`."""
    from sqlalchemy import select

    if content_type == ContentType.NOTE:
        from uniffy.core.models.notes.note import Note
        from uniffy.domains.notes.operations import NoteOperations

        return (
            NoteOperations,
            lambda org_id: select(Note).where(
                Note.organization_id == org_id,
                Note.is_deleted == False,  # noqa: E712
            ),
        )

    if content_type == ContentType.FILE:
        from uniffy.core.models.files.file import File
        from uniffy.domains.files.operations import FileOperations

        return (
            FileOperations,
            lambda org_id: select(File).where(
                File.organization_id == org_id,
                File.is_deleted == False,  # noqa: E712
            ),
        )

    if content_type == ContentType.PROJECT:
        from uniffy.core.models.projects.project import Project
        from uniffy.domains.projects.operations import ProjectOperations

        return (
            ProjectOperations,
            lambda org_id: select(Project).where(
                Project.organization_id == org_id,
                Project.is_deleted == False,  # noqa: E712
            ),
        )

    if content_type == ContentType.CALENDAR_EVENT:
        from uniffy.core.models.calendar.event import CalendarEvent
        from uniffy.domains.calendar.operations import CalendarEventOperations

        return (
            CalendarEventOperations,
            lambda org_id: select(CalendarEvent).where(
                CalendarEvent.organization_id == org_id,
                CalendarEvent.is_deleted == False,  # noqa: E712
            ),
        )

    if content_type == ContentType.AGENT:
        from uniffy.core.models.agents.agent import Agent
        from uniffy.domains.agents.agents.operations import AgentOperations

        return (
            AgentOperations,
            lambda org_id: select(Agent).where(
                Agent.organization_id == org_id,
                Agent.is_deleted == False,  # noqa: E712
            ),
        )

    return (None, None)
