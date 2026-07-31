"""Tests for the OpenAI-compatible OpenRouter and xAI providers.

Registry dispatch, base URL wiring, and the live-probe validate path.
No network calls; HTTP goes through a mocked client where needed.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import ValidationError
from uniffy.domains.agents.providers.base import ProviderDescriptor
from uniffy.domains.agents.providers.openrouter.provider import OpenRouterProvider
from uniffy.domains.agents.providers.registry import get_provider_registry

OPENROUTER_KEY = "sk-or-v1-0123456789abcdef"
XAI_KEY = "xai-0123456789abcdef1234"


class TestProviderRegistry:
    def test_create_openrouter_provider(self) -> None:
        provider = get_provider_registry().create_provider("openrouter", OPENROUTER_KEY)
        assert provider.name == "openrouter"
        assert "openrouter.ai/api/v1" in str(provider._client.base_url)

    def test_create_xai_provider(self) -> None:
        provider = get_provider_registry().create_provider("xai", XAI_KEY)
        assert provider.name == "xai"
        assert "api.x.ai/v1" in str(provider._client.base_url)

    def test_unknown_provider_raises(self) -> None:
        with pytest.raises(ValidationError):
            get_provider_registry().create_provider("nope", "key")

    def test_all_providers_registered(self) -> None:
        names = {d.name for d in get_provider_registry().list_providers()}
        assert {"anthropic", "openai", "google", "openrouter", "xai"} <= names


class TestCredentialFormatIsNotChecked:
    """Key shapes are the provider's business; only the live probe judges a key."""

    def test_registry_accepts_any_credential_shape(self) -> None:
        provider = get_provider_registry().create_provider("openrouter", XAI_KEY)
        assert provider.name == "openrouter"

    def test_require_known_rejects_only_unknown_providers(self) -> None:
        registry = get_provider_registry()
        registry.require_known("xai")
        with pytest.raises(ValidationError):
            registry.require_known("nope")


def _stub_key_endpoint(provider: OpenRouterProvider, status: int) -> AsyncMock:
    response = MagicMock()
    response.status = status
    provider._http = MagicMock()
    provider._http.get = AsyncMock(return_value=response)
    return provider._http.get


class TestOpenRouterValidate:
    async def test_valid_key(self) -> None:
        provider = OpenRouterProvider(OPENROUTER_KEY)
        get = _stub_key_endpoint(provider, 200)
        result = await provider.validate()
        assert result == (True, None)
        assert get.call_args.args[0] == "https://openrouter.ai/api/v1/key"
        headers = get.call_args.kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {OPENROUTER_KEY}"

    async def test_invalid_key(self) -> None:
        provider = OpenRouterProvider(OPENROUTER_KEY)
        _stub_key_endpoint(provider, 401)
        valid, message = await provider.validate()
        assert valid is False
        assert message

    async def test_rate_limited_key_is_valid(self) -> None:
        provider = OpenRouterProvider(OPENROUTER_KEY)
        _stub_key_endpoint(provider, 429)
        result = await provider.validate()
        assert result == (True, None)


class TestDescriptors:
    def _descriptor(self, name: str) -> ProviderDescriptor:
        return next(
            d for d in get_provider_registry().list_providers() if d.name == name
        )

    def test_openrouter_descriptor(self) -> None:
        descriptor = self._descriptor("openrouter")
        models = descriptor.get_models()
        assert models
        assert all(m.provider == "openrouter" for m in models)

    def test_xai_descriptor(self) -> None:
        descriptor = self._descriptor("xai")
        models = descriptor.get_models()
        assert models
        assert all(m.provider == "xai" for m in models)
