"""Proto <-> domain converters for the budgets sub-service."""

from uniffy_proto.agents.v1.budgets_pb2 import (
    OrgBudget,
    SpendSummary,
    UserQuota,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.agents.budget import AgentBudget
from uniffy.core.models.agents.user_quota import AgentUserQuota
from uniffy.domains.agents.budgets.operations import SpendSummary as DomainSpendSummary


def org_budget_to_proto(row: AgentBudget) -> OrgBudget:
    """Convert an ``AgentBudget`` row to proto."""
    msg = OrgBudget(
        id=str(row.id),
        organization_id=str(row.organization_id),
        hard_limit=bool(row.hard_limit),
        reset_day=int(row.reset_day),
        alert_thresholds=list(row.alert_thresholds or []),
    )
    if row.monthly_limit_usd is not None:
        msg.monthly_limit_usd = str(row.monthly_limit_usd)
    if row.image_monthly_limit is not None:
        msg.image_monthly_limit = int(row.image_monthly_limit)
    msg.created_at.CopyFrom(datetime_to_timestamp(row.created_at))
    msg.updated_at.CopyFrom(datetime_to_timestamp(row.updated_at))
    return msg


def user_quota_to_proto(row: AgentUserQuota) -> UserQuota:
    """Convert an ``AgentUserQuota`` row to proto."""
    msg = UserQuota(
        id=str(row.id),
        organization_id=str(row.organization_id),
        user_id=str(row.user_id),
        hard_limit=bool(row.hard_limit),
    )
    if row.daily_limit_usd is not None:
        msg.daily_limit_usd = str(row.daily_limit_usd)
    if row.monthly_limit_usd is not None:
        msg.monthly_limit_usd = str(row.monthly_limit_usd)
    if row.daily_image_limit is not None:
        msg.daily_image_limit = int(row.daily_image_limit)
    if row.monthly_image_limit is not None:
        msg.monthly_image_limit = int(row.monthly_image_limit)
    msg.created_at.CopyFrom(datetime_to_timestamp(row.created_at))
    msg.updated_at.CopyFrom(datetime_to_timestamp(row.updated_at))
    return msg


def spend_summary_to_proto(summary: DomainSpendSummary) -> SpendSummary:
    """Convert the domain ``SpendSummary`` dataclass to proto."""
    msg = SpendSummary(
        organization_id=str(summary.organization_id),
        spend_usd=str(summary.spend_usd),
        image_count=int(summary.image_count),
    )
    msg.period_start.CopyFrom(datetime_to_timestamp(summary.period_start))
    msg.period_end.CopyFrom(datetime_to_timestamp(summary.period_end))
    if summary.pct_of_limit is not None:
        msg.pct_of_limit = int(summary.pct_of_limit)
    if summary.user_id is not None:
        msg.user_id = str(summary.user_id)
    return msg
