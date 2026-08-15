"""Usage analytics operations for agent run logs."""

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from uuid import UUID

from sqlalchemy import Integer, func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.cron_task import AgentCronTask
from uniffy.core.models.agents.provider_key import ProviderKey
from uniffy.core.models.agents.run_log import AgentRunLog, AgentRunStatus
from uniffy.domains.agents.currency import get_display_currency


class UsageInterval(StrEnum):
    THIRTY_MINUTES = "30m"
    ONE_HOUR = "1h"
    TWO_HOURS = "2h"
    FOUR_HOURS = "4h"
    ONE_DAY = "1d"


INTERVAL_TO_SECONDS: dict[UsageInterval, int] = {
    UsageInterval.THIRTY_MINUTES: 1800,
    UsageInterval.ONE_HOUR: 3600,
    UsageInterval.TWO_HOURS: 7200,
    UsageInterval.FOUR_HOURS: 14400,
    UsageInterval.ONE_DAY: 86400,
}


def _full_input_tokens():
    return (
        AgentRunLog.input_tokens
        + AgentRunLog.cache_creation_input_tokens
        + AgentRunLog.cache_read_input_tokens
    )


class UsageOperations:
    """Aggregate usage statistics from agent run logs."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_usage_stats(
        self,
        organization_id: UUID,
        days: int = 30,
        interval: str = UsageInterval.ONE_DAY,
        user_id: UUID | None = None,
    ) -> dict:
        """Aggregate usage for an organization.

        When ``user_id`` is provided the results are scoped to that single
        user's runs; otherwise all runs in the organization are returned
        (admin view).
        """
        days = max(1, min(days, 365))
        try:
            resolved_interval = UsageInterval(interval)
        except ValueError:
            resolved_interval = UsageInterval.ONE_DAY
        since = datetime.now(UTC) - timedelta(days=days)

        base_filter = [
            AgentRunLog.organization_id == organization_id,
            AgentRunLog.created_at >= since,
        ]
        if user_id is not None:
            base_filter.append(AgentRunLog.user_id == user_id)

        totals = await self._get_totals(base_filter)
        time_series = await self._get_time_series_usage(base_filter, resolved_interval)
        model_usage = await self._get_model_usage(base_filter)
        agent_usage = await self._get_agent_usage(base_filter, organization_id)
        tool_usage = await self._get_tool_usage(base_filter)
        provider_key_usage = await self._get_provider_key_usage(base_filter)
        cron_usage = await self._get_cron_usage(organization_id, since, user_id)
        display_currency = await get_display_currency(self.session, organization_id)

        return {
            "totals": totals,
            "daily_usage": time_series,
            "model_usage": model_usage,
            "agent_usage": agent_usage,
            "tool_usage": tool_usage,
            "provider_key_usage": provider_key_usage,
            "cron_usage": cron_usage,
            "display_currency": display_currency,
        }

    async def _get_totals(self, base_filter: list) -> dict:
        result = await self.session.execute(
            select(
                func.count(AgentRunLog.id).label("total_runs"),
                func.coalesce(func.sum(_full_input_tokens()), 0).label("total_input_tokens"),
                func.coalesce(func.sum(AgentRunLog.output_tokens), 0).label("total_output_tokens"),
                func.coalesce(func.sum(AgentRunLog.cache_read_input_tokens), 0).label(
                    "total_cache_read_input_tokens"
                ),
                func.coalesce(func.sum(AgentRunLog.cache_creation_input_tokens), 0).label(
                    "total_cache_creation_input_tokens"
                ),
                func.count(func.distinct(AgentRunLog.session_id)).label("total_sessions"),
                func.coalesce(func.avg(AgentRunLog.duration_ms), 0).label("avg_duration_ms"),
                func.coalesce(func.sum(AgentRunLog.cost), 0).label("total_cost"),
                func.coalesce(func.sum(AgentRunLog.thinking_tokens), 0).label(
                    "total_thinking_tokens"
                ),
                func.coalesce(func.sum(AgentRunLog.image_count), 0).label("total_image_count"),
                func.coalesce(func.sum(AgentRunLog.retry_count), 0).label("total_retries"),
                func.coalesce(func.sum(func.cast(AgentRunLog.cancelled, Integer)), 0).label(
                    "total_cancelled"
                ),
                func.coalesce(func.sum(func.cast(AgentRunLog.deadline_exceeded, Integer)), 0).label(
                    "total_deadline_exceeded"
                ),
            ).where(*base_filter)
        )
        row = result.one()
        return {
            "total_runs": row.total_runs,
            "total_input_tokens": row.total_input_tokens,
            "total_output_tokens": row.total_output_tokens,
            "total_cache_read_input_tokens": row.total_cache_read_input_tokens,
            "total_cache_creation_input_tokens": (row.total_cache_creation_input_tokens),
            "total_sessions": row.total_sessions,
            "avg_duration_ms": int(row.avg_duration_ms),
            "total_cost": str(row.total_cost or 0),
            "total_thinking_tokens": row.total_thinking_tokens,
            "total_image_count": row.total_image_count,
            "total_retries": row.total_retries,
            "total_cancelled": row.total_cancelled,
            "total_deadline_exceeded": row.total_deadline_exceeded,
        }

    async def _get_time_series_usage(
        self,
        base_filter: list,
        interval: UsageInterval,
    ) -> list[dict]:
        if interval is UsageInterval.ONE_DAY:
            # timezone('UTC', timestamptz) yields a naive-UTC timestamp, so the
            # bucket boundary no longer follows the session TimeZone.
            bucket = func.date(func.timezone("UTC", AgentRunLog.created_at))
        elif interval is UsageInterval.ONE_HOUR:
            # Inner timezone() pins the truncation boundary to UTC; the outer
            # one restores timestamptz so the row comes back aware.
            bucket = func.timezone(
                "UTC",
                func.date_trunc(
                    literal_column("'hour'"),
                    func.timezone("UTC", AgentRunLog.created_at),
                ),
            )
        else:
            # For arbitrary intervals (30m, 2h, 4h), use epoch floor rounding
            secs = INTERVAL_TO_SECONDS[interval]
            epoch = func.extract("epoch", AgentRunLog.created_at)
            floored_epoch = func.floor(epoch / secs) * secs
            bucket = func.to_timestamp(floored_epoch)

        result = await self.session.execute(
            select(
                bucket.label("bucket"),
                func.count(AgentRunLog.id).label("runs"),
                func.coalesce(func.sum(_full_input_tokens()), 0).label("input_tokens"),
                func.coalesce(func.sum(AgentRunLog.output_tokens), 0).label("output_tokens"),
                func.coalesce(func.sum(AgentRunLog.cache_read_input_tokens), 0).label(
                    "cache_read_input_tokens"
                ),
                func.coalesce(func.sum(AgentRunLog.cache_creation_input_tokens), 0).label(
                    "cache_creation_input_tokens"
                ),
                func.coalesce(func.sum(AgentRunLog.cost), 0).label("cost"),
                func.coalesce(func.sum(AgentRunLog.image_count), 0).label("image_count"),
            )
            .where(*base_filter)
            .group_by(bucket)
            .order_by(bucket)
        )

        if interval is UsageInterval.ONE_DAY:
            return [
                {
                    "date": str(row.bucket),
                    "runs": row.runs,
                    "input_tokens": row.input_tokens,
                    "output_tokens": row.output_tokens,
                    "cache_read_input_tokens": row.cache_read_input_tokens,
                    "cache_creation_input_tokens": row.cache_creation_input_tokens,
                    "cost": str(row.cost or 0),
                    "image_count": row.image_count,
                }
                for row in result.all()
            ]

        return [
            {
                # Aware isoformat carries the offset - a bare wall-clock string
                # gets parsed as LOCAL time by `new Date()` in the browser.
                "date": row.bucket.isoformat(),
                "runs": row.runs,
                "input_tokens": row.input_tokens,
                "output_tokens": row.output_tokens,
                "cache_read_input_tokens": row.cache_read_input_tokens,
                "cache_creation_input_tokens": row.cache_creation_input_tokens,
                "cost": str(row.cost or 0),
                "image_count": row.image_count,
            }
            for row in result.all()
        ]

    async def _get_model_usage(self, base_filter: list) -> list[dict]:
        result = await self.session.execute(
            select(
                AgentRunLog.model,
                func.count(AgentRunLog.id).label("runs"),
                func.coalesce(func.sum(_full_input_tokens()), 0).label("input_tokens"),
                func.coalesce(func.sum(AgentRunLog.output_tokens), 0).label("output_tokens"),
                func.coalesce(func.sum(AgentRunLog.cache_read_input_tokens), 0).label(
                    "cache_read_input_tokens"
                ),
                func.coalesce(func.sum(AgentRunLog.cache_creation_input_tokens), 0).label(
                    "cache_creation_input_tokens"
                ),
                func.coalesce(func.sum(AgentRunLog.cost), 0).label("cost"),
                func.coalesce(func.sum(AgentRunLog.image_count), 0).label("image_count"),
            )
            .where(*base_filter)
            .group_by(AgentRunLog.model)
            .order_by((func.sum(_full_input_tokens()) + func.sum(AgentRunLog.output_tokens)).desc())
        )
        return [
            {
                "model": row.model,
                "runs": row.runs,
                "input_tokens": row.input_tokens,
                "output_tokens": row.output_tokens,
                "cache_read_input_tokens": row.cache_read_input_tokens,
                "cache_creation_input_tokens": row.cache_creation_input_tokens,
                "cost": str(row.cost or 0),
                "image_count": row.image_count,
            }
            for row in result.all()
        ]

    async def _get_agent_usage(
        self,
        base_filter: list,
        organization_id: UUID,
    ) -> list[dict]:
        result = await self.session.execute(
            select(
                AgentRunLog.agent_id,
                Agent.name.label("agent_name"),
                func.count(AgentRunLog.id).label("runs"),
                func.coalesce(func.sum(_full_input_tokens()), 0).label("input_tokens"),
                func.coalesce(func.sum(AgentRunLog.output_tokens), 0).label("output_tokens"),
                func.coalesce(func.sum(AgentRunLog.cache_read_input_tokens), 0).label(
                    "cache_read_input_tokens"
                ),
                func.coalesce(func.sum(AgentRunLog.cache_creation_input_tokens), 0).label(
                    "cache_creation_input_tokens"
                ),
            )
            .join(Agent, Agent.id == AgentRunLog.agent_id, isouter=True)
            .where(*base_filter)
            .group_by(AgentRunLog.agent_id, Agent.name)
            .order_by((func.sum(_full_input_tokens()) + func.sum(AgentRunLog.output_tokens)).desc())
        )
        return [
            {
                "agent_id": str(row.agent_id),
                "agent_name": row.agent_name or "Unknown Agent",
                "runs": row.runs,
                "input_tokens": row.input_tokens,
                "output_tokens": row.output_tokens,
                "cache_read_input_tokens": row.cache_read_input_tokens,
                "cache_creation_input_tokens": row.cache_creation_input_tokens,
            }
            for row in result.all()
        ]

    async def _get_tool_usage(self, base_filter: list) -> list[dict]:
        # Fetch raw tool_calls JSONB data and aggregate in Python
        # since JSONB array element extraction varies across PostgreSQL versions
        result = await self.session.execute(
            select(AgentRunLog.tool_calls).where(
                *base_filter,
                AgentRunLog.tool_calls.isnot(None),
            )
        )

        tool_counts: dict[str, int] = defaultdict(int)
        for (tool_calls_json,) in result.all():
            if not tool_calls_json:
                continue
            for call in tool_calls_json:
                name = call.get("name", "unknown")
                tool_counts[name] += 1

        sorted_tools = sorted(tool_counts.items(), key=lambda x: x[1], reverse=True)
        return [
            {"tool_name": name, "call_count": count}
            for name, count in sorted_tools[:20]  # Top 20 tools
        ]

    async def _get_provider_key_usage(self, base_filter: list) -> list[dict]:
        result = await self.session.execute(
            select(
                AgentRunLog.provider_key_id,
                ProviderKey.label.label("key_label"),
                ProviderKey.provider.label("provider"),
                func.count(AgentRunLog.id).label("runs"),
                func.coalesce(func.sum(_full_input_tokens()), 0).label("input_tokens"),
                func.coalesce(func.sum(AgentRunLog.output_tokens), 0).label("output_tokens"),
                func.coalesce(func.sum(AgentRunLog.cache_read_input_tokens), 0).label(
                    "cache_read_input_tokens"
                ),
                func.coalesce(func.sum(AgentRunLog.cache_creation_input_tokens), 0).label(
                    "cache_creation_input_tokens"
                ),
            )
            .join(ProviderKey, ProviderKey.id == AgentRunLog.provider_key_id, isouter=True)
            .where(
                *base_filter,
                AgentRunLog.provider_key_id.isnot(None),
            )
            .group_by(AgentRunLog.provider_key_id, ProviderKey.label, ProviderKey.provider)
            .order_by((func.sum(_full_input_tokens()) + func.sum(AgentRunLog.output_tokens)).desc())
        )
        return [
            {
                "provider_key_id": str(row.provider_key_id),
                "key_label": row.key_label or "Unknown Key",
                "provider": row.provider or "unknown",
                "runs": row.runs,
                "input_tokens": row.input_tokens,
                "output_tokens": row.output_tokens,
                "cache_read_input_tokens": row.cache_read_input_tokens,
                "cache_creation_input_tokens": row.cache_creation_input_tokens,
            }
            for row in result.all()
        ]

    async def _get_cron_usage(
        self,
        organization_id: UUID,
        since: datetime,
        user_id: UUID | None = None,
    ) -> dict:
        """Cron usage totals and per-task breakdown from cron-stamped run logs."""
        cron_filter = [
            AgentRunLog.organization_id == organization_id,
            AgentRunLog.cron_task_id.is_not(None),
            AgentRunLog.created_at >= since,
        ]

        if user_id is not None:
            cron_filter.append(AgentCronTask.owner_id == user_id)

        totals_query = (
            select(
                func.count(AgentRunLog.id).label("total_runs"),
                func
                .count(AgentRunLog.id)
                .filter(AgentRunLog.status == AgentRunStatus.SUCCESS)
                .label("successes"),
                func
                .count(AgentRunLog.id)
                .filter(AgentRunLog.status == AgentRunStatus.ERROR)
                .label("failures"),
                func.coalesce(func.sum(_full_input_tokens()), 0).label("input_tokens"),
                func.coalesce(func.sum(AgentRunLog.output_tokens), 0).label("output_tokens"),
                func.coalesce(func.sum(AgentRunLog.cache_read_input_tokens), 0).label(
                    "cache_read_input_tokens"
                ),
                func.coalesce(func.sum(AgentRunLog.cache_creation_input_tokens), 0).label(
                    "cache_creation_input_tokens"
                ),
            )
            .join(
                AgentCronTask,
                AgentCronTask.id == AgentRunLog.cron_task_id,
                isouter=True,
            )
            .where(*cron_filter)
        )
        totals_result = await self.session.execute(totals_query)
        totals_row = totals_result.one()

        per_task_result = await self.session.execute(
            select(
                AgentRunLog.cron_task_id,
                AgentCronTask.name.label("task_name"),
                Agent.name.label("agent_name"),
                func.count(AgentRunLog.id).label("total_runs"),
                func
                .count(AgentRunLog.id)
                .filter(AgentRunLog.status == AgentRunStatus.SUCCESS)
                .label("successes"),
                func
                .count(AgentRunLog.id)
                .filter(AgentRunLog.status == AgentRunStatus.ERROR)
                .label("failures"),
                func.coalesce(func.sum(_full_input_tokens()), 0).label("input_tokens"),
                func.coalesce(func.sum(AgentRunLog.output_tokens), 0).label("output_tokens"),
                func.coalesce(func.sum(AgentRunLog.cache_read_input_tokens), 0).label(
                    "cache_read_input_tokens"
                ),
                func.coalesce(func.sum(AgentRunLog.cache_creation_input_tokens), 0).label(
                    "cache_creation_input_tokens"
                ),
            )
            .join(
                AgentCronTask,
                AgentCronTask.id == AgentRunLog.cron_task_id,
                isouter=True,
            )
            .join(
                Agent,
                Agent.id == AgentCronTask.agent_id,
                isouter=True,
            )
            .where(*cron_filter)
            .group_by(
                AgentRunLog.cron_task_id,
                AgentCronTask.name,
                Agent.name,
            )
            .order_by(func.count(AgentRunLog.id).desc())
        )

        per_task = [
            {
                "cron_task_id": str(row.cron_task_id),
                "task_name": row.task_name or "Unknown Task",
                "agent_name": row.agent_name or "Unknown Agent",
                "total_runs": row.total_runs,
                "successes": row.successes,
                "failures": row.failures,
                "input_tokens": row.input_tokens,
                "output_tokens": row.output_tokens,
                "cache_read_input_tokens": row.cache_read_input_tokens,
                "cache_creation_input_tokens": row.cache_creation_input_tokens,
            }
            for row in per_task_result.all()
        ]

        return {
            "totals": {
                "total_runs": totals_row.total_runs,
                "successes": totals_row.successes,
                "failures": totals_row.failures,
                "input_tokens": totals_row.input_tokens,
                "output_tokens": totals_row.output_tokens,
                "cache_read_input_tokens": totals_row.cache_read_input_tokens,
                "cache_creation_input_tokens": totals_row.cache_creation_input_tokens,
            },
            "per_task": per_task,
        }
