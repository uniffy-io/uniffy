"""Google Gemini LLM provider implementation using the google-genai SDK."""

import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

from google import genai
from google.genai import types
from loguru import logger

from uniffy.domains.agents.providers.base import (
    CompletionResult,
    DoneEvent,
    ErrorEvent,
    LLMProvider,
    ModelInfo,
    StreamEvent,
    TokenEvent,
    ToolCall,
    ToolCallEvent,
)
from uniffy.domains.agents.providers.google.catalog import (
    FALLBACK_MODELS,
    get_capabilities,
)
from uniffy.domains.agents.providers.google.converters import (
    convert_messages_to_google,
    convert_tools_to_google,
)

# Module-level cache for the model list fetched from the Google AI API.
_MODEL_CACHE_TTL_SECONDS = 3600  # 1 hour
_cached_models: list[ModelInfo] | None = None
_cache_timestamp: float = 0.0


class GoogleProvider(LLMProvider):
    """Google Gemini provider using the google-genai Python SDK.

    Parameters
    ----------
    credential : str
        Google AI API key.
    credential_type : str
        Must be "api_key".

    """

    def __init__(self, credential: str, credential_type: str = "api_key") -> None:
        self._credential_type = credential_type
        self._client = genai.Client(api_key=credential)

    async def validate(self) -> tuple[bool, str | None]:
        """Validate the credential against the Google AI API.

        Uses the models.list endpoint to verify the API key is valid.

        Returns
        -------
        tuple[bool, str | None]
            (True, None) if valid, (False, error_message) otherwise.

        """
        try:
            _pager = await self._client.aio.models.list(
                config={"page_size": 1},
            )
            return True, None
        except Exception as e:
            error_str = str(e).lower()
            if "api key" in error_str or "unauthorized" in error_str or "403" in error_str:
                return False, f"Authentication failed: {e}"
            if "429" in error_str or "rate" in error_str:
                logger.warning(f"Rate limited during validation: {e}")
                return True, None
            return False, f"Validation error: {e}"

    async def generate_image(
        self,
        prompt: str,
        *,
        model: str,
        size: str = "1024x1024",
        quality: str = "auto",
    ) -> tuple[bytes, str]:
        """Generate an image using a Google model.

        Supports two generation paths:

        - **Gemini models** (e.g. ``gemini-2.0-flash-exp``,
          ``gemini-2.5-flash-image``) use ``generate_content`` with
          ``response_modalities=["IMAGE"]``.
        - **Imagen models** (e.g. ``imagen-3.0-generate-002``) use
          the dedicated ``generate_images`` API.

        Parameters
        ----------
        prompt : str
            Text description of the desired image.
        model : str
            Model identifier.
        size : str
            Image dimensions (e.g. "1024x1024").
        quality : str
            Image quality setting (kept for interface compatibility).

        Returns
        -------
        tuple[bytes, str]
            (image_bytes, mime_type).

        """
        if model.startswith("imagen"):
            return await self._generate_image_imagen(prompt, model=model, size=size)
        return await self._generate_image_gemini(prompt, model=model, size=size)

    async def _generate_image_gemini(
        self,
        prompt: str,
        *,
        model: str,
        size: str,
    ) -> tuple[bytes, str]:
        """Generate an image via Gemini's native image output.

        Uses ``generate_content`` with ``response_modalities=["IMAGE"]``.

        """
        aspect_ratio_map = {
            "1024x1024": "1:1",
            "1536x1024": "3:2",
            "1024x1536": "2:3",
        }
        aspect_ratio = aspect_ratio_map.get(size, "1:1")

        config = types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            image_config=types.ImageConfig(
                aspect_ratio=aspect_ratio,
            ),
        )

        response = await self._client.aio.models.generate_content(
            model=model,
            contents=prompt,
            config=config,
        )

        if not response.candidates or not response.candidates[0].content:
            raise RuntimeError("Google Gemini returned no image content")

        for part in response.candidates[0].content.parts or []:
            if part.inline_data and part.inline_data.data:
                mime_type = part.inline_data.mime_type or "image/png"
                return bytes(part.inline_data.data), mime_type

        raise RuntimeError("Google Gemini response contained no image data")

    async def _generate_image_imagen(
        self,
        prompt: str,
        *,
        model: str,
        size: str,
    ) -> tuple[bytes, str]:
        """Generate an image via the Imagen API.

        Uses the dedicated ``generate_images`` endpoint.

        """
        aspect_ratio_map = {
            "1024x1024": "1:1",
            "1536x1024": "3:2",
            "1024x1536": "2:3",
        }
        aspect_ratio = aspect_ratio_map.get(size, "1:1")

        config = types.GenerateImagesConfig(
            numberOfImages=1,
            aspectRatio=aspect_ratio,
            outputMimeType="image/png",
        )

        response = await self._client.aio.models.generate_images(
            model=model,
            prompt=prompt,
            config=config,
        )

        if not response.generated_images:
            raise RuntimeError("Google Imagen returned no images")

        image = response.generated_images[0].image
        if not image or not image.image_bytes:
            raise RuntimeError("Google Imagen returned an empty image")

        mime_type = image.mime_type or "image/png"
        return bytes(image.image_bytes), mime_type

    async def chat_completion(
        self,
        messages: list[dict],
        model: str,
        *,
        system: str | None = None,
        tools: list[dict] | None = None,
        stream: bool = False,
        cache_key: str | None = None,
    ) -> CompletionResult | AsyncIterator[StreamEvent]:
        """Send a chat completion request to the Google Gemini API.

        Converts messages and tools from Anthropic format to Google format,
        sends the request, and converts the response back.

        Caching: Gemini 2.5+ implicit caching activates automatically
        on stable prefixes >= 1024 tokens (Flash) / 2048 tokens (Pro).
        We don't pass a cache key -- Gemini does not expose a routing
        knob the way OpenAI's ``prompt_cache_key`` does. Older models
        (``gemini-2.0-*`` and below) have no implicit caching at all
        and ``cached_content_token_count`` always reports 0. Explicit
        caching via ``CachedContent`` is unusable for our agent
        runtime because the API rejects it when ``system_instruction``,
        ``tools``, or ``tool_config`` are set on the request.

        Known bug: implicit caching has been reported to silently fail
        on Gemini 3 Flash Preview when ``tools`` are defined --
        ``cached_content_token_count`` stays 0 even on identical
        prefixes well above the token threshold. Track at
        https://github.com/vercel/ai/issues/11513. No client-side
        workaround beyond switching models.

        Parameters
        ----------
        messages : list[dict]
            Messages in Anthropic format.
        model : str
            Model identifier (e.g. "gemini-2.5-flash").
        system : str | None
            System prompt (passed as system_instruction).
        tools : list[dict] | None
            Tool definitions in Anthropic format.
        stream : bool
            Whether to stream the response.
        cache_key : str | None
            Accepted for interface symmetry; ignored. Google's
            implicit cache routes by prefix hash internally.

        Returns
        -------
        CompletionResult | AsyncIterator[StreamEvent]
            Result or streaming iterator.

        """
        del cache_key  # Google ignores; see docstring.
        google_contents = convert_messages_to_google(messages)
        config = self._build_config(
            system=system,
            tools=tools,
        )

        if stream:
            return self._stream_completion(model, google_contents, config)

        return await self._sync_completion(model, google_contents, config)

    async def get_available_models(
        self,
        *,
        force_refresh: bool = False,
    ) -> list[ModelInfo]:
        """Return available Google Gemini models, fetched from the API.

        Calls ``models.list()`` to discover currently available models,
        then enriches each entry with capability metadata from the static
        overlay map.  Results are cached for one hour.

        Parameters
        ----------
        force_refresh : bool
            When True, bypass the cache and fetch fresh from the API.

        Returns
        -------
        list[ModelInfo]
            Available Google Gemini models.

        """
        global _cached_models, _cache_timestamp

        if not force_refresh:
            cache_age = time.monotonic() - _cache_timestamp
            if _cached_models is not None and cache_age < _MODEL_CACHE_TTL_SECONDS:
                logger.debug(
                    f"Returning cached Google models "
                    f"({len(_cached_models)} models, "
                    f"age={cache_age:.0f}s)",
                )
                return list(_cached_models)
        else:
            logger.debug("Force-refreshing Google model list")

        logger.debug("Fetching model list from Google AI API")
        try:
            models: list[ModelInfo] = []
            async for api_model in await self._client.aio.models.list(
                config={"page_size": 100},
            ):
                model_id = api_model.name or ""
                clean_id = model_id.removeprefix("models/")

                if not clean_id.startswith("gemini"):
                    continue

                caps = get_capabilities(clean_id)
                display_name = api_model.display_name or self._format_display_name(clean_id)
                models.append(
                    ModelInfo(
                        id=clean_id,
                        display_name=display_name,
                        provider="google",
                        context_window=caps.context_window,
                        supports_tools=caps.supports_tools,
                        supports_vision=caps.supports_vision,
                        supports_thinking=caps.supports_thinking,
                    )
                )

            logger.debug(
                f"Google AI API returned {len(models)} Gemini models",
            )

            if models:
                _cached_models = models
                _cache_timestamp = time.monotonic()
                return list(models)

            logger.warning(
                "Google AI API returned 0 Gemini models, using fallback catalog",
            )
        except Exception as e:
            logger.warning(
                f"Failed to fetch Google model list, using fallback catalog: {e}",
            )

        return list(FALLBACK_MODELS)

    def _build_config(
        self,
        *,
        system: str | None,
        tools: list[dict] | None,
    ) -> types.GenerateContentConfig:
        """Build the GenerateContentConfig for the API call.

        Parameters
        ----------
        system : str | None
            System prompt.
        tools : list[dict] | None
            Tool definitions in Anthropic format.

        Returns
        -------
        types.GenerateContentConfig
            Config for the generate_content call.

        """
        config_kwargs: dict[str, Any] = {}

        if system:
            config_kwargs["system_instruction"] = system

        if tools:
            config_kwargs["tools"] = convert_tools_to_google(tools)
            config_kwargs["automatic_function_calling"] = types.AutomaticFunctionCallingConfig(
                disable=True,
            )

        return types.GenerateContentConfig(**config_kwargs)

    async def _sync_completion(
        self,
        model: str,
        contents: list[types.Content],
        config: types.GenerateContentConfig,
    ) -> CompletionResult:
        """Execute a non-streaming completion.

        Parameters
        ----------
        model : str
            Model identifier.
        contents : list[types.Content]
            Conversation contents in Google format.
        config : types.GenerateContentConfig
            Generation config.

        Returns
        -------
        CompletionResult
            The completion result.

        """
        response = await self._client.aio.models.generate_content(
            model=model,
            contents=contents,
            config=config,
        )

        content = ""
        tool_calls: list[ToolCall] = []

        if response.candidates:
            candidate = response.candidates[0]
            if candidate.content and candidate.content.parts:
                for part in candidate.content.parts:
                    if part.text:
                        content += part.text
                    elif part.function_call:
                        tc_id = f"toolu_{uuid.uuid4().hex[:24]}"
                        fc_args = part.function_call.args
                        tc_metadata: dict = {}
                        if part.thought_signature:
                            tc_metadata["thought_signature"] = part.thought_signature
                        tool_calls.append(
                            ToolCall(
                                id=tc_id,
                                name=part.function_call.name or "",
                                input=dict(fc_args) if fc_args else {},
                                metadata=tc_metadata,
                            )
                        )

        stop_reason = self._determine_stop_reason(response, tool_calls)

        prompt_tokens, cached_tokens, output_tokens = _split_google_usage(
            response.usage_metadata
        )

        return CompletionResult(
            content=content,
            model=model,
            input_tokens=prompt_tokens - cached_tokens,
            output_tokens=output_tokens,
            cache_read_input_tokens=cached_tokens,
            tool_calls=tool_calls,
            stop_reason=stop_reason,
        )

    async def _stream_completion(
        self,
        model: str,
        contents: list[types.Content],
        config: types.GenerateContentConfig,
    ) -> AsyncIterator[StreamEvent]:
        """Execute a streaming completion.

        Parameters
        ----------
        model : str
            Model identifier.
        contents : list[types.Content]
            Conversation contents in Google format.
        config : types.GenerateContentConfig
            Generation config.

        Yields
        ------
        StreamEvent
            Stream events as they arrive.

        """
        try:
            accumulated_content = ""
            tool_calls: list[ToolCall] = []
            prompt_tokens = 0
            cached_tokens = 0
            output_tokens = 0

            stream = await self._client.aio.models.generate_content_stream(
                model=model,
                contents=contents,
                config=config,
            )
            async for chunk in stream:
                if chunk.usage_metadata:
                    prompt_tokens, cached_tokens, output_tokens = _split_google_usage(
                        chunk.usage_metadata
                    )

                if not chunk.candidates:
                    continue

                candidate = chunk.candidates[0]
                if not candidate.content or not candidate.content.parts:
                    continue

                for part in candidate.content.parts:
                    if part.text:
                        accumulated_content += part.text
                        yield TokenEvent(text=part.text)
                    elif part.function_call:
                        tc_id = f"toolu_{uuid.uuid4().hex[:24]}"
                        fc_args = part.function_call.args
                        tc_metadata: dict = {}
                        if part.thought_signature:
                            tc_metadata["thought_signature"] = part.thought_signature
                        tc = ToolCall(
                            id=tc_id,
                            name=part.function_call.name or "",
                            input=dict(fc_args) if fc_args else {},
                            metadata=tc_metadata,
                        )
                        tool_calls.append(tc)
                        yield ToolCallEvent(tool_call=tc)

            stop_reason = "tool_use" if tool_calls else "end_turn"

            yield DoneEvent(
                result=CompletionResult(
                    content=accumulated_content,
                    model=model,
                    input_tokens=prompt_tokens - cached_tokens,
                    output_tokens=output_tokens,
                    cache_read_input_tokens=cached_tokens,
                    tool_calls=tool_calls,
                    stop_reason=stop_reason,
                )
            )
        except Exception as e:
            logger.error(f"Google streaming error: {e}")
            yield ErrorEvent(error=str(e))


