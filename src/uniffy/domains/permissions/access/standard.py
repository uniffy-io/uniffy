from collections import defaultdict
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, literal, or_, select, tuple_, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.defaults import (
    ORG_PERMISSION_DEFAULTS,
    resolve_effective_content_role,
    resolve_effective_policy,
)
from uniffy.core.auth.permissions.roles import ROLE_ORDINAL
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.cron_task import AgentCronTask
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.notes.note import Note
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.permissions.org_permission_defaults import (
    OrganizationPermissionDefaults,
)
from uniffy.core.models.projects.project import Project
from uniffy.core.models.rooms.room import Room
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType
from uniffy.domains.permissions.access.subject import AccessSubject
from uniffy.domains.permissions.access.types import (
    AccessGrantKind,
    RequestTarget,
    ResolvedResourcePolicy,
    ResourceAccessDecision,
    ResourceKey,
    ResourceRowState,
)


@dataclass(frozen=True, slots=True)
class StandardPolicyRow:
    key: ResourceKey
    owner_id: UUID
    access_mode: AccessMode | None
    baseline_role: ContentRole | None
    is_deleted: bool


_DIRECT_MODELS = {
    ContentType.NOTE: (Note, Note.owner_id),
    ContentType.FILE: (File, File.owner_id),
    ContentType.FOLDER: (Folder, Folder.owner_id),
    ContentType.PROJECT: (Project, Project.owner_id),
    ContentType.AGENT: (Agent, Agent.owner_id),
    ContentType.ROOM: (Room, Room.owner_id),
    ContentType.CALENDAR: (Calendar, Calendar.owner_id),
}


async def load_direct_policy_rows(
    session: AsyncSession,
    organization_id: UUID,
    candidates: Mapping[ContentType, Collection[UUID]],
) -> dict[ResourceKey, StandardPolicyRow]:
    branches = []
    for content_type, (model, owner_column) in _DIRECT_MODELS.items():
        content_ids = candidates.get(content_type)
        if not content_ids:
            continue
        branches.append(
            select(
                literal(content_type.value).label("content_type"),
                model.id.label("content_id"),
                owner_column.label("owner_id"),
                model.access_mode.label("access_mode"),
                model.baseline_role.label("baseline_role"),
                model.is_deleted.label("is_deleted"),
            ).where(
                model.organization_id == organization_id,
                model.id.in_(content_ids),
            )
        )
    if not branches:
        return {}
    statement = branches[0] if len(branches) == 1 else union_all(*branches)
    rows = (await session.execute(statement)).all()
    return {
        (key := ResourceKey(ContentType(row.content_type), row.content_id)): StandardPolicyRow(
            key=key,
            owner_id=row.owner_id,
            access_mode=row.access_mode,
            baseline_role=row.baseline_role,
            is_deleted=row.is_deleted,
        )
        for row in rows
    }


async def resolve_standard_rows(
    session: AsyncSession,
    subject: AccessSubject,
    rows: Collection[StandardPolicyRow],
    *,
    requestable: bool = True,
) -> dict[ResourceKey, ResourceAccessDecision]:
    if not rows:
        return {}

    content_types = {row.key.content_type for row in rows}
    defaults_rows = (
        await session.execute(
            select(
                OrganizationPermissionDefaults.content_type,
                OrganizationPermissionDefaults.default_access_mode,
                OrganizationPermissionDefaults.default_baseline_role,
            ).where(
                OrganizationPermissionDefaults.organization_id == subject.organization_id,
                OrganizationPermissionDefaults.content_type.in_(content_types),
            )
        )
    ).all()
    defaults = {
        row.content_type: (row.default_access_mode, row.default_baseline_role)
        for row in defaults_rows
    }

    grant_roles: dict[ResourceKey, list[ContentRole]] = defaultdict(list)
    if subject.is_active_member:
        subject_predicates = [
            and_(
                ContentMember.subject_type == SubjectType.USER,
                ContentMember.subject_id == subject.user_id,
            )
        ]
        if subject.group_ids:
            subject_predicates.append(
                and_(
                    ContentMember.subject_type == SubjectType.GROUP,
                    ContentMember.subject_id.in_(subject.group_ids),
                )
            )
        keys = [(row.key.content_type, row.key.content_id) for row in rows]
        grants = (
            await session.execute(
                select(
                    ContentMember.content_type,
                    ContentMember.content_id,
                    ContentMember.role,
                ).where(
                    ContentMember.organization_id == subject.organization_id,
                    tuple_(ContentMember.content_type, ContentMember.content_id).in_(keys),
                    or_(*subject_predicates),
                    or_(
                        ContentMember.expires_at.is_(None),
                        ContentMember.expires_at > datetime.now(UTC),
                    ),
                )
            )
        ).all()
        for grant in grants:
            grant_roles[ResourceKey(grant.content_type, grant.content_id)].append(grant.role)

    decisions: dict[ResourceKey, ResourceAccessDecision] = {}
    for row in rows:
        if row.is_deleted:
            decisions[row.key] = ResourceAccessDecision(
                key=row.key,
                row_state=ResourceRowState.DELETED,
                can_view=False,
            )
            continue

        role = _effective_standard_role(
            subject,
            row,
            grant_roles.get(row.key, []),
            defaults,
        )
        default_mode, default_baseline = _defaults_for(row.key.content_type, defaults)
        effective_mode, effective_baseline = resolve_effective_policy(
            row.access_mode,
            row.baseline_role,
            default_mode,
            default_baseline,
        )
        target = (
            RequestTarget(row.key.content_type, row.key.content_id, AccessGrantKind.STANDARD)
            if requestable
            else None
        )
        decisions[row.key] = ResourceAccessDecision(
            key=row.key,
            row_state=ResourceRowState.LIVE,
            can_view=role is not None,
            role=role,
            request_target=target,
            target_policy=ResolvedResourcePolicy(
                content_type=row.key.content_type,
                access_mode=effective_mode,
                baseline_role=effective_baseline,
            ),
        )
    return decisions


