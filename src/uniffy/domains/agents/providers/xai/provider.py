"""xAI LLM provider - the OpenAI-compatible API on api.x.ai."""

import openai
from loguru import logger

from uniffy.domains.agents.providers.base import ModelInfo
from uniffy.domains.agents.providers.catalog import model_infos_for_provider
from uniffy.domains.agents.providers.openai.provider import OpenAIProvider

logger = logger.bind(component="agents.providers.xai")


class XAIProvider(OpenAIProvider):
    """OpenAI SDK client pointed at api.x.ai; completion handling is inherited."""

    _use_responses_api = False

    def __init__(self, credential: str, credential_type: str = "api_key") -> None:
        self._credential_type = credential_type
        self._client = openai.AsyncOpenAI(
            api_key=credential,
            base_url="https://api.x.ai/v1",
        )

    @property
    def name(self) -> str:
        """Catalog provider key, used for pricing lookups."""
        return "xai"

    async def get_available_models(
        self,
        *,
        force_refresh: bool = False,
    ) -> list[ModelInfo]:
        return model_infos_for_provider("xai")

    def _apply_reasoning(self, kwargs: dict, effort: str) -> None:
        """Grok 4+ always reasons and rejects ``reasoning_effort``; send nothing."""
