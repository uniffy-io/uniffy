"""OpenAI LLM provider implementation using the official SDK."""

import base64
import json
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
from uniffy.domains.agents.providers.catalog import model_infos_for_provider
from uniffy.domains.agents.providers.openai.converters import (
    convert_messages_to_openai,
    convert_tools_to_openai,
)

logger = logger.bind(component="agents.providers.openai.provider")


def map_finish_reason(finish_reason: str | None) -> str:
    """Map an OpenAI ``finish_reason`` to an Anthropic-style stop reason."""
    if finish_reason == "tool_calls":
        return "tool_use"
    if finish_reason == "length":
        return "max_tokens"
    return "end_turn"


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

    @property
    def name(self) -> str:
        """Catalog provider key, used for pricing lookups."""
        return "openai"

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
        """Generate a PNG via the gpt-image API; returns (image_bytes, mime_type)."""
        # gpt-image models always return base64 PNG and reject response_format.
        response = await self._client.images.generate(
            prompt=prompt,
            model=model,
            size=size,
            quality=quality,
        )
        b64_data = response.data[0].b64_json
        image_bytes = base64.b64decode(b64_data)
        return image_bytes, "image/png"

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
        cache_key : str | None
            Forwarded as ``prompt_cache_key`` so requests sharing the
            same prefix land on the same OpenAI machine and reliably
            hit the prompt cache. Without it, sustained traffic above
            ~15 RPM for the same prefix gets scattered across machines
            and cache hit rate degrades.

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
            cache_key=cache_key,
        )

        if stream:
            return self._stream_completion(**kwargs)

        return await self._sync_completion(**kwargs)

    async def get_available_models(
        self,
        *,
        force_refresh: bool = False,
    ) -> list[ModelInfo]:
        """Return OpenAI models from the catalog (the source of truth).

        ``force_refresh`` is accepted for interface compatibility and ignored
        - the catalog is local and re-read on change.
        """
        return model_infos_for_provider("openai")

    def _build_request_kwargs(
        self,
        *,
        messages: list[dict],
        model: str,
        system: str | None,
        tools: list[dict] | None,
        cache_key: str | None = None,
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
        cache_key : str | None
            Stable identifier (typically agent_id) sent as
            ``prompt_cache_key`` to bias OpenAI's request routing
            toward the machine that already cached this prefix.

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

        if cache_key:
            kwargs["prompt_cache_key"] = cache_key

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
                except (json.JSONDecodeError, TypeError):
                    args = {}
                tool_calls.append(
                    ToolCall(
                        id=tc.id,
                        name=tc.function.name,
                        input=args,
                    )
                )

        stop_reason = map_finish_reason(choice.finish_reason)

        prompt_tokens, cached_tokens, output_tokens = _split_openai_usage(response.usage)

        return CompletionResult(
            content=content,
            model=response.model,
            input_tokens=prompt_tokens - cached_tokens,
            output_tokens=output_tokens,
            cache_read_input_tokens=cached_tokens,
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
            prompt_tokens = 0
            cached_tokens = 0
            output_tokens = 0

            async for chunk in stream:
                if chunk.usage:
                    prompt_tokens, cached_tokens, output_tokens = _split_openai_usage(
                        chunk.usage
                    )

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
                except (json.JSONDecodeError, TypeError):
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
                    input_tokens=prompt_tokens - cached_tokens,
                    output_tokens=output_tokens,
                    cache_read_input_tokens=cached_tokens,
                    tool_calls=tool_calls,
                    stop_reason=stop_reason,
                )
            )
        except Exception as e:
            logger.error(f"OpenAI streaming error: {e}")
            yield ErrorEvent(error=str(e))


def _split_openai_usage(usage) -> tuple[int, int, int]:
    """Return ``(prompt_tokens, cached_tokens, completion_tokens)``.

    OpenAI's ``usage.prompt_tokens`` is the *full* prompt; the cached
    portion lives under ``prompt_tokens_details.cached_tokens`` and is
    a subset of it. We surface the two separately so the rest of the
    runtime can store ``cache_read_input_tokens`` and an "uncached
    input" delta in the same shape Anthropic's ``input_tokens`` /
    ``cache_read_input_tokens`` fields use.

    Both fields tolerate the older API shapes where
    ``prompt_tokens_details`` is missing -- pre-cached models simply
    report 0 cached tokens.
    """
    if usage is None:
        return 0, 0, 0
    prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
    completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
    details = getattr(usage, "prompt_tokens_details", None)
    cached_tokens = int(getattr(details, "cached_tokens", 0) or 0) if details else 0
    cached_tokens = min(cached_tokens, prompt_tokens)
    return prompt_tokens, cached_tokens, completion_tokens