def _effective_standard_role(
    subject: AccessSubject,
    row: StandardPolicyRow,
    roles: Collection[ContentRole],
    defaults: Mapping[ContentType, tuple[AccessMode, ContentRole | None]],
) -> ContentRole | None:
    default_mode, default_baseline = _defaults_for(row.key.content_type, defaults)
    blocked = ContentRole.BLOCKED in roles
    granted_role = max(
        (role for role in roles if role is not ContentRole.BLOCKED),
        key=lambda role: ROLE_ORDINAL[role],
        default=None,
    )
    return resolve_effective_content_role(
        user_id=subject.user_id,
        owner_id=row.owner_id,
        is_active_member=subject.is_active_member,
        support_role=subject.support_role,
        blocked=blocked,
        granted_role=granted_role,
        raw_access_mode=row.access_mode,
        raw_baseline_role=row.baseline_role,
        org_default_access_mode=default_mode,
        org_default_baseline_role=default_baseline,
    )


def _defaults_for(
    content_type: ContentType,
    defaults: Mapping[ContentType, tuple[AccessMode, ContentRole | None]],
) -> tuple[AccessMode, ContentRole | None]:
    fallback = ORG_PERMISSION_DEFAULTS.get(content_type)
    return defaults.get(
        content_type,
        (
            fallback["default_access_mode"] if fallback else AccessMode.OWNER_ONLY,
            fallback["default_baseline_role"] if fallback else None,
        ),
    )


async def resolve_direct(
    session: AsyncSession,
    subject: AccessSubject,
    candidates: Mapping[ContentType, Collection[UUID]],
) -> dict[ResourceKey, ResourceAccessDecision]:
    rows = await load_direct_policy_rows(session, subject.organization_id, candidates)
    return await resolve_standard_rows(session, subject, rows.values())


async def resolve_cron_tasks(
    session: AsyncSession,
    subject: AccessSubject,
    content_ids: Collection[UUID],
) -> dict[ResourceKey, ResourceAccessDecision]:
    """Cron tasks are ordinary content rows for access, resolved apart from the
    direct set because their policy columns live on their own model."""
    result = await session.execute(
        select(
            AgentCronTask.id,
            AgentCronTask.owner_id,
            AgentCronTask.access_mode,
            AgentCronTask.baseline_role,
            AgentCronTask.is_deleted,
        ).where(
            AgentCronTask.organization_id == subject.organization_id,
            AgentCronTask.id.in_(content_ids),
        )
    )
    rows = [
        StandardPolicyRow(
            key=ResourceKey(ContentType.AGENT_CRON_TASK, row.id),
            owner_id=row.owner_id,
            access_mode=row.access_mode,
            baseline_role=row.baseline_role,
            is_deleted=row.is_deleted,
        )
        for row in result.all()
    ]
    return await resolve_standard_rows(session, subject, rows)


DIRECT_CONTENT_TYPES = frozenset(_DIRECT_MODELS)
