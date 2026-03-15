"""Message and tool format converters for the OpenAI provider.

Converts between the Anthropic/internal message format used by the
runtime and the OpenAI Chat Completions API format.
"""

import json
from typing import Any


def convert_tools_to_openai(tools: list[dict]) -> list[dict]:
    """Convert tool schemas from Anthropic format to OpenAI function calling format.

    Anthropic format::

        {"name": "...", "description": "...", "input_schema": {...}}

    OpenAI format::

        {"type": "function", "function": {"name": "...", "description": "...", "parameters": {...}}}

    Parameters
    ----------
    tools : list[dict]
        Tool definitions in Anthropic format.

    Returns
    -------
    list[dict]
        Tool definitions in OpenAI function calling format.

    """
    openai_tools: list[dict] = []
    for tool in tools:
        openai_tools.append({
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool.get("description", ""),
                "parameters": tool.get("input_schema", {}),
            },
        })
    return openai_tools


def convert_messages_to_openai(
    messages: list[dict],
    system: str | None,
) -> list[dict]:
    """Convert messages from Anthropic format to OpenAI chat format.

    Handles plain text messages, content block arrays (tool_use, tool_result),
    and system prompt injection.

    Parameters
    ----------
    messages : list[dict]
        Messages in Anthropic format.
    system : str | None
        System prompt to prepend as a system message.

    Returns
    -------
    list[dict]
        Messages in OpenAI chat completion format.

    """
    openai_messages: list[dict] = []

    if system:
        openai_messages.append({"role": "system", "content": system})

    for msg in messages:
        role = msg["role"]
        content = msg.get("content", "")

        # Simple text message
        if isinstance(content, str):
            openai_messages.append({"role": role, "content": content})
            continue

        # Content block array (Anthropic format)
        if isinstance(content, list):
            if role == "assistant":
                openai_messages.append(
                    _convert_assistant_blocks(content),
                )
            elif role == "user":
                has_tool_results = any(b.get("type") == "tool_result" for b in content)
                if has_tool_results:
                    tool_messages = _convert_tool_result_blocks(content)
                    openai_messages.extend(tool_messages)
                else:
                    openai_parts = _convert_user_content_blocks(content)
                    openai_messages.append({"role": "user", "content": openai_parts})
            else:
                # Fallback: join text blocks
                text_parts = [
                    block.get("text", "") for block in content if block.get("type") == "text"
                ]
                openai_messages.append({
                    "role": role,
                    "content": "\n".join(text_parts),
                })

    return openai_messages


def _convert_user_content_blocks(content_blocks: list[dict]) -> list[dict]:
    """Convert canonical user content blocks to OpenAI multimodal parts.

    Parameters
    ----------
    content_blocks : list[dict]
        Canonical content blocks (text, image, document).

    Returns
    -------
    list[dict]
        OpenAI content parts.

    """
    parts: list[dict] = []
    for block in content_blocks:
        btype = block.get("type", "")
        if btype == "text":
            parts.append({"type": "text", "text": block["text"]})
        elif btype == "image":
            media_type = block.get("media_type", "image/png")
            data = block.get("data", "")
            parts.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{media_type};base64,{data}",
                },
            })
        elif btype == "document":
            # OpenAI Chat Completions does not support inline PDFs.
            # Include as text note with filename reference.
            filename = block.get("filename", "document")
            parts.append({
                "type": "text",
                "text": f"[Attached PDF: {filename}]",
            })
    return parts or [{"type": "text", "text": ""}]


def _convert_assistant_blocks(content_blocks: list[dict]) -> dict:
    """Convert Anthropic assistant content blocks to an OpenAI assistant message.

    Parameters
    ----------
    content_blocks : list[dict]
        Anthropic content blocks (text, tool_use).

    Returns
    -------
    dict
        OpenAI assistant message with optional tool_calls.

    """
    text_parts: list[str] = []
    tool_calls: list[dict] = []

    for block in content_blocks:
        if block.get("type") == "text":
            text_parts.append(block["text"])
        elif block.get("type") == "tool_use":
            tool_calls.append({
                "id": block["id"],
                "type": "function",
                "function": {
                    "name": block["name"],
                    "arguments": json.dumps(block.get("input", {})),
                },
            })

    message: dict[str, Any] = {"role": "assistant"}
    text = "\n".join(text_parts) if text_parts else None
    if text:
        message["content"] = text
    if tool_calls:
        message["tool_calls"] = tool_calls

    return message


def _convert_tool_result_blocks(content_blocks: list[dict]) -> list[dict]:
    """Convert Anthropic tool_result blocks to OpenAI tool messages.

    Each tool_result block becomes a separate ``tool`` message in OpenAI format.

    Parameters
    ----------
    content_blocks : list[dict]
        Anthropic tool_result blocks.

    Returns
    -------
    list[dict]
        OpenAI tool messages.

    """
    messages: list[dict] = []
    for block in content_blocks:
        if block.get("type") == "tool_result":
            content = block.get("content", "")
            if isinstance(content, list):
                text_parts = [b.get("text", "") for b in content if b.get("type") == "text"]
                content = "\n".join(text_parts)
            messages.append({
                "role": "tool",
                "tool_call_id": block["tool_use_id"],
                "content": str(content),
            })
    return messages
