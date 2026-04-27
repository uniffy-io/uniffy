"""Standalone provider resolution for background workers.

Provides a decoupled way to obtain an LLM provider instance without
importing the runtime domain. Workers can call ``get_provider_for_org()``
to get a ready-to-use provider.
"""

from uuid import UUID

from uniffy.db import open_session
from uniffy.domains.agents.providers.base import LLMProvider
from uniffy.domains.agents.providers.operations import ProviderOperations


async def get_provider_for_org(
    organization_id: UUID,
    provider: str = "anthropic",
) -> LLMProvider:
    """Get an active LLM provider for an organization.

    Creates its own database session, fetches a valid key, and returns
    a ready-to-use provider instance. Intended for use by background
    workers that need LLM access without coupling to the runtime domain.

    Parameters
    ----------
    organization_id : UUID
        Organization ID.
    provider : str
        Provider name (default "anthropic").

    Returns
    -------
    LLMProvider
        Configured provider instance.

    Raises
    ------
    NotFoundError
        If no valid key is found for the provider in the organization.

    """
    async with open_session() as session:
        ops = ProviderOperations(session)
        return await ops.get_active_provider(
            organization_id=organization_id,
            provider=provider,
        )
