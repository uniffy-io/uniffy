"""Model resolution logic for agent runtime."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.domains.agents.providers.base import LLMProvider
from uniffy.domains.agents.runtime.settings import get_runtime_settings


async def resolve_model(
    *,
    session_model_override: str | None,
    agent_primary_model: str,
    agent_fallback_models: list[str],
    provider: LLMProvider,
    org_default_model: str | None = None,
) -> str:
    """Resolve which model to use for a completion request.

    Priority: per-session override, agent primary, agent fallbacks, org
    default chat model. There is no silent catalog pick; an unresolvable
    request raises so the caller can surface a typed error.
    """
    available_models = await provider.get_available_models()
    available = {m.id for m in available_models}

    if session_model_override and session_model_override in available:
        return session_model_override

    if agent_primary_model and agent_primary_model in available:
        return agent_primary_model

    for fallback in agent_fallback_models:
        if fallback in available:
            return fallback

    if org_default_model and org_default_model in available:
        return org_default_model

    raise ValidationError(
        "model",
        "No model could be resolved. Check the agent's model settings or the "
        "organization's default chat model.",
    )


async def resolve_provider_and_model(
    session: AsyncSession,
    provider_ops,
    *,
    organization_id: UUID,
    agent: Agent,
    model_override: str | None = None,
) -> tuple[LLMProvider, UUID, str]:
    """Resolve (provider client, provider key id, model) for any agent run.

    Single choke point for sends, compaction, context stats, and background
    analysis, so a name-only agent inheriting the org runtime default resolves
    identically everywhere. The org settings read only happens when the agent
    itself cannot determine a provider, keeping the configured-agent hot path
    a single round trip.
    """
    key_id = agent.primary_provider_key_id
    primary = agent.primary_model or ""
    fallbacks = [m for m in (agent.fallback_models or []) if m]
    target_model = model_override or primary

    provider: LLMProvider | None = None
    pk = None
    org_default_model: str | None = None

    if key_id:
        provider, pk = await provider_ops.get_provider_for_key(
            organization_id=organization_id,
            key_id=key_id,
        )
        if not target_model:
            settings = await get_runtime_settings(session, organization_id)
            org_default_model = settings.default_chat_model
    elif target_model:
        resolved = await provider_ops.get_key_and_provider_for_model(
            organization_id=organization_id,
            model_id=target_model,
        )
        if resolved is None:
            raise NotFoundError(
                "ProviderKey",
                f"No configured provider has model '{target_model}' available",
            )
        provider, pk = resolved
    else:
        # Agent fallbacks outrank the org default, so try to source a provider
        # from them before consulting the org tier.
        for fallback in fallbacks:
            resolved = await provider_ops.get_key_and_provider_for_model(
                organization_id=organization_id,
                model_id=fallback,
            )
            if resolved is not None:
                provider, pk = resolved
                break
        if provider is None:
            settings = await get_runtime_settings(session, organization_id)
            org_default_model = settings.default_chat_model
            if settings.default_provider_key_id:
                try:
                    provider, pk = await provider_ops.get_provider_for_key(
                        organization_id=organization_id,
                        key_id=settings.default_provider_key_id,
                    )
                except NotFoundError as exc:
                    raise ValidationError(
                        "model",
                        "The organization's default provider key is missing, "
                        "invalid, or disabled. An admin can update it on the "
                        "admin agents page.",
                    ) from exc
            elif org_default_model:
                resolved = await provider_ops.get_key_and_provider_for_model(
                    organization_id=organization_id,
                    model_id=org_default_model,
                )
                if resolved is None:
                    raise ValidationError(
                        "model",
                        "No enabled provider key serves the organization's "
                        "default chat model. An admin can update it on the "
                        "admin agents page.",
                    )
                provider, pk = resolved
            else:
                raise ValidationError(
                    "model",
                    "This agent has no model configured and the organization has "
                    "no default chat model. An admin can set a default provider "
                    "key and model on the admin agents page.",
                )

    model = await resolve_model(
        session_model_override=model_override,
        agent_primary_model=primary,
        agent_fallback_models=fallbacks,
        provider=provider,
        org_default_model=org_default_model,
    )
    return provider, pk.id, model
