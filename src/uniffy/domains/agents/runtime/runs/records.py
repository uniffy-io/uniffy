"""Agent run persistence and display-currency accounting."""

from decimal import Decimal
from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.run_log import AgentRunLog, AgentRunStatus
from uniffy.domains.agents.budgets.alerts import check_and_fire_alerts
from uniffy.domains.agents.currency import convert as convert_currency
from uniffy.domains.agents.currency import get_display_currency
from uniffy.domains.agents.pricing import PRICING_CURRENCY
from uniffy.domains.agents.runtime.runs.usage import RunUsageAccumulator

logger = logger.bind(component="agents.runtime.runs.records")


class RunRecorder:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def record(
        self,
        *,
        session_id: UUID | None,
        agent_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        model: str,
        usage: RunUsageAccumulator,
        tool_calls: list[dict] | None,
        tool_iterations: int,
        duration_ms: int,
        status: AgentRunStatus | str,
        error: str | None,
        provider_key_id: UUID | None = None,
        channel_id: UUID | None = None,
    ) -> UUID | None:
        cost, cost_currency = await self._compute_cost(
            organization_id=organization_id,
            usage=usage,
        )
        recorded_model = usage.last_model or model
        recorded_provider_key_id = usage.last_provider_key_id or provider_key_id
        try:
            run_log = AgentRunLog(
                session_id=session_id,
                channel_id=channel_id,
                agent_id=agent_id,
                user_id=user_id,
                organization_id=organization_id,
                model=recorded_model,
                provider_key_id=recorded_provider_key_id,
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                cache_creation_input_tokens=usage.cache_creation_input_tokens,
                cache_read_input_tokens=usage.cache_read_input_tokens,
                thinking_tokens=usage.thinking_tokens,
                tool_calls=tool_calls,
                model_calls=usage.to_list() or None,
                tool_iterations=tool_iterations,
                duration_ms=duration_ms,
                status=status,
                error=error,
                retry_count=usage.retry_count,
                failover_provider_key_ids=usage.failover_provider_key_ids or None,
                deadline_exceeded=usage.deadline_exceeded,
                cost=cost,
                cost_currency=cost_currency,
            )
            run_log_id = run_log.id
            self._session.add(run_log)
            await self._session.commit()
        except Exception:
            logger.opt(exception=True).warning("Failed to create agent run log")
            return None

        if cost is not None:
            try:
                await check_and_fire_alerts(
                    self._session,
                    organization_id=organization_id,
                    run_cost=cost,
                    run_image_count=0,
                )
            except Exception:
                logger.opt(exception=True).warning("Agent run budget alerts failed")
        return run_log_id

    async def _compute_cost(
        self,
        *,
        organization_id: UUID,
        usage: RunUsageAccumulator,
    ) -> tuple[Decimal | None, str | None]:
        try:
            raw_cost = usage.cost_usd()
            if raw_cost is None:
                logger.warning(
                    "Skipping cost calculation: model call pricing is incomplete",
                    model_calls=[
                        {"provider": call.provider, "model": call.model} for call in usage.calls
                    ],
                )
                return None, None
            display_currency = await get_display_currency(self._session, organization_id)
            converted = await convert_currency(
                raw_cost,
                PRICING_CURRENCY,
                display_currency,
                self._session,
                organization_id,
            )
            return converted, display_currency
        except ValidationError as exc:
            logger.warning(f"Skipping cost calculation: {exc}")
            return None, None
        except Exception as exc:
            logger.exception(f"Cost calculation failed unexpectedly: {exc!r}")
            return None, None
