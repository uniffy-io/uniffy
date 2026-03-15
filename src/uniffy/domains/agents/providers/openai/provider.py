"""OpenAI LLM provider implementation using the official SDK."""

import base64
import json
import time
from collections.abc import AsyncIterator
from typing import Any

import openai
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
from uniffy.domains.agents.providers.openai.catalog import (
    FALLBACK_MODELS,
    format_display_name,
    get_capabilities,
    map_finish_reason,
)
from uniffy.domains.agents.providers.openai.converters import (
    convert_messages_to_openai,
    convert_tools_to_openai,
)

# Module-level cache for the model list fetched from the OpenAI API.
_MODEL_CACHE_TTL_SECONDS = 3600  # 1 hour
_cached_models: list[ModelInfo] | None = None
_cache_timestamp: float = 0.0


class OpenAIProvider(LLMProvider):
    """OpenAI provider using the official Python SDK.

    Parameters
    ----------
    credential : str
        OpenAI API key.
    credential_type : str
        Must be "api_key".

    """

    def __init__(self, credential: str, credential_type: str = "api_key") -> None:
        self._credential_type = credential_type
        self._client = openai.AsyncOpenAI(api_key=credential)

    async def validate(self) -> tuple[bool, str | None]:
        """Validate the credential against the OpenAI API.

        Uses the models.list endpoint to verify the API key is valid.

        Returns
        -------
        tuple[bool, str | None]
            (True, None) if valid, (False, error_message) otherwise.

        """
        try:
            await self._client.models.list()
            return True, None
        except openai.AuthenticationError as e:
            return False, f"Authentication failed: {e}"
        except openai.PermissionDeniedError as e:
            return False, f"Permission denied: {e}"
        except openai.RateLimitError as e:
            # Rate limited but credentials are valid
            logger.warning(f"Rate limited during validation: {e}")
            return True, None
        except Exception as e:
            return False, f"Validation error: {e}"

    async def generate_image(
        self,
        prompt: str,
        *,
        model: str,
        size: str = "1024x1024",
        quality: str = "auto",
    ) -> tuple[bytes, str]:
        """Generate an image using OpenAI's image generation API.

        Parameters
        ----------
        prompt : str
            Text description of the desired image.
        model : str
            Image model identifier (e.g. "gpt-image-1", "dall-e-3").
        size : str
            Image dimensions (e.g. "1024x1024").
        quality : str
            Image quality setting.

        Returns
        -------
        tuple[bytes, str]
            (image_bytes, mime_type).

        """
        # dall-e models use 'standard'/'hd'; gpt-image models use 'auto'/'high'/'low'
        if model.startswith("dall-e"):
            quality_map = {"auto": "standard", "high": "hd", "low": "standard"}
            quality = quality_map.get(quality, quality)

        response = await self._client.images.generate(
            prompt=prompt,
            model=model,
            response_format="b64_json",
            size=size,
            quality=quality,
        )
        b64_data = response.data[0].b64_json
        image_bytes = base64.b64decode(b64_data)
        # gpt-image-1 returns PNG, dall-e-3 returns PNG
        return image_bytes, "image/png"

    async def chat_completion(
        self,
        messages: list[dict],
        model: str,
        *,
        system: str | None = None,
        tools: list[dict] | None = None,
        stream: bool = False,
    ) -> CompletionResult | AsyncIterator[StreamEvent]:
        """Send a chat completion request to the OpenAI API.

        Converts messages and tools from Anthropic format to OpenAI format,
        sends the request, and converts the response back.

        Parameters
        ----------
        messages : list[dict]
            Messages in Anthropic format.
        model : str
            Model identifier (e.g. "gpt-4o").
        system : str | None
            System prompt (injected as a system message).
        tools : list[dict] | None
            Tool definitions in Anthropic format.
        stream : bool
            Whether to stream the response.

        Returns
        -------
        CompletionResult | AsyncIterator[StreamEvent]
            Result or streaming iterator.

        """
        kwargs = self._build_request_kwargs(
            messages=messages,
            model=model,
            system=system,
            tools=tools,
        )

        if stream:
            return self._stream_completion(**kwargs)

        return await self._sync_completion(**kwargs)

    async def get_available_models(
        self,
        *,
        force_refresh: bool = False,
    ) -> list[ModelInfo]:
        """Return available OpenAI models, fetched from the API.

        Calls ``models.list()`` to discover currently available models,
        filters to chat-capable models, and enriches with capability metadata.
        Results are cached for one hour.

        Parameters
        ----------
        force_refresh : bool
            When True, bypass the cache and fetch fresh from the API.

        Returns
        -------
        list[ModelInfo]
            Available OpenAI models.

        """
        global _cached_models, _cache_timestamp

        if not force_refresh:
            cache_age = time.monotonic() - _cache_timestamp
            if _cached_models is not None and cache_age < _MODEL_CACHE_TTL_SECONDS:
                logger.debug(
                    f"Returning cached OpenAI models "
                    f"({len(_cached_models)} models, "
                    f"age={cache_age:.0f}s)",
                )
                return list(_cached_models)
        else:
            logger.debug("Force-refreshing OpenAI model list")

        logger.debug("Fetching model list from OpenAI API")
        try:
            models: list[ModelInfo] = []
            response = await self._client.models.list()
            for api_model in response.data:
                model_id = api_model.id
                caps = get_capabilities(model_id)
                display_name = format_display_name(model_id)
                models.append(
                    ModelInfo(
                        id=model_id,
                        display_name=display_name,
                        provider="openai",
                        context_window=caps.context_window,
                        supports_tools=caps.supports_tools,
                        supports_vision=caps.supports_vision,
                        supports_thinking=caps.supports_thinking,
                    )
                )

            logger.debug(f"OpenAI API returned {len(models)} models")

            if models:
                _cached_models = models
                _cache_timestamp = time.monotonic()
                return list(models)

            logger.warning(
                "OpenAI API returned 0 models, using fallback catalog",
            )
        except Exception as e:
            logger.warning(
                f"Failed to fetch OpenAI model list, using fallback catalog: {e}",
            )

        return list(FALLBACK_MODELS)

    def _build_request_kwargs(
        self,
        *,
        messages: list[dict],
        model: str,
        system: str | None,
        tools: list[dict] | None,
    ) -> dict:
        """Build the kwargs dict for the chat.completions.create() call.

        Parameters
        ----------
        messages : list[dict]
            Conversation messages in Anthropic format.
        model : str
            Model identifier.
        system : str | None
            System prompt.
        tools : list[dict] | None
            Tool definitions in Anthropic format.

        Returns
        -------
        dict
            Keyword arguments for the API call.

        """
        openai_messages = convert_messages_to_openai(messages, system)

        kwargs: dict[str, Any] = {
            "model": model,
            "messages": openai_messages,
        }

        if tools:
            kwargs["tools"] = convert_tools_to_openai(tools)

        return kwargs

    async def _sync_completion(self, **kwargs: Any) -> CompletionResult:
        """Execute a non-streaming completion.

        Parameters
        ----------
        **kwargs
            Arguments for chat.completions.create().

        Returns
        -------
        CompletionResult
            The completion result.

        """
        response = await self._client.chat.completions.create(**kwargs)

        choice = response.choices[0]
        message = choice.message

        content = message.content or ""
        tool_calls: list[ToolCall] = []

        if message.tool_calls:
            for tc in message.tool_calls:
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError, TypeError:
                    args = {}
                tool_calls.append(
                    ToolCall(
                        id=tc.id,
                        name=tc.function.name,
                        input=args,
                    )
                )

        stop_reason = map_finish_reason(choice.finish_reason)

        usage = response.usage
        input_tokens = usage.prompt_tokens if usage else 0
        output_tokens = usage.completion_tokens if usage else 0

        return CompletionResult(
            content=content,
            model=response.model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            tool_calls=tool_calls,
            stop_reason=stop_reason,
        )

    async def _stream_completion(
        self,
        **kwargs: Any,
    ) -> AsyncIterator[StreamEvent]:
        """Execute a streaming completion.

        Parameters
        ----------
        **kwargs
            Arguments for chat.completions.create().

        Yields
        ------
        StreamEvent
            Stream events as they arrive.

        """
        try:
            kwargs["stream"] = True
            kwargs["stream_options"] = {"include_usage": True}
            stream = await self._client.chat.completions.create(**kwargs)

            accumulated_content = ""
            pending_tool_calls: dict[int, dict[str, str]] = {}
            tool_calls: list[ToolCall] = []
            model_name = kwargs.get("model", "")
            finish_reason: str | None = None
            input_tokens = 0
            output_tokens = 0

            async for chunk in stream:
                if chunk.usage:
                    input_tokens = chunk.usage.prompt_tokens
                    output_tokens = chunk.usage.completion_tokens

                if not chunk.choices:
                    continue

                choice = chunk.choices[0]
                delta = choice.delta

                if choice.finish_reason:
                    finish_reason = choice.finish_reason

                if chunk.model:
                    model_name = chunk.model

                if delta.content:
                    accumulated_content += delta.content
                    yield TokenEvent(text=delta.content)

                if delta.tool_calls:
                    for tc_delta in delta.tool_calls:
                        idx = tc_delta.index
                        if idx not in pending_tool_calls:
                            pending_tool_calls[idx] = {
                                "id": tc_delta.id or "",
                                "name": "",
                                "arguments": "",
                            }
                        pending = pending_tool_calls[idx]
                        if tc_delta.id:
                            pending["id"] = tc_delta.id
                        if tc_delta.function:
                            if tc_delta.function.name:
                                pending["name"] = tc_delta.function.name
                            if tc_delta.function.arguments:
                                pending["arguments"] += tc_delta.function.arguments

            # Finalize pending tool calls
            for _idx, pending in sorted(pending_tool_calls.items()):
                try:
                    args = json.loads(pending["arguments"])
                except json.JSONDecodeError, TypeError:
                    args = {}
                tc = ToolCall(
                    id=pending["id"],
                    name=pending["name"],
                    input=args,
                )
                tool_calls.append(tc)
                yield ToolCallEvent(tool_call=tc)

            stop_reason = map_finish_reason(finish_reason)

            yield DoneEvent(
                result=CompletionResult(
                    content=accumulated_content,
                    model=model_name,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    tool_calls=tool_calls,
                    stop_reason=stop_reason,
                )
            )
        except Exception as e:
            logger.error(f"OpenAI streaming error: {e}")
            yield ErrorEvent(error=str(e))
