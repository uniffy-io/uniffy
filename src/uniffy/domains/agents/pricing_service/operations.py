"""CRUD for ``agents_model_pricing``.

Reads require org membership (or no membership at all - prices are not
sensitive). Writes require ``User.is_system_admin`` because pricing is
a global concern: one tenant should never be able to alter prices that
affect every other tenant on the deployment.
"""

from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.model_pricing import AgentModelPricing
from uniffy.core.models.login.user import User

VALID_KINDS = frozenset({"text", "image"})


async def _require_system_admin(session: AsyncSession, user_id: UUID) -> None:
    """Raise ``PermissionDeniedError`` unless the user is a system admin."""
    result = await session.execute(
        select(User.is_system_admin).where(User.id == user_id)
    )
    is_admin = result.scalar_one_or_none() or False
    if not is_admin:
        raise PermissionDeniedError("write_pricing", "system_admin_required")


def _parse_decimal(value: str | None, field: str) -> Decimal | None:
    """Parse a string into a Decimal or raise ``ValidationError``."""
    if value is None or value == "":
        return None
    try:
        return Decimal(value)
    except (InvalidOperation, TypeError) as exc:
        raise ValidationError(field, f"Invalid decimal value: {value}") from exc


class PricingServiceOperations:
    """Operations backing ``agents.v1.PricingService``."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_pricing(
        self,
        *,
        provider: str | None = None,
        kind: str | None = None,
        as_of: datetime | None = None,
    ) -> list[AgentModelPricing]:
        """List pricing rows, optionally filtered."""
        query = select(AgentModelPricing)
        if provider:
            query = query.where(AgentModelPricing.provider == provider)
        if kind:
            if kind not in VALID_KINDS:
                raise ValidationError("kind", f"Invalid kind: {kind}")
            query = query.where(AgentModelPricing.kind == kind)
        if as_of is not None:
            query = query.where(
                AgentModelPricing.effective_from <= as_of,
                or_(
                    AgentModelPricing.effective_to.is_(None),
                    AgentModelPricing.effective_to > as_of,
                ),
            )
        query = query.order_by(
            AgentModelPricing.provider,
            AgentModelPricing.model,
            AgentModelPricing.effective_from.desc(),
        )
        result = await self._session.execute(query)
        return list(result.scalars().all())

    async def upsert_pricing(
        self,
        *,
        actor_user_id: UUID,
        provider: str,
        model: str,
        kind: str,
        input_per_1m: str | None,
        output_per_1m: str | None,
        cached_input_per_1m: str | None,
        thinking_per_1m: str | None,
        image_prices: list[tuple[str, str, str]] | None,
        effective_from: datetime,
        effective_to: datetime | None,
    ) -> AgentModelPricing:
        """Create or overwrite a pricing row.

        A row is considered the "same" row when ``(provider, model,
        effective_from)`` matches; in that case the existing row is
        updated. Otherwise a new row is inserted.
        """
        await _require_system_admin(self._session, actor_user_id)

        if kind not in VALID_KINDS:
            raise ValidationError("kind", f"Invalid kind: {kind}")
        if not provider.strip():
            raise ValidationError("provider", "provider is required")
        if not model.strip():
            raise ValidationError("model", "model is required")
        if effective_to is not None and effective_to <= effective_from:
            raise ValidationError(
                "effective_to",
                "effective_to must be strictly after effective_from",
            )

        input_rate = _parse_decimal(input_per_1m, "input_per_1m")
        output_rate = _parse_decimal(output_per_1m, "output_per_1m")
        cached_rate = _parse_decimal(cached_input_per_1m, "cached_input_per_1m")
        thinking_rate = _parse_decimal(thinking_per_1m, "thinking_per_1m")

        image_prices_dict: dict[str, dict[str, str]] | None = None
        if image_prices:
            image_prices_dict = {}
            for size, quality, price in image_prices:
                # Validate each price parses as Decimal even though we
                # store as string to match JSON-column conventions.
                _parse_decimal(price, f"image_prices[{size},{quality}]")
                image_prices_dict.setdefault(size, {})[quality] = price

        if kind == "text" and input_rate is None and output_rate is None:
            raise ValidationError(
                "rates",
                "text kind requires at least input_per_1m or output_per_1m",
            )
        if kind == "image" and not image_prices_dict:
            raise ValidationError(
                "image_prices",
                "image kind requires at least one image price entry",
            )

        existing_result = await self._session.execute(
            select(AgentModelPricing).where(
                AgentModelPricing.provider == provider,
                AgentModelPricing.model == model,
                AgentModelPricing.effective_from == effective_from,
            )
        )
        existing = existing_result.scalar_one_or_none()

        if existing is None:
            row = AgentModelPricing(
                provider=provider,
                model=model,
                kind=kind,
                input_per_1m=input_rate,
                output_per_1m=output_rate,
                cached_input_per_1m=cached_rate,
                thinking_per_1m=thinking_rate,
                image_prices=image_prices_dict,
                effective_from=effective_from,
                effective_to=effective_to,
            )
            self._session.add(row)
        else:
            existing.kind = kind
            existing.input_per_1m = input_rate
            existing.output_per_1m = output_rate
            existing.cached_input_per_1m = cached_rate
            existing.thinking_per_1m = thinking_rate
            existing.image_prices = image_prices_dict
            existing.effective_to = effective_to
            existing.updated_at = datetime.now(UTC)
            row = existing

        await self._session.commit()
        await self._session.refresh(row)
        return row

    async def delete_pricing(
        self,
        *,
        actor_user_id: UUID,
        pricing_id: UUID,
    ) -> None:
        """Delete a pricing row by id."""
        await _require_system_admin(self._session, actor_user_id)

        result = await self._session.execute(
            select(AgentModelPricing).where(AgentModelPricing.id == pricing_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise NotFoundError("AgentModelPricing", str(pricing_id))

        await self._session.delete(row)
        await self._session.commit()
