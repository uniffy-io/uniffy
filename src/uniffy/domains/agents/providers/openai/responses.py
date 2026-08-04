"""OpenAI Responses API path for openai.com models.

Chat Completions rejects ``reasoning_effort`` combined with function
tools on the gpt-5.4+ generation; the Responses API is OpenAI's
supported surface for reasoning + tools and additionally streams typed
block events (reasoning summaries, per-item text, function-call args)
that map 1:1 onto the unified stream protocol. State is self-hosted
(``store: false``): reasoning items are carried on
``CompletionResult.thinking_blocks`` as ``{"type": "openai_reasoning",
"item": {...}}`` (with ``encrypted_content``) and re-fed as input items
on tool-loop continuations, mirroring the Anthropic signature re-feed.
"""

import json
from collections.abc import AsyncIterator
from copy import deepcopy
from typing import Any
from uuid import uuid4

from loguru import logger

from uniffy.domains.agents.providers.base import (
    CompletionResult,
    EventType,
    StreamEvent,
    ToolCall,
)

logger = logger.bind(component="agents.providers.openai.responses")

REASONING_BLOCK_TYPE = "openai_reasoning"


def convert_tools_to_responses(tools: list[dict]) -> list[dict]:
    """Anthropic tool schemas to the Responses API's flat function shape."""
    return [
        {
            "type": "function",
            "name": tool["name"],
            "description": tool.get("description", ""),
            "parameters": _strict_json_schema(tool.get("input_schema", {})),
            "strict": True,
        }
        for tool in tools
    ]


def _strict_json_schema(schema: dict) -> dict:
    normalized = deepcopy(schema)
    _normalize_schema_node(normalized)
    return normalized


def _normalize_schema_node(node: object) -> None:
    if not isinstance(node, dict):
        return
    for branch_name in ("anyOf", "oneOf", "allOf"):
        for branch in node.get(branch_name, []) or []:
            _normalize_schema_node(branch)
    items = node.get("items")
    if isinstance(items, dict):
        _normalize_schema_node(items)

    if node.get("type") != "object" and "properties" not in node:
        return
    properties = node.setdefault("properties", {})
    if not isinstance(properties, dict):
        return
    required = set(node.get("required") or [])
    for name, property_schema in properties.items():
        _normalize_schema_node(property_schema)
        if name not in required:
            _make_nullable(property_schema)
    node["required"] = list(properties)
    node["additionalProperties"] = False


def _make_nullable(schema: object) -> None:
    if not isinstance(schema, dict):
        return
    schema_type = schema.get("type")
    if isinstance(schema_type, str):
        schema["type"] = [schema_type, "null"]
    elif isinstance(schema_type, list) and "null" not in schema_type:
        schema["type"] = [*schema_type, "null"]
    elif "anyOf" in schema:
        branches = schema["anyOf"]
        if not any(isinstance(branch, dict) and branch.get("type") == "null" for branch in branches):
            branches.append({"type": "null"})
    if "enum" in schema and None not in schema["enum"]:
        schema["enum"] = [*schema["enum"], None]


def convert_messages_to_responses(messages: list[dict]) -> list[dict]:
    """Anthropic-format history to Responses API input items.

    The system prompt travels separately as ``instructions``. Assistant
    turns fan out into reasoning items / output_text messages /
    function_call items in block order; user tool_result blocks become
    function_call_output items.
    """
    items: list[dict] = []
    for msg in messages:
        role = msg["role"]
        content = msg.get("content", "")

        if isinstance(content, str):
            if content:
                items.append({"role": role, "content": content})
            continue
        if not isinstance(content, list):
            continue

        if role == "assistant":
            items.extend(_assistant_blocks_to_items(content))
            continue

        tool_results = [b for b in content if b.get("type") == "tool_result"]
        if tool_results:
            for block in tool_results:
                items.append({
                    "type": "function_call_output",
                    "call_id": block["tool_use_id"],
                    "output": _tool_result_text(block),
                })
            continue

        parts = _user_blocks_to_parts(content)
        if parts:
            items.append({"role": role, "content": parts})
    return items


def _assistant_blocks_to_items(blocks: list[dict]) -> list[dict]:
    items: list[dict] = []
    text_parts: list[str] = []
    for block in blocks:
        btype = block.get("type")
        if btype == REASONING_BLOCK_TYPE:
            items.append(block["item"])
        elif btype == "text":
            text_parts.append(block.get("text", ""))
        elif btype == "tool_use":
            items.append({
                "type": "function_call",
                "call_id": block["id"],
                "name": block["name"],
                "arguments": json.dumps(block.get("input", {})),
            })
    text = "\n".join(p for p in text_parts if p)
    if text:
        # Prior-turn assistant text must precede its function calls.
        insert_at = next(
            (i for i, item in enumerate(items) if item.get("type") == "function_call"),
            len(items),
        )
        items.insert(
            insert_at,
            {
                "role": "assistant",
                "content": [{"type": "output_text", "text": text}],
            },
        )
    return items


