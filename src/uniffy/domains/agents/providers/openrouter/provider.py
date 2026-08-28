"""OpenRouter LLM provider - the OpenAI-compatible API on openrouter.ai."""

import asyncio
from decimal import Decimal, InvalidOperation
from typing import Any

import openai
from loguru import logger
from pyqwest import Client

from uniffy.domains.agents.providers.base import ModelInfo
from uniffy.domains.agents.providers.catalog import (
    ReasoningControl,
    get_model,
    model_infos_for_provider,
)
from uniffy.domains.agents.providers.openai.provider import OpenAIProvider

logger = logger.bind(component="agents.providers.openrouter.provider")

KEY_INFO_URL = "https://openrouter.ai/api/v1/key"
REQUEST_TIMEOUT_SECONDS = 10.0


class OpenRouterProvider(OpenAIProvider):
    """OpenAI SDK client pointed at openrouter.ai; completion handling is inherited."""

    _use_responses_api = False

    def __init__(self, credential: str) -> None:
        self._client = openai.AsyncOpenAI(
            api_key=credential,
            base_url="https://openrouter.ai/api/v1",
        )
        self._http = Client()

    @property
    def name(self) -> str:
        """Catalog provider key, used for pricing lookups."""
        return "openrouter"

    async def validate(self) -> tuple[bool, str | None]:
        """The models list is public on OpenRouter; only the key endpoint proves the credential."""
        try:
            response = await asyncio.wait_for(
                self._http.get(
                    KEY_INFO_URL,
                    headers={"Authorization": f"Bearer {self._client.api_key}"},
                ),
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except Exception as e:
            return False, f"Validation error: {e}"
        if response.status == 401:
            return False, f"Authentication failed: HTTP {response.status}"
        if response.status == 403:
            return False, f"Permission denied: HTTP {response.status}"
        if response.status == 429:
            # Rate limited but credentials are valid
            logger.warning("Rate limited during validation")
            return True, None
        if response.status >= 400:
            return False, f"Validation error: HTTP {response.status}"
        return True, None

    async def get_available_models(self) -> list[ModelInfo]:
        return model_infos_for_provider("openrouter")

    def _should_use_responses_api(self, model: str) -> bool:
        catalog_model = get_model("openrouter", model)
        return bool(catalog_model and catalog_model.use_responses_api)

    def _provider_cost_usd(self, usage: Any) -> Decimal | None:
        raw_cost = getattr(usage, "cost", None)
        if raw_cost is None:
            return None
        try:
            cost = Decimal(str(raw_cost))
        except InvalidOperation, TypeError, ValueError:
            logger.warning(f"Ignoring invalid OpenRouter usage cost: {raw_cost!r}")
            return None
        if not cost.is_finite() or cost < 0:
            logger.warning(f"Ignoring invalid OpenRouter usage cost: {raw_cost!r}")
            return None
        return cost

    def _apply_reasoning(self, kwargs: dict, effort: str) -> None:
        """OpenRouter's unified ``reasoning`` object rides in extra_body.

        Effort levels pass through; "on" (models that expose reasoning
        without effort control) maps to a bare enable.
        """
        if effort == ReasoningControl.OFF:
            return
        reasoning = {"enabled": True} if effort == ReasoningControl.ON else {"effort": effort}
        kwargs["extra_body"] = {**kwargs.get("extra_body", {}), "reasoning": reasoning}
