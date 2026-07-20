"""OpenRouter LLM provider - the OpenAI-compatible API on openrouter.ai."""

import asyncio

import openai
from loguru import logger
from pyqwest import Client

from uniffy.domains.agents.providers.base import ModelInfo
from uniffy.domains.agents.providers.catalog import model_infos_for_provider
from uniffy.domains.agents.providers.openai.provider import OpenAIProvider

logger = logger.bind(component="agents.providers.openrouter")

KEY_INFO_URL = "https://openrouter.ai/api/v1/key"
REQUEST_TIMEOUT_SECONDS = 10.0


class OpenRouterProvider(OpenAIProvider):
    """OpenAI SDK client pointed at openrouter.ai; completion handling is inherited."""

    _use_responses_api = False

    def __init__(self, credential: str, credential_type: str = "api_key") -> None:
        self._credential_type = credential_type
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

    async def get_available_models(
        self,
        *,
        force_refresh: bool = False,
    ) -> list[ModelInfo]:
        return model_infos_for_provider("openrouter")

    def _apply_reasoning(self, kwargs: dict, effort: str) -> None:
        """OpenRouter's unified ``reasoning`` object rides in extra_body.

        Effort levels pass through; "on" (models that expose reasoning
        without effort control) maps to a bare enable.
        """
        if effort == "off":
            return
        reasoning = {"enabled": True} if effort == "on" else {"effort": effort}
        kwargs["extra_body"] = {**kwargs.get("extra_body", {}), "reasoning": reasoning}
