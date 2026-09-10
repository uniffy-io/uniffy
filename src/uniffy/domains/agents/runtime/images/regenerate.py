"""Re-run image generation without creating a conversational turn."""

from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.chat.message import ChatMessage, ChatMessageMetadataKind, SenderType
from uniffy.core.models.files.file import File
from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import ContentType
from uniffy.domains.agents.agents.operations import AgentOperations
from uniffy.domains.agents.runtime.images.config import resolve_image_config
from uniffy.domains.agents.runtime.writers import ChatChannelMessageWriter
from uniffy.domains.agents.tools.builtin.content import (
    ORGANIZATION_SPACE,
    PERSONAL_SPACE,
    effective_content_space,
)
from uniffy.domains.agents.tools.builtin.images import generate_image
from uniffy.domains.agents.tools.definitions import ToolContext
from uniffy.domains.chat.access import ChatAccessChecker

logger = logger.bind(component="agents.runtime.images.regenerate")

IMAGE_TOOL = generate_image.name


async def regenerate_image(
    *,
    session: AsyncSession,
    storage: ObjectStorage,
    search_indexer: SearchIndexer,
    user_id: UUID,
    organization_id: UUID,
    channel_id: UUID,
    message_id: UUID,
    params_patch: dict,
) -> tuple[UUID, dict]:
    """Re-run the generation behind `message_id` with adjusted parameters."""
    source = (
        await session.execute(
            select(ChatMessage).where(
                ChatMessage.id == message_id,
                ChatMessage.channel_id == channel_id,
            )
        )
    ).scalar_one_or_none()
    if source is None or source.sender_type != SenderType.AGENT:
        raise NotFoundError("ChatMessage", message_id)

    meta = source.message_metadata or {}
    tool_meta = meta.get("tool_meta") or {}
    if tool_meta.get("kind") != ChatMessageMetadataKind.IMAGE_GENERATION:
        raise ValidationError("message_id", "That message is not a generated image")

    prompt = (tool_meta.get("prompt") or "").strip()
    if not prompt:
        raise ValidationError("message_id", "The original prompt is unavailable")

    space = tool_meta.get("space")
    if space not in {PERSONAL_SPACE, ORGANIZATION_SPACE}:
        raw_file_id = tool_meta.get("file_id")
        try:
            file_id = UUID(raw_file_id)
        except (TypeError, ValueError) as exc:
            raise ValidationError("message_id", "The original image space is unavailable") from exc
        file_row = (
            await session.execute(
                select(File).where(
                    File.id == file_id,
                    File.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if file_row is None:
            raise ValidationError("message_id", "The original image space is unavailable")
        space = await effective_content_space(
            session,
            organization_id,
            ContentType.FILE,
            file_row.access_mode,
            owner_id=file_row.owner_id,
            current_user_id=user_id,
        )
        if space not in {PERSONAL_SPACE, ORGANIZATION_SPACE}:
            raise ValidationError(
                "message_id", "Shared images cannot be regenerated into a new space"
            )

    agent_id = meta.get("agent_id")
    if not agent_id:
        raise ValidationError("message_id", "The source message has no agent")

    # Regeneration spends against the caller, in a channel they can post
    # to - not against whoever triggered the original run.
    access = ChatAccessChecker(session)
    channel = await access.get_channel(channel_id, organization_id)
    await access.check_access(user_id, organization_id, channel)
    await access.require_send(user_id, channel)

    agent = await AgentOperations(session, search_indexer).get_for_runtime(
        user_id, organization_id, UUID(agent_id)
    )
    image_config = await resolve_image_config(session, agent, organization_id=organization_id)
    if image_config is None:
        raise ValidationError("agent", "This agent no longer has image generation configured")

    writer = ChatChannelMessageWriter(
        session=session,
        search_indexer=search_indexer,
        user_id=user_id,
        organization_id=organization_id,
        channel_id=channel_id,
        agent_id=agent.id,
        trigger_message_id=message_id,
        thread_root_id=source.root_id,
    )
    args = {
        **(tool_meta.get("params") or {}),
        **params_patch,
        "prompt": prompt,
        "space": space,
    }
    ctx = ToolContext(
        session=session,
        storage=storage,
        search_indexer=search_indexer,
        user_id=user_id,
        organization_id=organization_id,
        agent_id=agent.id,
        image_params=image_config.params,
        image_max_resolution=image_config.max_resolution,
        image_max_quality=image_config.max_quality,
        integration_connections=agent.integration_connections or {},
    )
    result = await generate_image.executor(ctx, args)
    if not result.success:
        raise ValidationError("image", result.error or "Image generation failed")

    stored = await writer.add_message(
        role="tool",
        content=result.data,
        tool_name=IMAGE_TOOL,
        tool_call_id=f"regen-{message_id}",
        tool_args={k: v for k, v in args.items() if k != "prompt"},  # noqa: PLR2004
        tool_result=result.data,
        tool_metadata=result.metadata,
    )
    return stored.id, result.metadata or {}
