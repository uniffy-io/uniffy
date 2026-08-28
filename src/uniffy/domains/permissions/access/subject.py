from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.support import get_active_support_access
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.models.platform.support_session import SupportSessionScope
from uniffy.core.types import ContentRole, DomainType


@dataclass(frozen=True, slots=True)
class AccessSubject:
    user_id: UUID
    organization_id: UUID
    is_active_user: bool
    organization_role: OrganizationRole | None
    group_ids: frozenset[UUID]
    chat_domain_admin: bool
    support_role: ContentRole | None

    @property
    def is_active_member(self) -> bool:
        return self.is_active_user and self.organization_role is not None

    @property
    def is_chat_moderator(self) -> bool:
        return (
            self.organization_role
            in (
                OrganizationRole.OWNER,
                OrganizationRole.ADMIN,
            )
            or self.chat_domain_admin
        )


async def load_access_subject(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> AccessSubject:
    actor = (
        await session.execute(
            select(
                User.is_active,
                User.is_system_admin,
                OrganizationMember.role,
                Organization.id.label("organization_id"),
            )
            .outerjoin(
                OrganizationMember,
                and_(
                    OrganizationMember.user_id == User.id,
                    OrganizationMember.organization_id == organization_id,
                    OrganizationMember.is_active.is_(True),
                ),
            )
            .outerjoin(
                Organization,
                and_(
                    Organization.id == organization_id,
                    Organization.deleted_at.is_(None),
                    Organization.is_suspended.is_(False),
                ),
            )
            .where(User.id == user_id)
        )
    ).one_or_none()

    if actor is None:
        return AccessSubject(
            user_id=user_id,
            organization_id=organization_id,
            is_active_user=False,
            organization_role=None,
            group_ids=frozenset(),
            chat_domain_admin=False,
            support_role=None,
        )

    is_active_user, is_system_admin, organization_role, active_organization_id = actor
    if active_organization_id is None:
        organization_role = None

    group_ids: frozenset[UUID] = frozenset()
    chat_domain_admin = False
    if is_active_user and organization_role is not None:
        group_ids = frozenset(
            (
                await session.execute(
                    select(GroupMember.group_id)
                    .join(Group, Group.id == GroupMember.group_id)
                    .where(
                        GroupMember.user_id == user_id,
                        GroupMember.is_active.is_(True),
                        Group.organization_id == organization_id,
                    )
                )
            ).scalars()
        )
        chat_domain_admin = (
            await session.execute(
                select(DomainAdmin.id).where(
                    DomainAdmin.user_id == user_id,
                    DomainAdmin.organization_id == organization_id,
                    DomainAdmin.domain == DomainType.CHAT,
                )
            )
        ).scalar_one_or_none() is not None

    support_role = None
    if (
        is_active_user
        and is_system_admin
        and organization_role is None
        and active_organization_id is not None
    ):
        support_access = await get_active_support_access(session, user_id, organization_id)
        if support_access is not None:
            support_role = (
                ContentRole.EDITOR
                if support_access.scope == SupportSessionScope.READ_WRITE
                else ContentRole.VIEWER
            )

    return AccessSubject(
        user_id=user_id,
        organization_id=organization_id,
        is_active_user=bool(is_active_user),
        organization_role=organization_role,
        group_ids=group_ids,
        chat_domain_admin=chat_domain_admin,
        support_role=support_role,
    )
