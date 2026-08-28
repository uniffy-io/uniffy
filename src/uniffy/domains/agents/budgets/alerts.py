"""Budget alert threshold detection and notification fanout."""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.models.agents.budget import AgentBudget
from uniffy.core.models.agents.budget_alert import (
    AgentBudgetAlert,
    AgentBudgetAlertKind,
    AgentBudgetAlertScope,
)
from uniffy.core.models.agents.run_log import AgentRunLog
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.types import DomainType, NotificationType
from uniffy.domains.agents.budgets.period import month_window

logger = logger.bind(component="agents.budgets.alerts")

IMAGE_ALERT_THRESHOLDS: tuple[int, ...] = (90, 100)


def _compute_crossings(
    prev_total: Decimal,
    curr_total: Decimal,
    cap: Decimal,
    thresholds: list[int],
) -> list[int]:
    """Return thresholds crossed by this run, excluding thresholds passed earlier."""
    if cap <= 0:
        return []
    fire: list[int] = []
    prev_pct = (prev_total * Decimal(100)) / cap
    curr_pct = (curr_total * Decimal(100)) / cap
    for threshold in thresholds:
        if prev_pct < Decimal(threshold) <= curr_pct:
            fire.append(threshold)
    return fire


async def _sum_cost(
    session: AsyncSession,
    *,
    organization_id: UUID,
    period_start: datetime,
    period_end: datetime,
) -> Decimal:
    result = await session.execute(
        select(func.coalesce(func.sum(AgentRunLog.cost), 0)).where(
            AgentRunLog.organization_id == organization_id,
            AgentRunLog.created_at >= period_start,
            AgentRunLog.created_at < period_end,
        )
    )
    return Decimal(result.scalar() or 0)


async def _sum_image_count(
    session: AsyncSession,
    *,
    organization_id: UUID,
    period_start: datetime,
    period_end: datetime,
) -> int:
    result = await session.execute(
        select(func.coalesce(func.sum(AgentRunLog.image_count), 0)).where(
            AgentRunLog.organization_id == organization_id,
            AgentRunLog.created_at >= period_start,
            AgentRunLog.created_at < period_end,
        )
    )
    return int(result.scalar() or 0)


async def _resolve_recipients(
    session: AsyncSession,
    organization_id: UUID,
) -> list[UUID]:
    members = await session.execute(
        select(OrganizationMember.user_id)
        .join(User, User.id == OrganizationMember.user_id)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.is_active.is_(True),
            OrganizationMember.role.in_((OrganizationRole.ADMIN, OrganizationRole.OWNER)),
            User.is_active.is_(True),
            Organization.deleted_at.is_(None),
            Organization.is_suspended.is_(False),
        )
    )
    recipients: set[UUID] = set(members.scalars().all())

    domain_admins = await session.execute(
        select(DomainAdmin.user_id)
        .join(
            OrganizationMember,
            (OrganizationMember.user_id == DomainAdmin.user_id)
            & (OrganizationMember.organization_id == DomainAdmin.organization_id),
        )
        .join(User, User.id == OrganizationMember.user_id)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.is_active.is_(True),
            DomainAdmin.organization_id == organization_id,
            DomainAdmin.domain == DomainType.AGENTS,
            User.is_active.is_(True),
            Organization.deleted_at.is_(None),
            Organization.is_suspended.is_(False),
        )
    )
    recipients.update(domain_admins.scalars().all())
    return list(recipients)


async def _try_claim_alert(
    session: AsyncSession,
    *,
    scope: AgentBudgetAlertScope,
    organization_id: UUID,
    user_id: UUID | None,
    period_start: datetime,
    threshold: int,
    kind: AgentBudgetAlertKind,
) -> bool:
    """Use a savepoint so a concurrent dedupe conflict leaves the outer transaction usable."""
    try:
        async with session.begin_nested():
            session.add(
                AgentBudgetAlert(
                    scope=scope,
                    organization_id=organization_id,
                    user_id=user_id,
                    period_start=period_start.date(),
                    threshold=threshold,
                    kind=kind,
                )
            )
            await session.flush()
        return True
    except IntegrityError:
        return False


def _render_alert(
    *,
    scope: AgentBudgetAlertScope,
    kind: AgentBudgetAlertKind,
    threshold: int,
    current: str,
    limit: str,
    period_start: datetime,
) -> tuple[str, str]:
    scope_label = "Organization" if scope is AgentBudgetAlertScope.ORGANIZATION else "User"
    if kind is AgentBudgetAlertKind.SPEND:
        unit = "USD"
        title = f"{scope_label} spend at {threshold}% of budget"
    else:
        unit = "images"
        title = f"{scope_label} image quota at {threshold}%"
    body = (
        f"{scope_label} {kind} has reached {threshold}% of the configured cap "
        f"for the period starting {period_start.date()}. "
        f"Current: {current} {unit}. Limit: {limit} {unit}."
    )
    return title, body