def _split_google_usage(usage_metadata) -> tuple[int, int, int]:
    """Return ``(prompt_tokens, cached_tokens, candidates_tokens)``.

    Gemini 2.5 Flash and Pro auto-cache common prefixes (implicit
    caching). The cached portion is reported under
    ``usage_metadata.cached_content_token_count`` and is a subset of
    ``prompt_token_count``. Splitting here lets the runtime store
    cache hits in the same shape used for Anthropic / OpenAI:
    ``input_tokens`` = uncached input, ``cache_read_input_tokens`` =
    cached subset.

    Returns zeros when ``usage_metadata`` is missing (older models /
    failed responses) or the cache field is absent.
    """
    if usage_metadata is None:
        return 0, 0, 0
    prompt_tokens = int(getattr(usage_metadata, "prompt_token_count", 0) or 0)
    candidates_tokens = int(getattr(usage_metadata, "candidates_token_count", 0) or 0)
    cached_tokens = int(getattr(usage_metadata, "cached_content_token_count", 0) or 0)
    cached_tokens = min(cached_tokens, prompt_tokens)
    return prompt_tokens, cached_tokens, candidates_tokens

    @staticmethod
    def _determine_stop_reason(response: Any, tool_calls: list[ToolCall]) -> str:
        """Determine the stop reason from the response.

        Parameters
        ----------
        response : Any
            The generate_content response.
        tool_calls : list[ToolCall]
            Extracted tool calls.

        Returns
        -------
        str
            Stop reason ("end_turn", "tool_use", "max_tokens").

        """
        if tool_calls:
            return "tool_use"
        if response.candidates:
            finish = response.candidates[0].finish_reason
            if finish and str(finish) == "MAX_TOKENS":
                return "max_tokens"
        return "end_turn"

    @staticmethod
    def _format_display_name(model_id: str) -> str:
        """Format a model ID into a human-readable display name.

        Parameters
        ----------
        model_id : str
            Model identifier.

        Returns
        -------
        str
            Formatted display name.

        """
        known_names: dict[str, str] = {
            "gemini-2.5-pro": "Gemini 2.5 Pro",
            "gemini-2.5-flash": "Gemini 2.5 Flash",
            "gemini-2.0-flash": "Gemini 2.0 Flash",
            "gemini-1.5-pro": "Gemini 1.5 Pro",
            "gemini-1.5-flash": "Gemini 1.5 Flash",
        }
        for prefix, name in known_names.items():
            if model_id == prefix or model_id.startswith(prefix + "-"):
                if model_id == prefix:
                    return name
                suffix = model_id[len(prefix) :]
                return f"{name} ({suffix.lstrip('-')})"
        return model_id
