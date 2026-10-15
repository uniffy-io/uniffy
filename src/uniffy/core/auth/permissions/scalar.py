from collections.abc import Collection
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import (
    DateTime,
    Row,
    Select,
    Uuid,
    and_,
    bindparam,
    case,
    exists,
    func,
    or_,
    select,
    true,
)
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.roles import ROLE_ORDINAL
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.permissions.org_permission_defaults import (
    OrganizationPermissionDefaults,
)
from uniffy.core.models.platform.support_session import (
    SupportSession,
    SupportSessionScope,
    SupportSessionState,
)
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType

_ROLE_BY_ORDINAL = {ordinal: role for role, ordinal in ROLE_ORDINAL.items()}


@dataclass(frozen=True, slots=True)
class ScalarAuthorizationFacts:
    is_active_user: bool
    is_system_admin: bool
    organization_role: OrganizationRole | None
    support_session_id: UUID | None
    support_scope: SupportSessionScope | None
    default_access_mode: AccessMode | None
    default_baseline_role: ContentRole | None
    blocked: bool
    granted_role: ContentRole | None


def _authorization_statement(*, audience: bool) -> Select:
    user_id = User.id if audience else bindparam("actor_id", type_=Uuid())
    organization_id = bindparam("organization_id", type_=Uuid())
    content_id = bindparam("content_id", type_=Uuid())
    content_type = bindparam("content_type")
    now = bindparam("checked_at", type_=DateTime(timezone=True))
    organization_is_active = exists(
        select(Organization.id).where(
            Organization.id == organization_id,
            Organization.deleted_at.is_(None),
            Organization.is_suspended.is_(False),
        )
    )
    membership_role = (
        select(OrganizationMember.role)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.is_active.is_(True),
            Organization.deleted_at.is_(None),
            Organization.is_suspended.is_(False),
        )
        .limit(1)
        .correlate(User)
        .scalar_subquery()
    )
    support = (
        select(SupportSession.id, SupportSession.scope)
        .where(
            SupportSession.support_user_id == user_id,
            SupportSession.organization_id == organization_id,
            SupportSession.state == SupportSessionState.ACTIVE,
            SupportSession.expires_at > now,
            organization_is_active,
        )
        .order_by(SupportSession.granted_at.desc())
        .limit(1)
        .correlate(User)
        .lateral("active_support")
    )
    defaults = (
        select(
            OrganizationPermissionDefaults.default_access_mode,
            OrganizationPermissionDefaults.default_baseline_role,
        )
        .where(
            OrganizationPermissionDefaults.organization_id == organization_id,
            OrganizationPermissionDefaults.content_type == content_type,
        )
        .limit(1)
        .lateral("permission_defaults")
    )
    group_ids = (
        select(GroupMember.group_id)
        .join(Group, Group.id == GroupMember.group_id)
        .where(
            GroupMember.user_id == user_id,
            GroupMember.is_active.is_(True),
            Group.organization_id == organization_id,
        )
        .correlate(User)
    )
    subject_match = or_(
        and_(
            ContentMember.subject_type == SubjectType.USER,
            ContentMember.subject_id == user_id,
        ),
        and_(
            ContentMember.subject_type == SubjectType.GROUP,
            ContentMember.subject_id.in_(group_ids),
        ),
    )
    role_rank = case(
        *(
            (ContentMember.role == role, ordinal)
            for role, ordinal in ROLE_ORDINAL.items()
            if role != ContentRole.BLOCKED
        ),
        else_=None,
    )
    grants = (
        select(
            func.bool_or(ContentMember.role == ContentRole.BLOCKED).label("blocked"),
            func.max(role_rank).label("role_rank"),
        )
        .where(
            ContentMember.organization_id == organization_id,
            ContentMember.content_type == content_type,
            ContentMember.content_id == content_id,
            subject_match,
            or_(
                ContentMember.expires_at.is_(None),
                ContentMember.expires_at > now,
            ),
        )
        .correlate(User)
        .lateral("applicable_grants")
    )
    return (
        select(
            User.id.label("user_id"),
            User.is_active,
            User.is_system_admin,
            membership_role.label("organization_role"),
            support.c.id.label("support_session_id"),
            support.c.scope.label("support_scope"),
            defaults.c.default_access_mode,
            defaults.c.default_baseline_role,
            grants.c.blocked,
            grants.c.role_rank,
        )
        .select_from(User)
        .outerjoin(support, true())
        .outerjoin(defaults, true())
        .join(grants, true())
        .where(
            User.id.in_(bindparam("actor_ids", expanding=True, type_=Uuid()))
            if audience
            else User.id == user_id
        )
    )


_SCALAR_STATEMENT = _authorization_statement(audience=False)
_AUDIENCE_STATEMENT = _authorization_statement(audience=True)
MAX_AUTHORIZATION_ACTORS = 256


async def load_scalar_authorization_facts(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
) -> ScalarAuthorizationFacts | None:
    row = (
        await session.execute(
            _SCALAR_STATEMENT,
            {
                "actor_id": user_id,
                "organization_id": organization_id,
                "content_type": content_type,
                "content_id": content_id,
                "checked_at": datetime.now(UTC),
            },
        )
    ).one_or_none()
    return _facts(row) if row is not None else None


async def load_audience_authorization_facts(
    session: AsyncSession,
    *,
    user_ids: Collection[UUID],
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
) -> dict[UUID, ScalarAuthorizationFacts]:
    actors = tuple(dict.fromkeys(user_ids))
    if len(actors) > MAX_AUTHORIZATION_ACTORS:
        raise ValueError("Authorization audience exceeds batch limit")
    if not actors:
        return {}
    rows = (
        await session.execute(
            _AUDIENCE_STATEMENT,
            {
                "actor_ids": actors,
                "organization_id": organization_id,
                "content_type": content_type,
                "content_id": content_id,
                "checked_at": datetime.now(UTC),
            },
        )
    ).all()
    return {row.user_id: _facts(row) for row in rows}


def _facts(row: Row) -> ScalarAuthorizationFacts:
    return ScalarAuthorizationFacts(
        is_active_user=row.is_active,
        is_system_admin=row.is_system_admin,
        organization_role=row.organization_role,
        support_session_id=row.support_session_id,
        support_scope=row.support_scope,
        default_access_mode=row.default_access_mode,
        default_baseline_role=row.default_baseline_role,
        blocked=bool(row.blocked),
        granted_role=_ROLE_BY_ORDINAL.get(row.role_rank),
    )
