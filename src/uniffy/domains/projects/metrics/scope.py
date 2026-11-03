"""Resolves a dashboard widget's relative scope for whoever is viewing it."""

from dataclasses import dataclass
from datetime import UTC, date, datetime
from enum import StrEnum
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import ColumnElement, and_, any_, bindparam, or_, select
from sqlalchemy.dialects.postgresql import ARRAY, array
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.errors import ValidationError
from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint, SprintStatus
from uniffy.core.models.projects.task import Task
from uniffy.core.types import ContentRole, ContentType, SubjectType


class ProjectScope(StrEnum):
    ALL = "all"
    MY_PROJECTS = "my_projects"
    SELECTED = "selected"


class PeopleScope(StrEnum):
    EVERYONE = "everyone"
    ME = "me"
    MY_TEAMS = "my_teams"


class SprintScope(StrEnum):
    ANY = "any"
    ACTIVE = "active"


MAX_SELECTED_PROJECTS = 100
_UUIDS = ARRAY(PG_UUID(as_uuid=True))


@dataclass(frozen=True)
class MetricScope:
    projects: ProjectScope = ProjectScope.ALL
    project_ids: tuple[UUID, ...] = ()
    people: PeopleScope = PeopleScope.EVERYONE
    sprint: SprintScope = SprintScope.ANY


@dataclass(frozen=True)
class ResolvedScope:
    """One viewer's readable, in-scope projects and task predicates.

    ``people`` is None when every assignee counts.
    """

    organization_id: UUID
    project_ids: tuple[UUID, ...]
    task_predicates: tuple[ColumnElement[bool], ...]
    people: frozenset[str] | None
    today: date
    zone: ZoneInfo

    @property
    def today_key(self) -> str:
        return self.today.isoformat()


def resolve_zone(name: str) -> ZoneInfo:
    if not name:
        return ZoneInfo("UTC")
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValidationError("time_zone", f"Unknown time zone {name!r}") from exc


async def _team_member_ids(session: AsyncSession, user_id: UUID, organization_id: UUID) -> set[str]:
    my_teams = (
        select(GroupMember.group_id)
        .join(Group, Group.id == GroupMember.group_id)
        .where(
            GroupMember.user_id == user_id,
            GroupMember.is_active.is_(True),
            Group.organization_id == organization_id,
            Group.kind == GroupKind.TEAM,
        )
    )
    result = await session.execute(
        select(GroupMember.user_id)
        .where(GroupMember.group_id.in_(my_teams), GroupMember.is_active.is_(True))
        .distinct()
    )
    return {str(member) for member in result.scalars().all()} | {str(user_id)}


def _member_of_project(user_id: UUID, organization_id: UUID) -> ColumnElement[bool]:
    """Owner or a live, non-blocked member grant, directly or through a group."""
    now = datetime.now(UTC)
    groups = (
        select(GroupMember.group_id)
        .join(Group, Group.id == GroupMember.group_id)
        .where(
            GroupMember.user_id == user_id,
            GroupMember.is_active.is_(True),
            Group.organization_id == organization_id,
        )
    )
    granted = select(ContentMember.content_id).where(
        ContentMember.organization_id == organization_id,
        ContentMember.content_type == ContentType.PROJECT,
        ContentMember.role != ContentRole.BLOCKED,
        or_(ContentMember.expires_at.is_(None), ContentMember.expires_at > now),
        or_(
            and_(
                ContentMember.subject_type == SubjectType.USER,
                ContentMember.subject_id == user_id,
            ),
            and_(
                ContentMember.subject_type == SubjectType.GROUP,
                ContentMember.subject_id.in_(groups),
            ),
        ),
    )
    return or_(Project.owner_id == user_id, Project.id.in_(granted))


async def resolve_scope(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    scope: MetricScope,
    time_zone: str = "",
) -> ResolvedScope:
    zone = resolve_zone(time_zone)
    readable = await ContentAccessQuery(session).build_accessible_filter(
        user_id=user_id,
        organization_id=organization_id,
        content_type=ContentType.PROJECT,
        content_id_column=Project.id,
        owner_id_column=Project.owner_id,
        access_mode_column=Project.access_mode,
        baseline_role_column=Project.baseline_role,
    )
    projects: list[ColumnElement[bool]] = [
        Project.organization_id == organization_id,
        Project.is_deleted == False,  # noqa: E712
        readable,
    ]
    if scope.projects is ProjectScope.MY_PROJECTS:
        projects.append(_member_of_project(user_id, organization_id))
    elif scope.projects is ProjectScope.SELECTED:
        if len(scope.project_ids) > MAX_SELECTED_PROJECTS:
            raise ValidationError("project_ids", f"At most {MAX_SELECTED_PROJECTS} projects")
        projects.append(Project.id.in_(scope.project_ids))

    # Resolved up front: the access predicate is per project, and joining it into every task
    # aggregate leaves the planner guessing at its selectivity across the whole organization.
    project_ids = tuple((await session.execute(select(Project.id).where(*projects))).scalars())
    tasks: list[ColumnElement[bool]] = [
        Task.organization_id == organization_id,
        Task.project_id == any_(bindparam("scoped_project_ids", list(project_ids), type_=_UUIDS)),
        Task.is_deleted == False,  # noqa: E712
    ]
    people: frozenset[str] | None = None
    if scope.people is PeopleScope.ME:
        people = frozenset({str(user_id)})
        tasks.append(Task.assignee_ids.contains([str(user_id)]))
    elif scope.people is PeopleScope.MY_TEAMS:
        people = frozenset(await _team_member_ids(session, user_id, organization_id))
        tasks.append(Task.assignee_ids.has_any(array(sorted(people))))
    if scope.sprint is SprintScope.ACTIVE:
        tasks.append(
            Task.sprint_id.in_(select(Sprint.id).where(Sprint.status == SprintStatus.ACTIVE))
        )

    return ResolvedScope(
        organization_id=organization_id,
        project_ids=project_ids,
        task_predicates=tuple(tasks),
        people=people,
        today=datetime.now(zone).date(),
        zone=zone,
    )