def _user_blocks_to_parts(blocks: list[dict]) -> list[dict]:
    parts: list[dict] = []
    for block in blocks:
        btype = block.get("type", "")
        if btype == "text":
            parts.append({"type": "input_text", "text": block["text"]})
        elif btype == "image":
            media_type = block.get("media_type", "image/png")
            data = block.get("data", "")
            parts.append({
                "type": "input_image",
                "image_url": f"data:{media_type};base64,{data}",
            })
        elif btype == "document":
            filename = block.get("filename", "document.pdf")
            if block.get("data"):
                media_type = block.get("media_type", "application/pdf")
                parts.append({
                    "type": "input_file",
                    "filename": filename,
                    "file_data": f"data:{media_type};base64,{block['data']}",
                })
            else:
                parts.append({"type": "input_text", "text": f"[Attached PDF: {filename}]"})
    return parts or [{"type": "input_text", "text": ""}]


def _tool_result_text(block: dict) -> str:
    content = block.get("content", "")
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if b.get("type") == "text")
    return str(content)


def build_responses_kwargs(
    *,
    messages: list[dict],
    model: str,
    system: str | None,
    tools: list[dict] | None,
    cache_key: str | None,
    params: dict | None,
    safety_identifier: str | None = None,
) -> dict:
    params = params or {}
    kwargs: dict[str, Any] = {
        "model": model,
        "input": convert_messages_to_responses(messages),
        "store": False,
    }
    if system:
        kwargs["instructions"] = system
    if tools:
        kwargs["tools"] = convert_tools_to_responses(tools)
    if cache_key:
        kwargs["prompt_cache_key"] = cache_key
    if safety_identifier:
        kwargs["safety_identifier"] = safety_identifier
    if params.get("max_tokens"):
        kwargs["max_output_tokens"] = params["max_tokens"]
    if params.get("temperature") is not None:
        kwargs["temperature"] = params["temperature"]
    if params.get("top_p") is not None:
        kwargs["top_p"] = params["top_p"]
    parallel = (params.get("provider_options") or {}).get("parallel_tool_calls")
    if parallel is not None and tools:
        kwargs["parallel_tool_calls"] = parallel

    effort = params.get("reasoning_effort", "off")
    if effort not in ("off", "on"):
        kwargs["reasoning"] = {"effort": effort, "summary": "auto"}
        # store=false keeps no server state, so continuations need the
        # encrypted item to re-feed reasoning across the tool loop.
        kwargs["include"] = ["reasoning.encrypted_content"]
    return kwargs


def _result_from_response(response: Any) -> CompletionResult:
    content_parts: list[str] = []
    tool_calls: list[ToolCall] = []
    thinking_blocks: list[dict] = []
    for item in response.output or []:
        itype = getattr(item, "type", "")
        if itype == "message":
            for part in getattr(item, "content", None) or []:
                part_type = getattr(part, "type", "")
                if part_type == "output_text":
                    content_parts.append(part.text)
                elif part_type == "refusal":
                    content_parts.append(part.refusal)
        elif itype == "function_call":
            try:
                args = json.loads(item.arguments)
            except json.JSONDecodeError, TypeError:
                args = {}
            tool_calls.append(ToolCall(id=item.call_id, name=item.name, input=args))
        elif itype == "reasoning":
            thinking_blocks.append({
                "type": REASONING_BLOCK_TYPE,
                "item": item.model_dump(exclude_none=True),
            })

    input_tokens, cached_tokens, cache_write_tokens, output_tokens, reasoning = _split_usage(
        response.usage
    )
    return CompletionResult(
        content="\n".join(content_parts),
        model=response.model,
        input_tokens=input_tokens - cached_tokens - cache_write_tokens,
        output_tokens=output_tokens - reasoning,
        cache_creation_input_tokens=cache_write_tokens,
        cache_read_input_tokens=cached_tokens,
        thinking_tokens=reasoning,
        tool_calls=tool_calls,
        thinking_blocks=thinking_blocks,
        stop_reason=_stop_reason(response, tool_calls),
    )


def _stop_reason(response: Any, tool_calls: list[ToolCall]) -> str:
    if getattr(response, "status", "") == "incomplete":
        details = getattr(response, "incomplete_details", None)
        if getattr(details, "reason", "") == "max_output_tokens":
            return "max_tokens"
    return "tool_use" if tool_calls else "end_turn"


def _split_usage(usage: Any) -> tuple[int, int, int, int, int]:
    """Return total input, cache read, cache write, output, and reasoning tokens."""
    if usage is None:
        return 0, 0, 0, 0, 0
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    in_details = getattr(usage, "input_tokens_details", None)
    cached = int(getattr(in_details, "cached_tokens", 0) or 0) if in_details else 0
    cache_write = int(getattr(in_details, "cache_write_tokens", 0) or 0) if in_details else 0
    out_details = getattr(usage, "output_tokens_details", None)
    reasoning = int(getattr(out_details, "reasoning_tokens", 0) or 0) if out_details else 0
    cached = min(cached, input_tokens)
    cache_write = min(cache_write, input_tokens - cached)
    reasoning = min(reasoning, output_tokens)
    return input_tokens, cached, cache_write, output_tokens, reasoning


