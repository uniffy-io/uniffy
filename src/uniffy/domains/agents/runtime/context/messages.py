"""Canonical message and attachment context construction."""

from __future__ import annotations

import base64

from loguru import logger

from uniffy.core.content.references import sanitize_mention_label
from uniffy.core.extraction import UnsupportedFormatError, can_extract, extract_text
from uniffy.core.models.agents.message import AgentMessage, AgentMessageRole
from uniffy.core.storage import ObjectStorage
from uniffy.domains.agents.providers.base import CanonicalContentBlockType
from uniffy.domains.agents.runtime.files import FileContext
from uniffy.domains.agents.tools.registry import to_api_name

logger = logger.bind(component="agents.runtime.context.messages")


def file_to_content_block(
    file: FileContext,
    *,
    supports_vision: bool = True,
) -> dict:
    media_type = file.media_type

    if media_type.startswith("image/"):
        if not supports_vision:
            return {
                "type": CanonicalContentBlockType.TEXT,
                "text": (
                    f"[Attached image: {file.filename} ({media_type}) - the current model "
                    f"does not support image input. The user attached this image but "
                    f"you cannot view it. Tell the user the current model is not "
                    f"vision-capable and ask them to describe the image or switch "
                    f"to a vision-capable model.]"
                ),
            }
        return {
            "type": CanonicalContentBlockType.IMAGE,
            "media_type": media_type,
            "storage_key": file.storage_key,
        }

    if media_type == "application/pdf":  # noqa: PLR2004
        return {
            "type": CanonicalContentBlockType.DOCUMENT,
            "media_type": media_type,
            "storage_key": file.storage_key,
            "filename": file.filename,
        }

    if file.extracted_text:
        return {
            "type": CanonicalContentBlockType.TEXT,
            "text": (
                f"--- File: {file.filename} ---\n"
                f"{file.extracted_text}\n"
                f"--- End of {file.filename} ---"
            ),
        }

    if can_extract(media_type):
        return {
            "type": CanonicalContentBlockType.TEXT_PENDING_EXTRACTION,
            "media_type": media_type,
            "storage_key": file.storage_key,
            "filename": file.filename,
        }

    return {
        "type": CanonicalContentBlockType.TEXT,
        "text": (f"[Attached file: {file.filename} ({media_type}) - content not extractable]"),
    }


async def resolve_supports_vision(provider: object, model_id: str) -> bool:
    """Default to vision support when catalog lookup cannot classify a model."""
    try:
        available = await provider.get_available_models()  # type: ignore[attr-defined]
    except Exception:
        logger.exception("Failed to look up provider models for vision gating")
        return True
    for model in available:
        if model.id == model_id:
            return bool(getattr(model, "supports_vision", False))
    return True


def build_stored_content(
    content: str,
    files: list[FileContext] | None,
) -> str:
    if not files:
        return content

    parts: list[str] = []
    for file in files:
        mention = (
            f"[[[{sanitize_mention_label(file.filename)}|urn:uniffy:content:FILE:{file.file_id}]]]"
        )
        if file.extracted_text:
            parts.append(
                f"{mention}\n"
                f"--- File: {file.filename} ---\n"
                f"{file.extracted_text}\n"
                f"--- End of {file.filename} ---"
            )
        else:
            parts.append(mention)

    if content.strip():
        parts.append(content)

    return "\n\n".join(parts)


