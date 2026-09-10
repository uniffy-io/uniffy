"""Serialize draft admission so concurrent requests cannot exceed the review quota."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.agents.skill_draft import OPEN_DRAFT_STATUSES, AgentSkillDraft
from uniffy.core.models.login.organization_member import OrganizationMember

MAX_PENDING_DRAFTS_PER_USER = 25


async def require_draft_capacity(
    session: AsyncSession, user_id: UUID, organization_id: UUID, *, exclude_id: UUID | None = None
) -> None:
    membership = (
        await session.execute(
            select(OrganizationMember.user_id)
            .where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_active.is_(True),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if membership is None:
        raise PermissionDeniedError("create", "Active organization membership is required")

    count = (
        await session.execute(
            select(func.count())
            .select_from(AgentSkillDraft)
            .where(
                AgentSkillDraft.organization_id == organization_id,
                AgentSkillDraft.owner_id == user_id,
                AgentSkillDraft.status.in_(OPEN_DRAFT_STATUSES),
                AgentSkillDraft.is_deleted.is_(False),
                AgentSkillDraft.id != exclude_id if exclude_id is not None else True,
            )
        )
    ).scalar_one()
    if count >= MAX_PENDING_DRAFTS_PER_USER:
        raise ValidationError("drafts", "Review or discard existing drafts before creating another")
