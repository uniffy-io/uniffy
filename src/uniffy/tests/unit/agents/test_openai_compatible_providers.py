"""Tests for the OpenAI-compatible OpenRouter and xAI providers.

Registry dispatch, base URL wiring, and the live-probe validate path.
No network calls; HTTP goes through a mocked client where needed.
"""

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

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


class TestOpenRouterEndpoints:
    async def test_only_fusion_streams_over_responses_api(self) -> None:
        provider = OpenRouterProvider(OPENROUTER_KEY)
        responses_stream = object()
        chat_stream = object()
        provider._stream_completion = MagicMock(return_value=chat_stream)

        with patch(
            "uniffy.domains.agents.providers.openai.provider.stream_completion",
            return_value=responses_stream,
        ) as stream_completion:
            fusion = await provider.chat_completion(
                [{"role": "user", "content": "compare these approaches"}],
                "openrouter/fusion",
                stream=True,
            )
            regular = await provider.chat_completion(
                [{"role": "user", "content": "hello"}],
                "google/gemini-3.7-flash",
                stream=True,
            )

        assert fusion is responses_stream
        assert regular is chat_stream
        responses_kwargs = stream_completion.call_args.args[1]
        assert responses_kwargs["model"] == "openrouter/fusion"
        assert responses_kwargs["store"] is False
        provider._stream_completion.assert_called_once()

    def test_usage_cost_parser_accepts_only_non_negative_finite_values(self) -> None:
        provider = OpenRouterProvider(OPENROUTER_KEY)

        assert provider._provider_cost_usd(SimpleNamespace(cost="0.001234")) == Decimal(
            "0.001234"
        )
        assert provider._provider_cost_usd(SimpleNamespace(cost=0)) == Decimal(0)
        assert provider._provider_cost_usd(SimpleNamespace(cost=-1)) is None
        assert provider._provider_cost_usd(SimpleNamespace(cost="NaN")) is None
        assert provider._provider_cost_usd(SimpleNamespace()) is None

    async def test_chat_completion_captures_provider_cost(self) -> None:
        provider = OpenRouterProvider(OPENROUTER_KEY)
        response = SimpleNamespace(
            model="x-ai/grok-4.5",
            choices=[
                SimpleNamespace(
                    finish_reason="stop",
                    message=SimpleNamespace(content="done", refusal=None, tool_calls=None),
                )
            ],
            usage=SimpleNamespace(
                prompt_tokens=10,
                completion_tokens=2,
                prompt_tokens_details=None,
                cost="0.000456",
            ),
        )

        async def _create(**kwargs):
            return response

        provider._client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=_create))
        )

        result = await provider.chat_completion(
            [{"role": "user", "content": "hello"}],
            "~x-ai/grok-latest",
        )

        assert result.provider_cost_usd == Decimal("0.000456")


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