async def sync_completion(client: Any, kwargs: dict) -> CompletionResult:
    response = await client.responses.create(**kwargs)
    return _result_from_response(response)


async def stream_completion(client: Any, kwargs: dict) -> AsyncIterator[StreamEvent]:
    """Stream block-framed events; MODEL_CALL_END carries the CompletionResult.

    Dispatch is on the wire ``event.type`` string rather than SDK event
    classes so unknown event types added upstream pass through silently.
    """
    try:
        kwargs["stream"] = True
        stream = await client.responses.create(**kwargs)

        yield StreamEvent(type=EventType.MODEL_CALL_START, model=str(kwargs.get("model", "")))

        block_ids: dict[str, str] = {}
        pending_calls: dict[str, dict[str, str]] = {}
        result: CompletionResult | None = None

        async for event in stream:
            etype = getattr(event, "type", "")

            if etype == "response.output_item.added":
                item = event.item
                block_id = uuid4().hex[:12]
                block_ids[item.id or block_id] = block_id
                if item.type == "reasoning":
                    yield StreamEvent(type=EventType.THINKING_BLOCK_START, block_id=block_id)
                elif item.type == "message":
                    yield StreamEvent(type=EventType.TEXT_BLOCK_START, block_id=block_id)
                elif item.type == "function_call":
                    pending_calls[item.id or block_id] = {
                        "id": item.call_id or "",
                        "name": item.name or "",
                    }
                    yield StreamEvent(
                        type=EventType.TOOL_CALL_START,
                        block_id=block_id,
                        tool_call_id=item.call_id or "",
                        tool_name=item.name or "",
                    )

            elif etype == "response.reasoning_summary_part.added":
                # Summary parts are standalone sections; without a
                # separator the next part's heading glues onto the
                # previous sentence.
                if getattr(event, "summary_index", 0) > 0:
                    yield StreamEvent(
                        type=EventType.THINKING_BLOCK_DELTA,
                        block_id=block_ids.get(event.item_id, ""),
                        delta="\n\n",
                    )

            elif etype == "response.reasoning_summary_text.delta":
                yield StreamEvent(
                    type=EventType.THINKING_BLOCK_DELTA,
                    block_id=block_ids.get(event.item_id, ""),
                    delta=event.delta,
                )

            elif etype in ("response.output_text.delta", "response.refusal.delta"):
                yield StreamEvent(
                    type=EventType.TEXT_BLOCK_DELTA,
                    block_id=block_ids.get(event.item_id, ""),
                    delta=event.delta,
                )

            elif etype == "response.function_call_arguments.delta":
                pending = pending_calls.get(event.item_id, {})
                yield StreamEvent(
                    type=EventType.TOOL_CALL_DELTA,
                    block_id=block_ids.get(event.item_id, ""),
                    tool_call_id=pending.get("id", ""),
                    tool_name=pending.get("name", ""),
                    delta=event.delta,
                )

            elif etype == "response.output_item.done":
                item = event.item
                block_id = block_ids.get(item.id or "", "")
                if item.type == "reasoning":
                    yield StreamEvent(type=EventType.THINKING_BLOCK_END, block_id=block_id)
                elif item.type == "message":
                    yield StreamEvent(type=EventType.TEXT_BLOCK_END, block_id=block_id)
                elif item.type == "function_call":
                    try:
                        args = json.loads(item.arguments)
                    except json.JSONDecodeError, TypeError:
                        args = {}
                    yield StreamEvent(
                        type=EventType.TOOL_CALL_END,
                        block_id=block_id,
                        tool_call_id=item.call_id or "",
                        tool_name=item.name or "",
                        tool_args=args,
                    )

            elif etype == "response.completed":
                result = _result_from_response(event.response)
                yield StreamEvent(
                    type=EventType.MODEL_CALL_END,
                    model=result.model,
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                    cache_creation_input_tokens=result.cache_creation_input_tokens,
                    cache_read_input_tokens=result.cache_read_input_tokens,
                    thinking_tokens=result.thinking_tokens,
                    result=result,
                )

            elif etype in ("response.failed", "response.incomplete"):
                response = event.response
                if etype == "response.incomplete":
                    result = _result_from_response(response)
                    yield StreamEvent(
                        type=EventType.MODEL_CALL_END,
                        model=result.model,
                        input_tokens=result.input_tokens,
                        output_tokens=result.output_tokens,
                        cache_creation_input_tokens=(result.cache_creation_input_tokens),
                        cache_read_input_tokens=result.cache_read_input_tokens,
                        thinking_tokens=result.thinking_tokens,
                        result=result,
                    )
                else:
                    error = getattr(response, "error", None)
                    message = getattr(error, "message", "") or "response.failed"
                    yield StreamEvent(type=EventType.ERROR, error=message)
                    return

        if result is None:
            yield StreamEvent(
                type=EventType.ERROR, error="stream ended without a completed response"
            )
    except Exception as e:
        logger.error(f"OpenAI responses streaming error: {e}")
        yield StreamEvent(type=EventType.ERROR, error=str(e), error_exception=e)
