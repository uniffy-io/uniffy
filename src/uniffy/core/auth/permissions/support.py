from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.support_session import (
    ActiveSupportSession,
    active_support_session_var,
)
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.platform.support_session import (
    SupportSession,
    SupportSessionScope,
    SupportSessionState,
)


@dataclass(frozen=True, slots=True)
class SupportAccess:
    session_id: UUID
    scope: SupportSessionScope


async def get_active_support_access(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
) -> SupportAccess | None:
    active_membership = exists(
        select(OrganizationMember.id).where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.is_active.is_(True),
        )
    )
    row = (
        await session.execute(
            select(SupportSession.id, SupportSession.scope)
            .join(User, User.id == SupportSession.support_user_id)
            .join(Organization, Organization.id == SupportSession.organization_id)
            .where(
                SupportSession.support_user_id == user_id,
                SupportSession.organization_id == organization_id,
                SupportSession.state == SupportSessionState.ACTIVE,
                SupportSession.expires_at > datetime.now(UTC),
                User.is_active.is_(True),
                User.is_system_admin.is_(True),
                Organization.deleted_at.is_(None),
                Organization.is_suspended.is_(False),
                ~active_membership,
            )
            .order_by(SupportSession.granted_at.desc())
            .limit(1)
        )
    ).one_or_none()
    if row is None:
        return None
    access = SupportAccess(session_id=row.id, scope=row.scope)
    active_support_session_var.set(
        ActiveSupportSession(
            session_id=access.session_id,
            organization_id=organization_id,
            support_user_id=user_id,
            scope=access.scope.value,
        )
    )
    return access
