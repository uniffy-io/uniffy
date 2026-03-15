"""Model resolution logic for agent runtime."""

from uniffy.core.errors import ValidationError
from uniffy.domains.agents.providers.base import LLMProvider


async def resolve_model(
    *,
    session_model_override: str | None,
    agent_primary_model: str,
    agent_fallback_models: list[str],
    provider: LLMProvider,
) -> str:
    """Resolve which model to use for a completion request.

    Resolution priority:
    1. Per-session model override (if set and available)
    2. Agent's primary model
    3. First available from agent's fallback models
    4. First available from provider's model catalog

    Parameters
    ----------
    session_model_override : str | None
        Per-session model override from session config.
    agent_primary_model : str
        Agent's configured primary model.
    agent_fallback_models : list[str]
        Agent's ordered fallback model list.
    provider : LLMProvider
        The LLM provider instance.

    Returns
    -------
    str
        Resolved model identifier.

    Raises
    ------
    ValidationError
        If no model can be resolved.

    """
    available_models = await provider.get_available_models()
    available = {m.id for m in available_models}

    # 1. Per-session override
    if session_model_override and session_model_override in available:
        return session_model_override

    # 2. Agent's primary model
    if agent_primary_model in available:
        return agent_primary_model

    # 3. First available fallback
    for fallback in agent_fallback_models:
        if fallback in available:
            return fallback

    # 4. First available from catalog
    if available_models:
        return available_models[0].id

    raise ValidationError(
        "model",
        "No model could be resolved. Check provider configuration and agent model settings.",
    )
