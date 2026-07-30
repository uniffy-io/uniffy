"""OpenAI LLM provider implementation using the official SDK."""

import base64
import json
from collections.abc import AsyncIterator
from typing import Any
from uuid import uuid4

import openai
from loguru import logger

from uniffy.domains.agents.providers.base import (
    CompletionResult,
    EventType,
    LLMProvider,
    ModelInfo,
    StreamEvent,
    ToolCall,
)
from uniffy.domains.agents.providers.catalog import get_model, model_infos_for_provider
from uniffy.domains.agents.providers.openai.converters import (
    convert_messages_to_openai,
    convert_tools_to_openai,
)
from uniffy.domains.agents.providers.openai.images import build_request as build_image_request
from uniffy.domains.agents.providers.openai.responses import (
    build_responses_kwargs,
    stream_completion,
    sync_completion,
)

logger = logger.bind(component="agents.providers.openai.provider")

PROVIDER_ID = "openai"

_MIME_TYPES = {"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp"}


def map_finish_reason(finish_reason: str | None) -> str:
    """Map an OpenAI ``finish_reason`` to an Anthropic-style stop reason."""
    if finish_reason == "tool_calls":
        return "tool_use"
    if finish_reason == "length":
        return "max_tokens"
    return "end_turn"


class OpenAIProvider(LLMProvider):
    """OpenAI provider using the official Python SDK."""

    # openai.com serves reasoning + function tools only on /v1/responses
    # (gpt-5.4+ 400s the combo on chat completions). OpenAI-compatible
    # subclasses (OpenRouter, xAI) stay on chat completions.
    _use_responses_api = True

    def __init__(self, credential: str) -> None:
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
        params: dict | None = None,
    ) -> tuple[bytes, str]:
        """Generate an image via the gpt-image API; returns (image_bytes, mime_type)."""
        catalog_model = get_model(PROVIDER_ID, model)
        request = build_image_request(
            model,
            params or {},
            supports_arbitrary_size=bool(
                catalog_model and catalog_model.image_arbitrary_size
            ),
        )
        # gpt-image models always return base64 and reject response_format.
        response = await self._client.images.generate(
            prompt=prompt,
            model=model,
            **request,
        )
        b64_data = response.data[0].b64_json
        image_bytes = base64.b64decode(b64_data)
        return image_bytes, _MIME_TYPES.get(request.get("output_format", "png"), "image/png")

    def image_billing_size(self, model: str, params: dict) -> str:
        """The size string this generation will be billed under."""
        catalog_model = get_model(PROVIDER_ID, model)
        return build_image_request(
            model,
            params or {},
            supports_arbitrary_size=bool(
                catalog_model and catalog_model.image_arbitrary_size
            ),
        )["size"]

    async def chat_completion(
        self,
        messages: list[dict],
        model: str,
        *,
        system: str | None = None,
        tools: list[dict] | None = None,
        stream: bool = False,
        cache_key: str | None = None,
        params: dict | None = None,
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
        if self._use_responses_api:
            responses_kwargs = build_responses_kwargs(
                messages=messages,
                model=model,
                system=system,
                tools=tools,
                cache_key=cache_key,
                params=params,
            )
            if stream:
                return stream_completion(self._client, responses_kwargs)
            return await sync_completion(self._client, responses_kwargs)

        kwargs = self._build_request_kwargs(
            messages=messages,
            model=model,
            system=system,
            tools=tools,
            cache_key=cache_key,
            params=params,
        )

        if stream:
            return self._stream_completion(**kwargs)

        return await self._sync_completion(**kwargs)

    async def get_available_models(self) -> list[ModelInfo]:
        """Return OpenAI models from the catalog (the source of truth)."""
        return model_infos_for_provider("openai")

    def _build_request_kwargs(
        self,
        *,
        messages: list[dict],
        model: str,
        system: str | None,
        tools: list[dict] | None,
        cache_key: str | None = None,
        params: dict | None = None,
    ) -> dict:
        """Build the kwargs dict for the chat.completions.create() call.

        ``cache_key`` (typically agent_id) is sent as ``prompt_cache_key``
        to bias OpenAI's request routing toward the machine that already
        cached this prefix.
        """
        params = params or {}
        openai_messages = convert_messages_to_openai(messages, system)

        kwargs: dict[str, Any] = {
            "model": model,
            "messages": openai_messages,
        }

        if tools:
            kwargs["tools"] = convert_tools_to_openai(tools)

        if cache_key:
            kwargs["prompt_cache_key"] = cache_key

        if params.get("max_tokens"):
            kwargs["max_completion_tokens"] = params["max_tokens"]
        if params.get("temperature") is not None:
            kwargs["temperature"] = params["temperature"]
        if params.get("top_p") is not None:
            kwargs["top_p"] = params["top_p"]
        parallel = (params.get("provider_options") or {}).get("parallel_tool_calls")
        if parallel is not None and tools:
            kwargs["parallel_tool_calls"] = parallel
        self._apply_reasoning(kwargs, params.get("reasoning_effort", "off"))

        return kwargs

    def _apply_reasoning(self, kwargs: dict, effort: str) -> None:
        """Map the normalized reasoning knob onto the request.

        "off" omits the parameter (the model's default behavior); "on"
        has no chat-completions expression here and is left to
        subclasses whose APIs support a bare enable.
        """
        if effort not in ("off", "on"):
            kwargs["reasoning_effort"] = effort

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
        """Stream block-framed events; MODEL_CALL_END carries the CompletionResult.

        The chat-completions wire has no block framing, so blocks are
        synthesized: one thinking block for the reasoning channel
        (``delta.reasoning_content``, OpenRouter's ``delta.reasoning``),
        one text block for the answer, one tool block per tool-call
        index. Reasoning never touches the accumulated answer text.
        """
        try:
            kwargs["stream"] = True
            kwargs["stream_options"] = {"include_usage": True}
            stream = await self._client.chat.completions.create(**kwargs)

            yield StreamEvent(
                type=EventType.MODEL_CALL_START, model=str(kwargs.get("model", ""))
            )

            accumulated_content = ""
            pending_tool_calls: dict[int, dict[str, str]] = {}
            tool_block_ids: dict[int, str] = {}
            tool_calls: list[ToolCall] = []
            model_name = kwargs.get("model", "")
            finish_reason: str | None = None
            prompt_tokens = 0
            cached_tokens = 0
            output_tokens = 0
            thinking_block_id = ""
            text_block_id = ""

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

                reasoning = _extract_reasoning(delta)
                if reasoning:
                    if not thinking_block_id:
                        thinking_block_id = uuid4().hex[:12]
                        yield StreamEvent(
                            type=EventType.THINKING_BLOCK_START,
                            block_id=thinking_block_id,
                        )
                    yield StreamEvent(
                        type=EventType.THINKING_BLOCK_DELTA,
                        block_id=thinking_block_id,
                        delta=reasoning,
                    )

                if delta.content:
                    if thinking_block_id:
                        yield StreamEvent(
                            type=EventType.THINKING_BLOCK_END,
                            block_id=thinking_block_id,
                        )
                        thinking_block_id = ""
                    if not text_block_id:
                        text_block_id = uuid4().hex[:12]
                        yield StreamEvent(
                            type=EventType.TEXT_BLOCK_START, block_id=text_block_id
                        )
                    accumulated_content += delta.content
                    yield StreamEvent(
                        type=EventType.TEXT_BLOCK_DELTA,
                        block_id=text_block_id,
                        delta=delta.content,
                    )

                if delta.tool_calls:
                    if thinking_block_id:
                        yield StreamEvent(
                            type=EventType.THINKING_BLOCK_END,
                            block_id=thinking_block_id,
                        )
                        thinking_block_id = ""
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
                        if idx not in tool_block_ids:
                            tool_block_ids[idx] = uuid4().hex[:12]
                            yield StreamEvent(
                                type=EventType.TOOL_CALL_START,
                                block_id=tool_block_ids[idx],
                                tool_call_id=pending["id"],
                                tool_name=pending["name"],
                            )
                        if tc_delta.function and tc_delta.function.arguments:
                            yield StreamEvent(
                                type=EventType.TOOL_CALL_DELTA,
                                block_id=tool_block_ids[idx],
                                tool_call_id=pending["id"],
                                tool_name=pending["name"],
                                delta=tc_delta.function.arguments,
                            )

            if thinking_block_id:
                yield StreamEvent(
                    type=EventType.THINKING_BLOCK_END, block_id=thinking_block_id
                )
            if text_block_id:
                yield StreamEvent(
                    type=EventType.TEXT_BLOCK_END, block_id=text_block_id
                )

            for idx, pending in sorted(pending_tool_calls.items()):
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
                yield StreamEvent(
                    type=EventType.TOOL_CALL_END,
                    block_id=tool_block_ids[idx],
                    tool_call_id=tc.id,
                    tool_name=tc.name,
                    tool_args=tc.input,
                )

            yield StreamEvent(
                type=EventType.MODEL_CALL_END,
                model=model_name,
                input_tokens=prompt_tokens - cached_tokens,
                output_tokens=output_tokens,
                cache_read_input_tokens=cached_tokens,
                result=CompletionResult(
                    content=accumulated_content,
                    model=model_name,
                    input_tokens=prompt_tokens - cached_tokens,
                    output_tokens=output_tokens,
                    cache_read_input_tokens=cached_tokens,
                    tool_calls=tool_calls,
                    stop_reason=map_finish_reason(finish_reason),
                ),
            )
        except Exception as e:
            logger.error(f"OpenAI streaming error: {e}")
            yield StreamEvent(type=EventType.ERROR, error=str(e))


def _extract_reasoning(delta) -> str:
    """Reasoning channel across OpenAI-compatible APIs.

    xAI (and DeepSeek-style servers) stream it as ``reasoning_content``;
    OpenRouter normalizes to ``reasoning``. Plain OpenAI has neither on
    chat completions. The SDK's pydantic models allow extra fields, so
    attribute access works for both.
    """
    reasoning = getattr(delta, "reasoning_content", None) or getattr(
        delta, "reasoning", None
    )
    return reasoning if isinstance(reasoning, str) else ""


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
