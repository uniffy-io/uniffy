"""Refresh task search ACL snapshots from durable project queue rows."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, or_, select, update

from uniffy.core.auth.permissions.defaults import (
    resolve_content_defaults,
    resolve_effective_policy,
)
from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.search_acl_refresh import ProjectSearchAclRefresh
from uniffy.core.search.meilisearch import get_meilisearch_client
from uniffy.core.types import ContentRole, ContentType, SubjectType
from uniffy.core.valkey.ops import _get_ops_client
from uniffy.db import open_session
from uniffy.domains.projects.jobs.contracts import REFRESH_PROJECT_SEARCH_ACL
from uniffy.vendor.arq import Retry

logger = logger.bind(component="projects.jobs.search_acl")

_LOCK_TTL_SECONDS = 330
_FLUSH_BATCH = 100
_ATTEMPTS_ALERT_THRESHOLD = 60


def _lock_key(project_id: UUID) -> str:
    return f"project_search_acl:{project_id}:lock"


async def _acquire_lock(project_id: UUID) -> str | None:
    client = _get_ops_client()
    if client is None:
        return None
    try:
        return await acquire_owned_job_lock(
            client,
            _lock_key(project_id),
            _LOCK_TTL_SECONDS,
        )
    except Exception:
        logger.warning(f"Project search ACL lock failed for project {project_id}")
        return None


async def _release_lock(project_id: UUID, token: str) -> None:
    client = _get_ops_client()
    if client is None:
        return
    try:
        await release_owned_job_lock(client, _lock_key(project_id), token)
    except Exception:
        logger.warning(f"Project search ACL lock release failed for project {project_id}")


async def _record_failure(project_id: UUID, version: int) -> None:
    async with open_session() as session:
        await session.execute(
            update(ProjectSearchAclRefresh)
            .where(
                ProjectSearchAclRefresh.project_id == project_id,
                ProjectSearchAclRefresh.version == version,
            )
            .values(attempts=ProjectSearchAclRefresh.attempts + 1)
        )
        await session.commit()


async def _process_project(project_id: UUID) -> dict[str, Any]:
    async with open_session() as session:
        row = (
            await session.execute(
                select(ProjectSearchAclRefresh).where(
                    ProjectSearchAclRefresh.project_id == project_id
                )
            )
        ).scalar_one_or_none()
        if row is None:
            return {"status": "empty"}

        version = row.version
        project = (
            await session.execute(
                select(Project).where(
                    Project.id == project_id,
                    Project.organization_id == row.organization_id,
                    Project.is_deleted == False,  # noqa: E712
                )
            )
        ).scalar_one_or_none()
        if project is None:
            await session.execute(
                delete(ProjectSearchAclRefresh).where(
                    ProjectSearchAclRefresh.project_id == project_id,
                    ProjectSearchAclRefresh.version == version,
                )
            )
            await session.commit()
            return {"status": "deleted"}

        now = datetime.now(UTC)
        member_rows = (
            await session.execute(
                select(
                    ContentMember.subject_type,
                    ContentMember.subject_id,
                    ContentMember.role,
                ).where(
                    ContentMember.organization_id == row.organization_id,
                    ContentMember.content_type == ContentType.PROJECT,
                    ContentMember.content_id == project_id,
                    or_(ContentMember.expires_at.is_(None), ContentMember.expires_at > now),
                )
            )
        ).all()
        shared_users: list[UUID] = []
        shared_groups: list[UUID] = []
        blocked_users: list[UUID] = []
        blocked_groups: list[UUID] = []
        for subject_type, subject_id, role in member_rows:
            if subject_type == SubjectType.USER:
                (blocked_users if role == ContentRole.BLOCKED else shared_users).append(subject_id)
            elif subject_type == SubjectType.GROUP:
                (blocked_groups if role == ContentRole.BLOCKED else shared_groups).append(subject_id)

        default_mode, default_baseline = await resolve_content_defaults(
            session,
            row.organization_id,
            ContentType.PROJECT,
        )
        effective_mode, effective_baseline = resolve_effective_policy(
            project.access_mode,
            project.baseline_role,
            default_mode,
            default_baseline,
        )

        try:
            updated = await get_meilisearch_client().update_task_sharing(
                organization_id=row.organization_id,
                project_id=project_id,
                owner_id=project.owner_id,
                access_mode=effective_mode.value,
                baseline_role=(effective_baseline.value if effective_baseline is not None else None),
                shared_user_ids=shared_users,
                shared_group_ids=shared_groups,
                blocked_user_ids=blocked_users,
                blocked_group_ids=blocked_groups,
            )
        except Exception:
            await session.rollback()
            await _record_failure(project_id, version)
            raise

        deleted = await session.execute(
            delete(ProjectSearchAclRefresh).where(
                ProjectSearchAclRefresh.project_id == project_id,
                ProjectSearchAclRefresh.version == version,
            )
        )
        await session.commit()
        if not deleted.rowcount:
            return {"status": "superseded", "updated": updated}
        return {"status": "complete", "updated": updated}


async def refresh_project_search_acl(
    ctx: dict[str, Any],
    project_id: str,
) -> dict[str, Any]:
    parsed_project_id = UUID(project_id)
    lock_token = await _acquire_lock(parsed_project_id)
    if lock_token is None:
        return {"status": "locked"}
    try:
        return await _process_project(parsed_project_id)
    except Exception as exc:
        logger.opt(exception=True).warning(
            f"Project search ACL refresh failed for project {parsed_project_id}"
        )
        raise Retry(defer=max(10, ctx.get("job_try", 1) * 10)) from exc
    finally:
        await _release_lock(parsed_project_id, lock_token)


async def flush_project_search_acl_refreshes(ctx: dict[str, Any]) -> dict[str, Any]:
    async with open_session() as session:
        rows = (
            await session.execute(
                select(ProjectSearchAclRefresh.project_id, ProjectSearchAclRefresh.attempts)
                .order_by(ProjectSearchAclRefresh.created_at)
                .limit(_FLUSH_BATCH)
            )
        ).all()

    queue = ctx.get("valkey")
    if queue is None:
        return {"status": "skipped", "reason": "queue_unavailable"}

    enqueued = 0
    failed = 0
    stuck = sum(1 for _project_id, attempts in rows if attempts >= _ATTEMPTS_ALERT_THRESHOLD)
    for queued_project_id, _attempts in rows:
        try:
            await queue.enqueue_job(
                REFRESH_PROJECT_SEARCH_ACL.name,
                str(queued_project_id),
            )
            enqueued += 1
        except Exception:
            failed += 1

    if stuck:
        logger.error(f"Project search ACL refresh has {stuck} persistently failing rows")
    return {"status": "complete", "enqueued": enqueued, "failed": failed}
