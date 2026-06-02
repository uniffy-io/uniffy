"""Currency conversion using per-org manual exchange rates.

The runtime calls :func:`convert` whenever it has an amount in one
currency and needs to express it in another. Pricing rows declare
their billing currency; orgs declare a display currency; the rate
table fills the gap. No conversion paths are inferred — admins enter
each direction explicitly (``USD -> EUR`` is separate from ``EUR -> USD``).

Display-currency resolution lives here too so call sites don't have to
re-import the model and re-write the lookup.
"""

from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.currency_rate import AgentCurrencyRate
from uniffy.core.models.agents.runtime_settings import AgentRuntimeSettings

# Matches pricing.PRICING_CURRENCY so a fresh org needs no exchange-rate row:
# convert() short-circuits when display == pricing currency.
DEFAULT_DISPLAY_CURRENCY = "USD"


async def get_display_currency(
    session: AsyncSession,
    organization_id: UUID,
) -> str:
    """Return the org's display currency, or the module default."""
    row = (
        await session.execute(
            select(AgentRuntimeSettings.display_currency).where(
                AgentRuntimeSettings.organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()
    return row or DEFAULT_DISPLAY_CURRENCY


async def convert(
    amount: Decimal,
    from_currency: str,
    to_currency: str,
    session: AsyncSession,
    organization_id: UUID,
) -> Decimal:
    """Convert ``amount`` from ``from_currency`` to ``to_currency``.

    Returns ``amount`` unchanged when the currencies match. Otherwise
    looks up the org's rate row and multiplies. Raises ``ValidationError``
    when no rate row exists — the runtime should never silently fall back
    to a 1.0 rate because that would invent money.
    """
    if from_currency == to_currency:
        return amount

    rate = (
        await session.execute(
            select(AgentCurrencyRate.rate).where(
                AgentCurrencyRate.organization_id == organization_id,
                AgentCurrencyRate.from_currency == from_currency,
                AgentCurrencyRate.to_currency == to_currency,
            )
        )
    ).scalar_one_or_none()

    if rate is None:
        raise ValidationError(
            "exchange_rate",
            f"No exchange rate defined for {from_currency} -> {to_currency}. "
            f"Add one in /admin/agents-budgets > Currencies.",
        )

    return amount * rate
