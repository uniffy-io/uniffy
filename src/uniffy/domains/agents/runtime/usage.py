"""Usage analytics operations for agent run logs."""

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import Integer, func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.cron_run_log import AgentCronRunLog
from uniffy.core.models.agents.cron_task import AgentCronTask
from uniffy.core.models.agents.provider_key import ProviderKey
from uniffy.core.models.agents.run_log import AgentRunLog

VALID_INTERVALS = {"30m", "1h", "2h", "4h", "1d"}

INTERVAL_TO_SECONDS: dict[str, int] = {
    "30m": 1800,
    "1h": 3600,
    "2h": 7200,
    "4h": 14400,
    "1d": 86400,
}


class UsageOperations:
    """Aggregate usage statistics from agent run logs.

    Parameters
    ----------
    session : AsyncSession
        Database session.

    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_usage_stats(
        self,
        organization_id: UUID,
        days: int = 30,
        interval: str = "1d",
        user_id: UUID | None = None,
    ) -> dict:
        """Get aggregated usage statistics for an organization.

        When ``user_id`` is provided the results are scoped to that single
        user's runs. Otherwise all runs in the organization are returned
        (admin view).

        Parameters
        ----------
        organization_id : UUID
            Organization to query stats for.
        days : int
            Number of days to look back (default 30).
        interval : str
            Aggregation interval: "30m", "1h", "2h", "4h", "1d" (default "1d").
        user_id : UUID | None
            When set, restrict results to this user's runs only.

        Returns
        -------
        dict
            Usage statistics including totals, time series breakdown, model usage,
            agent usage, and tool frequency.

        """
        days = max(1, min(days, 365))
        if interval not in VALID_INTERVALS:
            interval = "1d"
        since = datetime.now(UTC) - timedelta(days=days)

        base_filter = [
            AgentRunLog.organization_id == organization_id,
            AgentRunLog.created_at >= since,
        ]
        if user_id is not None:
            base_filter.append(AgentRunLog.user_id == user_id)

        totals = await self._get_totals(base_filter)
        time_series = await self._get_time_series_usage(base_filter, interval)
        model_usage = await self._get_model_usage(base_filter)
        agent_usage = await self._get_agent_usage(base_filter, organization_id)
        tool_usage = await self._get_tool_usage(base_filter)
        provider_key_usage = await self._get_provider_key_usage(base_filter)
        cron_usage = await self._get_cron_usage(organization_id, since, user_id)

        return {
            "totals": totals,
            "daily_usage": time_series,
            "model_usage": model_usage,
            "agent_usage": agent_usage,
            "tool_usage": tool_usage,
            "provider_key_usage": provider_key_usage,
            "cron_usage": cron_usage,
        }

    async def _get_totals(self, base_filter: list) -> dict:
        """Get summary totals for the period.

        Parameters
        ----------
        base_filter : list
            SQLAlchemy filter conditions.

        Returns
        -------
        dict
            Total runs, tokens, sessions, and average duration.

        """
        result = await self.session.execute(
            select(
                func.count(AgentRunLog.id).label("total_runs"),
                func.coalesce(func.sum(AgentRunLog.input_tokens), 0).label("total_input_tokens"),
                func.coalesce(func.sum(AgentRunLog.output_tokens), 0).label("total_output_tokens"),
                func.coalesce(
                    func.sum(AgentRunLog.cache_read_input_tokens), 0
                ).label("total_cache_read_input_tokens"),
                func.count(func.distinct(AgentRunLog.session_id)).label("total_sessions"),
                func.coalesce(func.avg(AgentRunLog.duration_ms), 0).label("avg_duration_ms"),
                func.coalesce(func.sum(AgentRunLog.cost_usd), 0).label("total_cost_usd"),
                func.coalesce(func.sum(AgentRunLog.thinking_tokens), 0).label(
                    "total_thinking_tokens"
                ),
                func.coalesce(func.sum(AgentRunLog.image_count), 0).label("total_image_count"),
                func.coalesce(func.sum(AgentRunLog.retry_count), 0).label("total_retries"),
                func.coalesce(
                    func.sum(func.cast(AgentRunLog.cancelled, Integer)), 0
                ).label("total_cancelled"),
                func.coalesce(
                    func.sum(func.cast(AgentRunLog.deadline_exceeded, Integer)), 0
                ).label("total_deadline_exceeded"),
            ).where(*base_filter)
        )
        row = result.one()
        return {
            "total_runs": row.total_runs,
            "total_input_tokens": row.total_input_tokens,
            "total_output_tokens": row.total_output_tokens,
            "total_cache_read_input_tokens": row.total_cache_read_input_tokens,
            "total_sessions": row.total_sessions,
            "avg_duration_ms": int(row.avg_duration_ms),
            "total_cost_usd": str(row.total_cost_usd or 0),
            "total_thinking_tokens": row.total_thinking_tokens,
            "total_image_count": row.total_image_count,
            "total_retries": row.total_retries,
            "total_cancelled": row.total_cancelled,
            "total_deadline_exceeded": row.total_deadline_exceeded,
        }

    async def _get_time_series_usage(
        self,
        base_filter: list,
        interval: str,
    ) -> list[dict]:
        """Get time series breakdown of runs and tokens.

        Parameters
        ----------
        base_filter : list
            SQLAlchemy filter conditions.
        interval : str
            Aggregation interval ("30m", "1h", "2h", "4h", "1d").

        Returns
        -------
        list[dict]
            Time-bucketed usage entries sorted by timestamp ascending.

        """
        if interval == "1d":
            bucket = func.date(AgentRunLog.created_at)
        elif interval == "1h":
            bucket = func.date_trunc(literal_column("'hour'"), AgentRunLog.created_at)
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
                func.coalesce(func.sum(AgentRunLog.input_tokens), 0).label("input_tokens"),
                func.coalesce(func.sum(AgentRunLog.output_tokens), 0).label("output_tokens"),
                func.coalesce(
                    func.sum(AgentRunLog.cache_read_input_tokens), 0
                ).label("cache_read_input_tokens"),
                func.coalesce(func.sum(AgentRunLog.cost_usd), 0).label("cost_usd"),
                func.coalesce(func.sum(AgentRunLog.image_count), 0).label("image_count"),
            )
            .where(*base_filter)
            .group_by(bucket)
            .order_by(bucket)
        )

        if interval == "1d":
            return [
                {
                    "date": str(row.bucket),
                    "runs": row.runs,
                    "input_tokens": row.input_tokens,
                    "output_tokens": row.output_tokens,
                    "cache_read_input_tokens": row.cache_read_input_tokens,
                    "cost_usd": str(row.cost_usd or 0),
                    "image_count": row.image_count,
                }
                for row in result.all()
            ]

        return [
            {
                "date": row.bucket.strftime("%Y-%m-%d %H:%M"),
                "runs": row.runs,
                "input_tokens": row.input_tokens,
                "output_tokens": row.output_tokens,
                "cache_read_input_tokens": row.cache_read_input_tokens,
                "cost_usd": str(row.cost_usd or 0),
                "image_count": row.image_count,
            }
            for row in result.all()
        ]

    async def _get_model_usage(self, base_filter: list) -> list[dict]:
        """Get token usage grouped by model.

        Parameters
        ----------
        base_filter : list
            SQLAlchemy filter conditions.

        Returns
        -------
        list[dict]
            Per-model usage entries sorted by total tokens descending.

        """
        result = await self.session.execute(
            select(
                AgentRunLog.model,
                func.count(AgentRunLog.id).label("runs"),
                func.coalesce(func.sum(AgentRunLog.input_tokens), 0).label("input_tokens"),
                func.coalesce(func.sum(AgentRunLog.output_tokens), 0).label("output_tokens"),
                func.coalesce(func.sum(AgentRunLog.cost_usd), 0).label("cost_usd"),
                func.coalesce(func.sum(AgentRunLog.image_count), 0).label("image_count"),
            )
            .where(*base_filter)
            .group_by(AgentRunLog.model)
            .order_by(
                (func.sum(AgentRunLog.input_tokens) + func.sum(AgentRunLog.output_tokens)).desc()
            )
        )
        return [
            {
                "model": row.model,
                "runs": row.runs,
                "input_tokens": row.input_tokens,
                "output_tokens": row.output_tokens,
                "cost_usd": str(row.cost_usd or 0),
                "image_count": row.image_count,
            }
            for row in result.all()
        ]

    async def _get_agent_usage(
        self,
        base_filter: list,
        organization_id: UUID,
    ) -> list[dict]:
        """Get usage grouped by agent with agent names.

        Parameters
        ----------
        base_filter : list
            SQLAlchemy filter conditions.
        organization_id : UUID
            Organization ID for agent name lookup.

        Returns
        -------
        list[dict]
            Per-agent usage entries sorted by total tokens descending.

        """
        result = await self.session.execute(
            select(
                AgentRunLog.agent_id,
                Agent.name.label("agent_name"),
                func.count(AgentRunLog.id).label("runs"),
                func.coalesce(func.sum(AgentRunLog.input_tokens), 0).label("input_tokens"),
                func.coalesce(func.sum(AgentRunLog.output_tokens), 0).label("output_tokens"),
            )
            .join(Agent, Agent.id == AgentRunLog.agent_id, isouter=True)
            .where(*base_filter)
            .group_by(AgentRunLog.agent_id, Agent.name)
            .order_by(
                (func.sum(AgentRunLog.input_tokens) + func.sum(AgentRunLog.output_tokens)).desc()
            )
        )
        return [
            {
                "agent_id": str(row.agent_id),
                "agent_name": row.agent_name or "Unknown Agent",
                "runs": row.runs,
                "input_tokens": row.input_tokens,
                "output_tokens": row.output_tokens,
            }
            for row in result.all()
        ]

    async def _get_tool_usage(self, base_filter: list) -> list[dict]:
        """Get tool call frequency from JSONB tool_calls column.

        Parameters
        ----------
        base_filter : list
            SQLAlchemy filter conditions.

        Returns
        -------
        list[dict]
            Tool names sorted by call count descending.

        """
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
        """Get usage grouped by provider key.

        Parameters
        ----------
        base_filter : list
            SQLAlchemy filter conditions.

        Returns
        -------
        list[dict]
            Per-key usage entries sorted by total tokens descending.

        """
        result = await self.session.execute(
            select(
                AgentRunLog.provider_key_id,
                ProviderKey.label.label("key_label"),
                ProviderKey.provider.label("provider"),
                func.count(AgentRunLog.id).label("runs"),
                func.coalesce(func.sum(AgentRunLog.input_tokens), 0).label("input_tokens"),
                func.coalesce(func.sum(AgentRunLog.output_tokens), 0).label("output_tokens"),
            )
            .join(ProviderKey, ProviderKey.id == AgentRunLog.provider_key_id, isouter=True)
            .where(
                *base_filter,
                AgentRunLog.provider_key_id.isnot(None),
            )
            .group_by(AgentRunLog.provider_key_id, ProviderKey.label, ProviderKey.provider)
            .order_by(
                (func.sum(AgentRunLog.input_tokens) + func.sum(AgentRunLog.output_tokens)).desc()
            )
        )
        return [
            {
                "provider_key_id": str(row.provider_key_id),
                "key_label": row.key_label or "Unknown Key",
                "provider": row.provider or "unknown",
                "runs": row.runs,
                "input_tokens": row.input_tokens,
                "output_tokens": row.output_tokens,
            }
            for row in result.all()
        ]

    async def _get_cron_usage(
        self,
        organization_id: UUID,
        since: datetime,
        user_id: UUID | None = None,
    ) -> dict:
        """Get usage statistics for cron (scheduled) tasks.

        Queries the cron run logs table for per-task breakdowns
        and summary totals including success/failure counts.

        Parameters
        ----------
        organization_id : UUID
            Organization to query.
        since : datetime
            Start of the reporting period.
        user_id : UUID | None
            When set, restrict to cron tasks owned by this user.

        Returns
        -------
        dict
            Cron usage with "totals" and "per_task" breakdowns.

        """
        cron_filter = [
            AgentCronRunLog.organization_id == organization_id,
            AgentCronRunLog.started_at >= since,
        ]

        if user_id is not None:
            cron_filter.append(AgentCronTask.owner_id == user_id)

        # Summary totals
        totals_query = (
            select(
                func.count(AgentCronRunLog.id).label("total_runs"),
                func
                .count(AgentCronRunLog.id)
                .filter(AgentCronRunLog.status == "success")
                .label("successes"),
                func
                .count(AgentCronRunLog.id)
                .filter(AgentCronRunLog.status == "error")
                .label("failures"),
                func.coalesce(func.sum(AgentCronRunLog.input_tokens), 0).label("input_tokens"),
                func.coalesce(func.sum(AgentCronRunLog.output_tokens), 0).label("output_tokens"),
            )
            .join(
                AgentCronTask,
                AgentCronTask.id == AgentCronRunLog.cron_task_id,
                isouter=True,
            )
            .where(*cron_filter)
        )
        totals_result = await self.session.execute(totals_query)
        totals_row = totals_result.one()

        # Per-task breakdown with task name and agent name
        per_task_result = await self.session.execute(
            select(
                AgentCronRunLog.cron_task_id,
                AgentCronTask.name.label("task_name"),
                Agent.name.label("agent_name"),
                func.count(AgentCronRunLog.id).label("total_runs"),
                func
                .count(AgentCronRunLog.id)
                .filter(AgentCronRunLog.status == "success")
                .label("successes"),
                func
                .count(AgentCronRunLog.id)
                .filter(AgentCronRunLog.status == "error")
                .label("failures"),
                func.coalesce(func.sum(AgentCronRunLog.input_tokens), 0).label("input_tokens"),
                func.coalesce(func.sum(AgentCronRunLog.output_tokens), 0).label("output_tokens"),
            )
            .join(
                AgentCronTask,
                AgentCronTask.id == AgentCronRunLog.cron_task_id,
                isouter=True,
            )
            .join(
                Agent,
                Agent.id == AgentCronTask.agent_id,
                isouter=True,
            )
            .where(*cron_filter)
            .group_by(
                AgentCronRunLog.cron_task_id,
                AgentCronTask.name,
                Agent.name,
            )
            .order_by(func.count(AgentCronRunLog.id).desc())
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
            },
            "per_task": per_task,
        }
