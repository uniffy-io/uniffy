"""Reindex inheriting content after organization permission-default changes."""

from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, or_, select

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.defaults import resolve_effective_policy
from uniffy.core.jobs import enqueue_job
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.project import Project
from uniffy.core.models.rooms.room import Room
from uniffy.core.search.indexer import SEARCH_INDEXER_CTX_KEY, build_content_urn
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.domains.permissions.jobs.contracts import REINDEX_ORG_CONTENT_FOR_DEFAULTS
from uniffy.domains.projects.search.access import (
    enqueue_project_search_acl_refresh,
    record_project_search_acl_refresh,
)
from uniffy.domains.scheduling.calendar.operations import (
    enqueue_calendar_search_acl_refresh,
    record_calendar_search_acl_refresh,
)
from uniffy.infrastructure.database import open_session
from uniffy.vendor.arq import Retry

logger = logger.bind(component="permissions.jobs.jobs")

_BATCH_SIZE = 500

# Content types whose rows can inherit the org defaults and carry them into search.
_MODELS: dict[ContentType, type] = {
    ContentType.NOTE: Note,
    ContentType.FILE: File,
    ContentType.FOLDER: Folder,
    ContentType.PROJECT: Project,
    ContentType.CALENDAR_EVENT: CalendarEvent,
    ContentType.CALENDAR: Calendar,
    ContentType.AGENT: Agent,
    ContentType.ROOM: Room,
}


async def reindex_org_content_for_defaults(
    ctx: dict[str, Any],
    organization_id: str,
    content_type_value: str,
    after_id: str | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    org_id = UUID(organization_id)
    try:
        content_type = ContentType(content_type_value)
    except ValueError:
        return {"status": "skipped", "reason": f"unknown content type {content_type_value}"}

    model_cls = _model_for(content_type)
    if model_cls is None:
        return {"status": "skipped", "reason": "no_indexer_for_type"}
    search_indexer = ctx[SEARCH_INDEXER_CTX_KEY]

    cursor = UUID(after_id) if after_id else None
    project_refresh_ids: list[UUID] = []
    calendar_refresh_ids: list[UUID] = []
    async with open_session() as session:
        rows = list(
            (await session.execute(_keyset_query(model_cls, org_id, cursor))).scalars().all()
        )
        if not rows:
            return {"status": "complete", "processed": 0, "succeeded": 0, "failed": 0}

        default_mode, default_baseline = await PermissionChecker(session).get_org_defaults(
            org_id,
            content_type,
        )

        items: list[tuple[str, AccessMode, ContentRole | None]] = []
        for row in rows:
            mode, baseline = resolve_effective_policy(
                row.access_mode,
                row.baseline_role,
                default_mode,
                default_baseline,
            )
            items.append((build_content_urn(content_type, row.id), mode, baseline))
            if content_type == ContentType.PROJECT:
                await record_project_search_acl_refresh(session, org_id, row.id)
                project_refresh_ids.append(row.id)
            elif content_type == ContentType.CALENDAR:
                # Its events carry the calendar's audience as search hints.
                await record_calendar_search_acl_refresh(session, org_id, row.id)
                calendar_refresh_ids.append(row.id)

        try:
            await search_indexer.update_access_policy_bulk(org_id, items)
        except Exception:
            await session.rollback()
            logger.opt(exception=True).warning(
                f"Default-policy reindex page failed for {content_type.value} org={org_id}"
            )
            raise Retry(defer=max(10, ctx.get("job_try", 1) * 10)) from None
        await session.commit()

    for project_id in project_refresh_ids:
        await enqueue_project_search_acl_refresh(project_id)
    for calendar_id in calendar_refresh_ids:
        await enqueue_calendar_search_acl_refresh(calendar_id)

    has_more = len(rows) == _BATCH_SIZE
    if has_more:
        next_cursor = rows[-1].id
        chain_id = run_id or str(ctx.get("job_id", "unversioned"))
        try:
            await enqueue_job(
                REINDEX_ORG_CONTENT_FOR_DEFAULTS,
                organization_id,
                content_type_value,
                str(next_cursor),
                chain_id,
                _job_id=(
                    f"reindex_defaults_page:{organization_id}:{content_type_value}:"
                    f"{chain_id}:{next_cursor}"
                ),
            )
        except Exception:
            logger.opt(exception=True).warning("Failed to enqueue the next defaults-reindex page")
            raise Retry(defer=max(10, ctx.get("job_try", 1) * 10))

    logger.info(
        f"Default-policy reindex page org={org_id} type={content_type.value} "
        f"processed={len(rows)} has_more={has_more}"
    )
    return {
        "status": "queued" if has_more else "complete",
        "processed": len(rows),
        "succeeded": len(rows),
        "failed": 0,
    }


def _keyset_query(model_cls: Any, organization_id: UUID, after_id: UUID | None):
    predicates = [
        model_cls.organization_id == organization_id,
        model_cls.is_deleted == False,  # noqa: E712
        # Rows carrying an explicit mode (and an explicit baseline when open)
        # resolve identically before and after a defaults change.
        or_(
            model_cls.access_mode.is_(None),
            and_(
                model_cls.access_mode == AccessMode.OPEN_TO_ORG,
                model_cls.baseline_role.is_(None),
            ),
        ),
    ]
    if after_id is not None:
        predicates.append(model_cls.id > after_id)
    return select(model_cls).where(*predicates).order_by(model_cls.id).limit(_BATCH_SIZE)


def _model_for(content_type: ContentType) -> type | None:
    return _MODELS.get(content_type)