async def resolve_pending_content_blocks(
    storage: ObjectStorage,
    messages: list[dict],
) -> None:
    for message in messages:
        content = message.get("content")
        if not isinstance(content, list):
            continue

        resolved: list[dict] = []
        for block in content:
            block_type = block.get("type", "")

            if block_type == CanonicalContentBlockType.IMAGE and "storage_key" in block:  # noqa: PLR2004
                data = await storage.download_bytes(block["storage_key"])
                resolved.append({
                    "type": CanonicalContentBlockType.IMAGE,
                    "media_type": block["media_type"],
                    "data": base64.b64encode(data).decode("ascii"),
                })
            elif block_type == CanonicalContentBlockType.DOCUMENT and "storage_key" in block:  # noqa: PLR2004
                data = await storage.download_bytes(block["storage_key"])
                resolved.append({
                    "type": CanonicalContentBlockType.DOCUMENT,
                    "media_type": block["media_type"],
                    "data": base64.b64encode(data).decode("ascii"),
                    "filename": block.get("filename", ""),
                })
            elif block_type == CanonicalContentBlockType.TEXT_PENDING_EXTRACTION:
                data = await storage.download_bytes(block["storage_key"])
                filename = block.get("filename", "file")
                try:
                    result = extract_text(data, block["media_type"])
                    resolved.append({
                        "type": CanonicalContentBlockType.TEXT,
                        "text": (
                            f"--- File: {filename} ---\n{result.text}\n--- End of {filename} ---"
                        ),
                    })
                except UnsupportedFormatError:
                    resolved.append({
                        "type": CanonicalContentBlockType.TEXT,
                        "text": (
                            f"[Attached file: {filename} "
                            f"({block['media_type']}) - content not extractable]"
                        ),
                    })
            else:
                resolved.append(block)

        message["content"] = resolved


def build_llm_messages(
    context_messages: list[AgentMessage],
    new_content: str = "",
    *,
    files: list[FileContext] | None = None,
    append_new: bool = True,
    supports_vision: bool = True,
) -> list[dict]:
    messages: list[dict] = []

    index = 0
    while index < len(context_messages):
        message = context_messages[index]

        if message.role == AgentMessageRole.SUMMARY:
            messages.append({
                "role": "user",
                "content": f"[Previous conversation summary]\n{message.content}",
            })
            index += 1
        elif message.role == AgentMessageRole.ASSISTANT and message.tool_call_id:
            content_blocks: list[dict] = []
            tool_call_ids: list[str] = []

            while (
                index < len(context_messages)
                and context_messages[index].role == AgentMessageRole.ASSISTANT
                and context_messages[index].tool_call_id
            ):
                tool_message = context_messages[index]
                if not content_blocks and tool_message.content:
                    content_blocks.append({"type": "text", "text": tool_message.content})
                content_blocks.append({
                    "type": "tool_use",
                    "id": tool_message.tool_call_id,
                    "name": to_api_name(tool_message.tool_name or ""),
                    "input": tool_message.tool_args or {},
                })
                tool_call_ids.append(tool_message.tool_call_id)
                index += 1

            messages.append({
                "role": "assistant",
                "content": content_blocks,
            })

            tool_result_blocks: list[dict] = []
            matched_ids: set[str] = set()
            while (
                index < len(context_messages)
                and context_messages[index].role == AgentMessageRole.TOOL
                and context_messages[index].tool_call_id in tool_call_ids
            ):
                result_message = context_messages[index]
                result_block: dict = {
                    "type": "tool_result",
                    "tool_use_id": result_message.tool_call_id,
                    "content": result_message.tool_result or result_message.content or "",
                }
                if result_message.tool_name:
                    result_block["tool_name"] = result_message.tool_name
                tool_result_blocks.append(result_block)
                matched_ids.add(result_message.tool_call_id)
                index += 1

            for tool_call_id in tool_call_ids:
                if tool_call_id not in matched_ids:
                    tool_result_blocks.append({
                        "type": "tool_result",
                        "tool_use_id": tool_call_id,
                        "content": "Error: tool execution was interrupted.",
                        "is_error": True,
                    })

            messages.append({
                "role": "user",
                "content": tool_result_blocks,
            })
        elif message.role in (AgentMessageRole.USER, AgentMessageRole.ASSISTANT):
            messages.append({
                "role": message.role,
                "content": message.content or "",
            })
            index += 1
        else:
            index += 1

    if not append_new:
        return messages

    if files:
        content_blocks = [
            file_to_content_block(file, supports_vision=supports_vision) for file in files
        ]
        if new_content.strip():
            content_blocks.append({"type": "text", "text": new_content})
        messages.append({
            "role": "user",
            "content": content_blocks,
        })
    else:
        messages.append({
            "role": "user",
            "content": new_content,
        })

    return messages
