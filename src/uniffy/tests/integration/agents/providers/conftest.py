"""LLM-provider fixtures: one live provider per registered descriptor.

A provider whose key is absent from the environment (or the repo-root
``.env``, loaded by the parent conftest) is skipped, not failed.
"""

import os

import pytest

PROVIDER_ENV_KEYS = {
    "anthropic": "CLAUDE_API_KEY",
    "openai": "OPENAI_API_KEY",
    "google": "GOOGLE_GENAI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "xai": "XAI_API_KEY",
}

# Cheapest sensible model per provider; override any of them with
# UNIFFY_ITEST_MODEL_<PROVIDER>.
DEFAULT_MODELS = {
    "anthropic": "claude-haiku-4-5-20251001",
    "openai": "gpt-5.4-mini",
    "google": "gemini-3.5-flash",
    "openrouter": "openai/gpt-5.4-mini",
    "xai": "grok-4.3",
}


@pytest.fixture(params=sorted(PROVIDER_ENV_KEYS))
def live_provider(request):
    """(name, LLMProvider, model) for every provider whose key is present."""
    from uniffy.domains.agents.providers.registry import get_provider_registry

    name = request.param
    env_key = PROVIDER_ENV_KEYS[name]
    credential = os.environ.get(env_key, "").strip()
    if not credential:
        pytest.skip(f"{env_key} not set")
    provider = get_provider_registry().create_provider(name, credential)
    model = os.environ.get(f"UNIFFY_ITEST_MODEL_{name.upper()}", DEFAULT_MODELS[name])
    return name, provider, model
