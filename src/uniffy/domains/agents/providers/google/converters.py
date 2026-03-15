"""Message and tool format converters for the Google Gemini provider.

Converts between the Anthropic/internal message format used by the
runtime and the Google Gemini API format using the google-genai SDK.
"""

import base64

from google.genai import types


def convert_tools_to_google(tools: list[dict]) -> list[types.Tool]:
    """Convert tool schemas from Anthropic format to Google function declarations.

    Anthropic format::

        {"name": "...", "description": "...", "input_schema": {...}}

    Google format uses ``types.FunctionDeclaration`` and ``types.Tool``.

    Parameters
    ----------
    tools : list[dict]
        Tool definitions in Anthropic format.

    Returns
    -------
    list[types.Tool]
        Tool definitions in Google format.

    """
    declarations: list[types.FunctionDeclaration] = []
    for tool in tools:
        declarations.append(
            types.FunctionDeclaration(
                name=tool["name"],
                description=tool.get("description", ""),
                parameters_json_schema=tool.get("input_schema", {}),
            )
        )
    return [types.Tool(function_declarations=declarations)]


def convert_messages_to_google(
    messages: list[dict],
) -> list[types.Content]:
    """Convert messages from Anthropic format to Google Content format.

    Handles plain text messages, content block arrays (tool_use, tool_result),
    and maps roles appropriately (user/assistant -> user/model).

    Parameters
    ----------
    messages : list[dict]
        Messages in Anthropic format.

    Returns
    -------
    list[types.Content]
        Messages in Google Content format.

    """
    contents: list[types.Content] = []

    for msg in messages:
        role = msg["role"]
        content = msg.get("content", "")

        # Map Anthropic roles to Google roles
        google_role = "model" if role == "assistant" else "user"

        # Simple text message
        if isinstance(content, str):
            contents.append(
                types.Content(
                    role=google_role,
                    parts=[types.Part.from_text(text=content)],
                )
            )
            continue

        # Content block array (Anthropic format)
        if isinstance(content, list):
            parts = _convert_content_blocks_to_parts(content)
            if parts:
                contents.append(
                    types.Content(role=google_role, parts=parts),
                )

    return contents


def _convert_content_blocks_to_parts(
    content_blocks: list[dict],
) -> list[types.Part]:
    """Convert Anthropic content blocks to Google Part objects.

    Parameters
    ----------
    content_blocks : list[dict]
        Anthropic content blocks (text, tool_use, tool_result).

    Returns
    -------
    list[types.Part]
        Google Part objects.

    """
    parts: list[types.Part] = []

    for block in content_blocks:
        block_type = block.get("type", "")

        if block_type == "text":
            parts.append(types.Part.from_text(text=block["text"]))

        elif block_type == "tool_use":
            fc_part = types.Part(
                function_call=types.FunctionCall(
                    name=block["name"],
                    args=block.get("input", {}),
                ),
            )
            metadata = block.get("metadata", {})
            if "thought_signature" in metadata:
                fc_part.thought_signature = metadata["thought_signature"]
            parts.append(fc_part)

        elif block_type == "image":
            # Handle canonical format (data on block) and legacy (source dict)
            if "data" in block:
                image_bytes = base64.b64decode(block["data"])
                mime = block.get("media_type", "image/png")
            else:
                source = block.get("source", {})
                image_bytes = base64.b64decode(source.get("data", ""))
                mime = source.get("media_type", "image/png")
            parts.append(types.Part.from_bytes(data=image_bytes, mime_type=mime))

        elif block_type == "document":
            # Gemini supports native PDF via inline_data
            if "data" in block:
                doc_bytes = base64.b64decode(block["data"])
                mime = block.get("media_type", "application/pdf")
            else:
                source = block.get("source", {})
                doc_bytes = base64.b64decode(source.get("data", ""))
                mime = source.get("media_type", "application/pdf")
            parts.append(types.Part.from_bytes(data=doc_bytes, mime_type=mime))

        elif block_type == "tool_result":
            result_content = block.get("content", "")
            if isinstance(result_content, list):
                text_parts = [b.get("text", "") for b in result_content if b.get("type") == "text"]
                result_content = "\n".join(text_parts)
            # Use tool_name (function name) for Google API; fall back to
            # tool_use_id for backwards compatibility with stored messages.
            # Convert dots to hyphens to match the API-safe name format
            # used in function declarations (e.g. "notes.read_note" -> "notes-read_note").
            fn_name = block.get("tool_name") or block.get("tool_use_id", "unknown")
            fn_name = fn_name.replace(".", "-")
            parts.append(
                types.Part.from_function_response(
                    name=fn_name,
                    response={"result": str(result_content)},
                )
            )

    return parts