async def _fan_out(
    session: AsyncSession,
    *,
    organization_id: UUID,
    title: str,
    body: str,
    metadata: dict,
) -> None:
    recipients = await _resolve_recipients(session, organization_id)
    if not recipients:
        return
    await session.commit()
    await emit_notification(
        NotificationEvent(
            notification_type=NotificationType.AGENTS_BUDGET_ALERT,
            organization_id=organization_id,
            actor_id=None,
            title=title,
            body=body,
            target_user_ids=recipients,
            metadata=metadata,
        )
    )


async def check_and_fire_alerts(
    session: AsyncSession,
    *,
    organization_id: UUID,
    run_cost: Decimal | None,
    run_image_count: int,
    run_at: datetime | None = None,
) -> None:
    """Detect crossings after the run is committed without letting alert failure reject it."""
    try:
        run_at = run_at or datetime.now(UTC)
        run_cost = run_cost or Decimal(0)
        run_images = run_image_count or 0

        # No crossings possible if this run had no billable activity.
        if run_cost == 0 and run_images == 0:
            return

        budget_result = await session.execute(
            select(AgentBudget).where(AgentBudget.organization_id == organization_id)
        )
        budget = budget_result.scalar_one_or_none()
        if budget is None:
            return

        reset_day = budget.reset_day or 1
        period_start, period_end = month_window(reset_day, run_at)

        thresholds = sorted(set((budget.alert_thresholds or []) + [100]))

        if budget.monthly_limit is not None and budget.monthly_limit > 0 and run_cost > 0:
            curr_total = await _sum_cost(
                session,
                organization_id=organization_id,
                period_start=period_start,
                period_end=period_end,
            )
            prev_total = curr_total - run_cost
            cap = Decimal(budget.monthly_limit)
            for threshold in _compute_crossings(prev_total, curr_total, cap, thresholds):
                claimed = await _try_claim_alert(
                    session,
                    scope=AgentBudgetAlertScope.ORGANIZATION,
                    organization_id=organization_id,
                    user_id=None,
                    period_start=period_start,
                    threshold=threshold,
                    kind=AgentBudgetAlertKind.SPEND,
                )
                if not claimed:
                    continue
                title, body = _render_alert(
                    scope=AgentBudgetAlertScope.ORGANIZATION,
                    kind=AgentBudgetAlertKind.SPEND,
                    threshold=threshold,
                    current=str(curr_total),
                    limit=str(cap),
                    period_start=period_start,
                )
                await _fan_out(
                    session,
                    organization_id=organization_id,
                    title=title,
                    body=body,
                    metadata={
                        "scope": "org",
                        "kind": "spend",
                        "threshold": threshold,
                        "current": str(curr_total),
                        "limit": str(cap),
                        "period_start": period_start.isoformat(),
                    },
                )

        if (
            budget.image_monthly_limit is not None
            and budget.image_monthly_limit > 0
            and run_images > 0
        ):
            curr_count = await _sum_image_count(
                session,
                organization_id=organization_id,
                period_start=period_start,
                period_end=period_end,
            )
            prev_count = curr_count - run_images
            cap = Decimal(budget.image_monthly_limit)
            for threshold in _compute_crossings(
                Decimal(prev_count),
                Decimal(curr_count),
                cap,
                list(IMAGE_ALERT_THRESHOLDS),
            ):
                claimed = await _try_claim_alert(
                    session,
                    scope=AgentBudgetAlertScope.ORGANIZATION,
                    organization_id=organization_id,
                    user_id=None,
                    period_start=period_start,
                    threshold=threshold,
                    kind=AgentBudgetAlertKind.IMAGE_COUNT,
                )
                if not claimed:
                    continue
                title, body = _render_alert(
                    scope=AgentBudgetAlertScope.ORGANIZATION,
                    kind=AgentBudgetAlertKind.IMAGE_COUNT,
                    threshold=threshold,
                    current=str(curr_count),
                    limit=str(int(cap)),
                    period_start=period_start,
                )
                await _fan_out(
                    session,
                    organization_id=organization_id,
                    title=title,
                    body=body,
                    metadata={
                        "scope": "org",
                        "kind": "image_count",
                        "threshold": threshold,
                        "current": curr_count,
                        "limit": int(cap),
                        "period_start": period_start.isoformat(),
                    },
                )
    except Exception:
        logger.opt(exception=True).warning("Budget alert processing failed")
