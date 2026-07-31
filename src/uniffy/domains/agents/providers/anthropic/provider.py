"""Anthropic LLM provider implementation using the official SDK."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from uuid import uuid4

import anthropic
from loguru import logger

from uniffy.domains.agents.providers.base import (
    CompletionResult,
    EventType,
    LLMProvider,
    ModelInfo,
    StreamEvent,
    ToolCall,
)
from uniffy.domains.agents.providers.catalog import (
    model_info_for,
    model_infos_for_provider,
)

logger = logger.bind(component="agents.providers.anthropic.provider")

# Budget for models on the legacy enabled+budget_tokens thinking API
# (catalog ``can_reason`` without ``reasoning_levels``).
_THINKING_BUDGET_TOKENS = 4096
_DEFAULT_MAX_TOKENS = 8192


def _thinking_config(model: str, effort: str) -> dict | None:
    """Thinking request config for the model's API generation, or None.

    Models with catalog ``reasoning_levels`` (Claude 4.6+) take adaptive
    thinking and REJECT ``budget_tokens`` with a 400; their ``display``
    defaults to omitted (thinking blocks stream with empty text), so opt
    into summaries. Older thinking models require the legacy
    ``enabled`` + ``budget_tokens`` shape. "off" means the request does
    not ask for thinking; models that always think (Fable tier) still
    run their native default.
    """
    if effort == "off":
        return None
    info = model_info_for("anthropic", model)
    if info is None or not info.supports_thinking:
        return None
    if info.reasoning_levels:
        return {"type": "adaptive", "display": "summarized"}
    return {"type": "enabled", "budget_tokens": _THINKING_BUDGET_TOKENS}


@dataclass
class _OpenBlock:
    """Per-index state for a content block the API has opened."""

    kind: str
    block_id: str
    tool_call_id: str = ""
    tool_name: str = ""
    signature: str = ""
    thinking: str = ""


class AnthropicProvider(LLMProvider):
    """Anthropic Claude provider using the official Python SDK."""

    @property
    def name(self) -> str:
        """Catalog provider key, used for pricing lookups."""
        return "anthropic"

    def __init__(self, credential: str) -> None:
        self._client = anthropic.AsyncAnthropic(api_key=credential)

    async def validate(self) -> tuple[bool, str | None]:
        """Probe the models endpoint to confirm the key works.

        Returns
        -------
        tuple[bool, str | None]
            (True, None) if valid, (False, error_message) otherwise.

        """
        try:
            await self._client.models.list(limit=1)
            return True, None
        except anthropic.AuthenticationError as e:
            return False, f"Authentication failed: {e}"
        except anthropic.PermissionDeniedError as e:
            return False, f"Permission denied: {e}"
        except anthropic.RateLimitError as e:
            # Rate limited but credentials are valid
            logger.warning(f"Rate limited during validation: {e}")
            return True, None
        except Exception as e:
            return False, f"Validation error: {e}"

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
        """Send a chat completion request to the Anthropic API.

        Parameters
        ----------
        messages : list[dict]
            Messages in Anthropic format.
        model : str
            Model identifier (e.g. "claude-opus-4-6").
        system : str | None
            System prompt passed as top-level parameter.
        tools : list[dict] | None
            Anthropic tool definitions.
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
            params=params,
        )

        if stream:
            return self._stream_completion(**kwargs)

        return await self._sync_completion(**kwargs)

    async def get_available_models(self) -> list[ModelInfo]:
        """Return Anthropic models from the catalog (the source of truth)."""
        return model_infos_for_provider("anthropic")

    def _build_request_kwargs(
        self,
        *,
        messages: list[dict],
        model: str,
        system: str | None,
        tools: list[dict] | None,
        params: dict | None = None,
    ) -> dict:
        """Build the kwargs dict for the messages.create() call.

        Caching: render order is ``tools -> system -> messages``. A
        single ``cache_control: ephemeral`` breakpoint on the last
        system block covers BOTH tools and system in one cache entry,
        so subsequent turns within the cache TTL pay ~10% of the input
        price for that prefix. We do not put a separate breakpoint on
        the last tool -- it would write a redundant second cache entry
        (paying the 1.25x write premium twice on the first turn) for
        the same coverage.
        """
        params = params or {}
        clean_messages = self._clean_messages(messages)

        kwargs: dict = {
            "model": model,
            "messages": clean_messages,
            "max_tokens": params.get("max_tokens") or _DEFAULT_MAX_TOKENS,
        }

        effort = params.get("reasoning_effort", "off")
        thinking = _thinking_config(model, effort)
        if thinking is not None:
            kwargs["thinking"] = thinking
            if thinking["type"] == "adaptive":
                kwargs["output_config"] = {"effort": effort}
            else:
                # budget_tokens must stay below max_tokens; keep the
                # answer budget intact by extending the ceiling instead.
                kwargs["max_tokens"] += _THINKING_BUDGET_TOKENS
        else:
            # The API rejects non-default sampling alongside thinking,
            # so temperature/top_p ride only on thinking-off requests.
            if params.get("temperature") is not None:
                kwargs["temperature"] = params["temperature"]
            if params.get("top_p") is not None:
                kwargs["top_p"] = params["top_p"]
        top_k = (params.get("provider_options") or {}).get("top_k")
        if top_k is not None and thinking is None:
            kwargs["top_k"] = top_k

        if system:
            kwargs["system"] = [
                {
                    "type": "text",
                    "text": system,
                    "cache_control": {"type": "ephemeral"},
                }
            ]

        if tools:
            kwargs["tools"] = list(tools)

        return kwargs

    @staticmethod
    def _clean_messages(messages: list[dict]) -> list[dict]:
        """Clean messages for the Anthropic API.

        - Remove tool_name from tool_result blocks (Anthropic rejects extra fields)
        - Convert canonical image/document blocks to Anthropic source format

        """
        cleaned: list[dict] = []
        for msg in messages:
            content = msg.get("content")
            if isinstance(content, list):
                new_content = []
                for block in content:
                    if not isinstance(block, dict):
                        new_content.append(block)
                        continue
                    btype = block.get("type")
                    if btype == "tool_result":
                        block = {k: v for k, v in block.items() if k != "tool_name"}
                        new_content.append(block)
                    elif btype == "image" and "data" in block:
                        new_content.append({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": block["media_type"],
                                "data": block["data"],
                            },
                        })
                    elif btype == "document" and "data" in block:
                        new_content.append({
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": block["media_type"],
                                "data": block["data"],
                            },
                        })
                    else:
                        new_content.append(block)
                cleaned.append({**msg, "content": new_content})
            else:
                cleaned.append(msg)
        return cleaned

    async def _sync_completion(self, **kwargs) -> CompletionResult:
        """Execute a non-streaming completion.

        Parameters
        ----------
        **kwargs
            Arguments for messages.create().

        Returns
        -------
        CompletionResult
            The completion result.

        """
        response = await self._client.messages.create(**kwargs)

        content = ""
        tool_calls: list[ToolCall] = []
        thinking_blocks: list[dict] = []

        for block in response.content:
            if block.type == "text":
                content += block.text
            elif block.type == "thinking":
                thinking_blocks.append({
                    "type": "thinking",
                    "thinking": block.thinking,
                    "signature": getattr(block, "signature", "") or "",
                })
            elif block.type == "tool_use":
                tool_calls.append(
                    ToolCall(
                        id=block.id,
                        name=block.name,
                        input=block.input if isinstance(block.input, dict) else {},
                    )
                )

        return CompletionResult(
            content=content,
            model=response.model,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            cache_creation_input_tokens=int(
                getattr(response.usage, "cache_creation_input_tokens", 0) or 0
            ),
            cache_read_input_tokens=int(
                getattr(response.usage, "cache_read_input_tokens", 0) or 0
            ),
            tool_calls=tool_calls,
            thinking_blocks=thinking_blocks,
            stop_reason=response.stop_reason or "end_turn",
        )

    async def _stream_completion(self, **kwargs) -> AsyncIterator[StreamEvent]:
        """Stream block-framed events; MODEL_CALL_END carries the CompletionResult.

        Thinking deltas travel only as thinking block events and are never
        appended to the accumulated answer text.
        """
        model = str(kwargs.get("model", ""))
        try:
            async with self._client.messages.stream(**kwargs) as stream:
                yield StreamEvent(type=EventType.MODEL_CALL_START, model=model)
                accumulated_content = ""
                tool_calls: list[ToolCall] = []
                thinking_blocks: list[dict] = []
                blocks: dict[int, _OpenBlock] = {}

                async for event in stream:
                    match event.type:
                        case "content_block_start":
                            opened = self._open_block(event.content_block)
                            if opened is None:
                                continue
                            blocks[event.index] = opened
                            yield self._block_start_event(opened)
                        case "content_block_delta":
                            block = blocks.get(event.index)
                            if block is None:
                                continue
                            delta_event = self._block_delta_event(block, event.delta)
                            if delta_event is None:
                                continue
                            if delta_event.type is EventType.TEXT_BLOCK_DELTA:
                                accumulated_content += delta_event.delta
                            yield delta_event
                        case "content_block_stop":
                            block = blocks.pop(event.index, None)
                            if block is None:
                                continue
                            yield self._block_end_event(
                                block,
                                getattr(event, "content_block", None),
                                tool_calls,
                                thinking_blocks,
                            )

                final_message = await stream.get_final_message()
                usage = final_message.usage
                cache_read = int(getattr(usage, "cache_read_input_tokens", 0) or 0)
                yield StreamEvent(
                    type=EventType.MODEL_CALL_END,
                    model=final_message.model,
                    input_tokens=usage.input_tokens,
                    output_tokens=usage.output_tokens,
                    cache_read_input_tokens=cache_read,
                    result=CompletionResult(
                        content=accumulated_content,
                        model=final_message.model,
                        input_tokens=usage.input_tokens,
                        output_tokens=usage.output_tokens,
                        cache_creation_input_tokens=int(
                            getattr(usage, "cache_creation_input_tokens", 0) or 0
                        ),
                        cache_read_input_tokens=cache_read,
                        tool_calls=tool_calls,
                        thinking_blocks=thinking_blocks,
                        stop_reason=final_message.stop_reason or "end_turn",
                    ),
                )
        except Exception as e:
            logger.error(f"Anthropic streaming error: {e}")
            yield StreamEvent(type=EventType.ERROR, error=str(e))

    @staticmethod
    def _open_block(content_block) -> _OpenBlock | None:
        """Track a newly opened content block; unsupported kinds return None."""
        kind = content_block.type
        if kind not in ("text", "thinking", "tool_use"):
            return None
        opened = _OpenBlock(kind=kind, block_id=uuid4().hex[:12])
        if kind == "tool_use":
            opened.tool_call_id = content_block.id
            opened.tool_name = content_block.name
        return opened

    @staticmethod
    def _block_start_event(block: _OpenBlock) -> StreamEvent:
        match block.kind:
            case "text":
                return StreamEvent(
                    type=EventType.TEXT_BLOCK_START, block_id=block.block_id
                )
            case "thinking":
                return StreamEvent(
                    type=EventType.THINKING_BLOCK_START, block_id=block.block_id
                )
            case _:
                return StreamEvent(
                    type=EventType.TOOL_CALL_START,
                    block_id=block.block_id,
                    tool_call_id=block.tool_call_id,
                    tool_name=block.tool_name,
                )

    @staticmethod
    def _block_delta_event(block: _OpenBlock, delta) -> StreamEvent | None:
        match getattr(delta, "type", ""):
            case "text_delta":
                return StreamEvent(
                    type=EventType.TEXT_BLOCK_DELTA,
                    block_id=block.block_id,
                    delta=delta.text,
                )
            case "thinking_delta":
                block.thinking += delta.thinking
                return StreamEvent(
                    type=EventType.THINKING_BLOCK_DELTA,
                    block_id=block.block_id,
                    delta=delta.thinking,
                )
            case "signature_delta":
                block.signature += delta.signature
                return None
            case "input_json_delta":
                return StreamEvent(
                    type=EventType.TOOL_CALL_DELTA,
                    block_id=block.block_id,
                    tool_call_id=block.tool_call_id,
                    tool_name=block.tool_name,
                    delta=delta.partial_json,
                )
            case _:
                return None

    @staticmethod
    def _block_end_event(
        block: _OpenBlock,
        final_block,
        tool_calls: list[ToolCall],
        thinking_blocks: list[dict],
    ) -> StreamEvent:
        match block.kind:
            case "text":
                return StreamEvent(
                    type=EventType.TEXT_BLOCK_END, block_id=block.block_id
                )
            case "thinking":
                if block.thinking or block.signature:
                    thinking_blocks.append({
                        "type": "thinking",
                        "thinking": block.thinking,
                        "signature": block.signature,
                    })
                return StreamEvent(
                    type=EventType.THINKING_BLOCK_END,
                    block_id=block.block_id,
                    signature=block.signature,
                )
            case _:
                # The SDK stream helper attaches the fully accumulated
                # tool_use block (parsed input included) on the stop event.
                raw_input = getattr(final_block, "input", None)
                tool_call = ToolCall(
                    id=block.tool_call_id,
                    name=block.tool_name,
                    input=raw_input if isinstance(raw_input, dict) else {},
                )
                tool_calls.append(tool_call)
                return StreamEvent(
                    type=EventType.TOOL_CALL_END,
                    block_id=block.block_id,
                    tool_call_id=tool_call.id,
                    tool_name=tool_call.name,
                    tool_args=tool_call.input,
                )
