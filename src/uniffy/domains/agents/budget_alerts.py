"""Budget alert threshold detection and notification fanout.

Called after every ``AgentRunLog`` row with a non-null ``cost_usd``
(or non-zero ``image_count``) lands. Computes current-period totals,
finds thresholds crossed on this run, dedupes against
``agents_budget_alerts`` via its unique constraint, and creates a
``Notification`` for every org admin + agents-domain admin.

The 100% threshold always fires even when absent from
``alert_thresholds`` because it is the point at which hard enforcement
engages. Image-count alerts only fire at 90% and 100% because the
volume is typically low and intermediate thresholds are noise.
"""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.budget import AgentBudget
from uniffy.core.models.agents.budget_alert import AgentBudgetAlert
from uniffy.core.models.agents.run_log import AgentRunLog
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationRole,
)
from uniffy.core.models.notifications.notification import Notification
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.types import DomainType, NotificationType
from uniffy.domains.agents.budgets.period import month_window

logger = logger.bind(component="agents.budget_alerts")

IMAGE_ALERT_THRESHOLDS: tuple[int, ...] = (90, 100)


def _compute_crossings(
    prev_total: Decimal,
    curr_total: Decimal,
    cap: Decimal,
    thresholds: list[int],
) -> list[int]:
    """Return the subset of ``thresholds`` crossed between prev and curr.

    Crossing means ``prev_pct < T <= curr_pct`` where ``prev_pct`` and
    ``curr_pct`` are each ``100 * total / cap``. A threshold that is
    already passed before this run is not re-fired even when the dedupe
    table is empty; the whole point of the check is to detect just the
    transition.
    """
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
    """Return total ``cost_usd`` for the org in the period (inclusive of now)."""
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
    """Return total ``image_count`` for the org in the period."""
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
    """Return the set of user_ids that should receive agent budget alerts.

    Deduplicated. Includes org admins and owners plus all users with an
    ``agents`` DomainAdmin row for this org.
    """
    members = await session.execute(
        select(OrganizationMember.user_id).where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.is_active.is_(True),
            OrganizationMember.role.in_(
                (OrganizationRole.ADMIN, OrganizationRole.OWNER)
            ),
        )
    )
    recipients: set[UUID] = set(members.scalars().all())

    domain_admins = await session.execute(
        select(DomainAdmin.user_id)
        .join(
            OrganizationMember,
            OrganizationMember.user_id == DomainAdmin.user_id,
        )
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.is_active.is_(True),
            DomainAdmin.organization_id == organization_id,
            DomainAdmin.domain == DomainType.AGENTS,
        )
    )
    recipients.update(domain_admins.scalars().all())
    return list(recipients)


async def _try_claim_alert(
    session: AsyncSession,
    *,
    scope: str,
    organization_id: UUID,
    user_id: UUID | None,
    period_start: datetime,
    threshold: int,
    kind: str,
) -> bool:
    """Insert a dedupe row and return True when we were first.

    Uses a SAVEPOINT (``session.begin_nested()``) so the IntegrityError
    on the unique constraint does not poison the outer transaction. A
    False return means another worker already fired this alert for the
    same period.
    """
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
    scope: str,
    kind: str,
    threshold: int,
    current: str,
    limit: str,
    period_start: datetime,
) -> tuple[str, str]:
    """Build (title, body) for a budget alert notification."""
    scope_label = "Organization" if scope == "org" else "User"
    if kind == "spend":
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
    """Create one notification per recipient and commit."""
    recipients = await _resolve_recipients(session, organization_id)
    if not recipients:
        return
    for user_id in recipients:
        session.add(
            Notification(
                organization_id=organization_id,
                user_id=user_id,
                notification_type=NotificationType.AGENTS_BUDGET_ALERT,
                title=title,
                body=body,
                notification_metadata=metadata,
            )
        )
    await session.commit()


async def check_and_fire_alerts(
    session: AsyncSession,
    *,
    organization_id: UUID,
    run_cost: Decimal | None,
    run_image_count: int,
    run_at: datetime | None = None,
) -> None:
    """Detect threshold crossings for the just-written run and fan out alerts.

    Must be called after the run log is committed so the ``SUM`` queries
    include the new row. ``run_cost`` and ``run_image_count`` describe
    the run that just landed; the helper subtracts them to reconstruct
    the pre-run total when evaluating threshold crossings.

    Failures (DB errors, missing budget) are logged and swallowed - an
    alert miss is never a reason to reject a run.
    """
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

        if (
            budget.monthly_limit is not None
            and budget.monthly_limit > 0
            and run_cost > 0
        ):
            curr_total = await _sum_cost(
                session,
                organization_id=organization_id,
                period_start=period_start,
                period_end=period_end,
            )
            prev_total = curr_total - run_cost
            cap = Decimal(budget.monthly_limit)
            for threshold in _compute_crossings(
                prev_total, curr_total, cap, thresholds
            ):
                claimed = await _try_claim_alert(
                    session,
                    scope="org",
                    organization_id=organization_id,
                    user_id=None,
                    period_start=period_start,
                    threshold=threshold,
                    kind="spend",
                )
                if not claimed:
                    continue
                title, body = _render_alert(
                    scope="org",
                    kind="spend",
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
                    scope="org",
                    organization_id=organization_id,
                    user_id=None,
                    period_start=period_start,
                    threshold=threshold,
                    kind="image_count",
                )
                if not claimed:
                    continue
                title, body = _render_alert(
                    scope="org",
                    kind="image_count",
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
