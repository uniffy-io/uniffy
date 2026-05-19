"""Built-in image generation tool for agents."""

from __future__ import annotations

import os
import time

from loguru import logger

from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult


async def _execute_generate_image(ctx: ToolContext, args: dict) -> ToolResult:
    """Generate an image from a text prompt and store it as a file.

    Retrieves the agent's configured image_model, calls the appropriate
    provider's image generation API, uploads the result to S3, creates
    File and FileVersion records in the user's Attachments folder, and
    enqueues thumbnail generation jobs.

    Parameters
    ----------
    ctx : ToolContext
        Execution context with session, user_id, organization_id, agent_id.
    args : dict
        Tool arguments: prompt (required), size (optional), quality (optional).

    Returns
    -------
    ToolResult
        Result containing the generated file's URN and details.

    """
    from sqlalchemy import select

    from uniffy.core.models.agents.agent import Agent
    from uniffy.core.models.agents.run_log import AgentRunLog
    from uniffy.core.models.files.file import ExtractionStatus, File
    from uniffy.core.models.files.file_version import FileVersion
    from uniffy.core.search.indexer import build_content_urn
    from uniffy.core.storage import get_s3_client
    from uniffy.core.types import ContentType, generate_id
    from uniffy.domains.agents.providers.operations import ProviderOperations
    from uniffy.domains.attachments.operations import AttachmentOperations

    prompt = args.get("prompt", "").strip()
    if not prompt:
        return ToolResult(success=False, data="", error="prompt is required")

    size = args.get("size", "1024x1024")
    quality = args.get("quality", "auto")

    if not ctx.agent_id:
        return ToolResult(
            success=False,
            data="",
            error="No agent context available",
        )

    # Load the agent to get image_model
    result = await ctx.session.execute(select(Agent).where(Agent.id == ctx.agent_id))
    agent = result.scalar_one_or_none()
    if not agent or not agent.image_model:
        return ToolResult(
            success=False,
            data="",
            error="No image model configured for this agent. "
            "Ask an admin to set an image model in the agent configuration.",
        )

    image_model = agent.image_model

    from uniffy.core.valkey.rate_limit import check_image_generation_limits
    from uniffy.domains.agents.budgets.image_quota import check_image_quota

    await check_image_generation_limits(
        ctx.session,
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
    )
    await check_image_quota(
        ctx.session,
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
    )

    # Get the provider - use agent's assigned image key if set, else auto-resolve
    provider_ops = ProviderOperations(ctx.session)
    image_provider_key_id = None

    if agent.image_provider_key_id:
        provider, pk = await provider_ops.get_provider_for_key(
            organization_id=ctx.organization_id,
            key_id=agent.image_provider_key_id,
        )
        image_provider_key_id = pk.id
    else:
        provider = await provider_ops.get_provider_for_model(
            organization_id=ctx.organization_id,
            model_id=image_model,
        )

    # Generate the image and track duration
    gen_start = time.monotonic()
    image_bytes, mime_type = await provider.generate_image(
        prompt,
        model=image_model,
        size=size,
        quality=quality,
    )
    gen_duration_ms = int((time.monotonic() - gen_start) * 1000)

    # Upload to S3
    file_id = generate_id()
    ext = "png" if mime_type == "image/png" else "webp"
    filename = f"generated-image-{file_id}.{ext}"
    storage_key = f"{ctx.organization_id}/{ctx.user_id}/{file_id}/{filename}"

    s3 = get_s3_client()
    await s3.upload_bytes(
        key=storage_key,
        data=image_bytes,
        content_type=mime_type,
    )

    # Get or create the user's Attachments folder
    attach_ops = AttachmentOperations(ctx.session)
    folder = await attach_ops.get_or_create_attachments_folder(
        ctx.user_id,
        ctx.organization_id,
    )

    # Determine storage bucket name from env (same as S3Client config)
    bucket_name = os.getenv("S3_BUCKET", "uniffy")

    # Create File record
    file_record = File(
        id=file_id,
        organization_id=ctx.organization_id,
        owner_id=ctx.user_id,
        filename=filename,
        original_filename=filename,
        mime_type=mime_type,
        size_bytes=len(image_bytes),
        storage_key=storage_key,
        storage_bucket=bucket_name,
        folder_id=folder.id,
        extraction_status=ExtractionStatus.PENDING,
        description=f"AI-generated image: {prompt[:200]}",
    )
    ctx.session.add(file_record)
    await ctx.session.flush()

    # Create FileVersion record
    version = FileVersion(
        file_id=file_id,
        version_number=1,
        size_bytes=len(image_bytes),
        storage_key=storage_key,
        storage_bucket=bucket_name,
        uploaded_by=ctx.user_id,
    )
    ctx.session.add(version)
    await ctx.session.flush()

    file_record.current_version_id = version.id
    await ctx.session.flush()

    # Enqueue thumbnail generation jobs
    from uniffy.workers.utils.mime import get_jobs_for_mime_type

    jobs = get_jobs_for_mime_type(mime_type)
    if jobs:
        try:
            from uniffy.core.valkey import get_queue

            queue = get_queue("core")
            for job_name in jobs:
                await queue.enqueue_job(
                    job_name,
                    str(file_id),
                    str(ctx.organization_id),
                )
        except RuntimeError:
            pass

    # Build the file URN and index for search
    file_urn = build_content_urn(ContentType.FILE, file_id)

    from uniffy.core.search.indexer import SearchIndexer

    indexer = SearchIndexer()
    description = f"AI-generated image: {prompt[:200]}"
    keywords = " ".join(filter(None, [filename, description, mime_type]))
    await indexer.index(
        urn=file_urn,
        organization_id=ctx.organization_id,
        title=filename,
        entity_type=ContentType.FILE.value,
        url_path=f"/files/{file_id}",
        access_mode=file_record.access_mode,
        baseline_role=file_record.baseline_role,
        owner_id=ctx.user_id,
        keywords=keywords,
        description=description,
        metadata={"mime_type": mime_type, "image_model": image_model},
    )

    from uniffy.domains.agents.budget_alerts import check_and_fire_alerts
    from uniffy.domains.agents.currency import (
        convert as convert_currency,
    )
    from uniffy.domains.agents.currency import (
        get_display_currency,
    )
    from uniffy.domains.agents.pricing import compute_image_cost, get_pricing

    image_cost = None
    image_cost_currency = None
    try:
        pricing = await get_pricing(
            ctx.session, provider=provider.name, model=image_model,
        )
        if pricing is not None:
            raw_cost = compute_image_cost(
                pricing, size=size, quality=quality, count=1,
            )
            if raw_cost is not None:
                display_currency = await get_display_currency(
                    ctx.session, ctx.organization_id,
                )
                image_cost = await convert_currency(
                    raw_cost,
                    pricing.currency,
                    display_currency,
                    ctx.session,
                    ctx.organization_id,
                )
                image_cost_currency = display_currency
    except Exception:
        logger.warning("Image cost calculation failed", exc_info=True)

    # Log image model usage so it appears in usage analytics
    if ctx.session_id and ctx.agent_id:
        try:
            run_log = AgentRunLog(
                session_id=ctx.session_id,
                agent_id=ctx.agent_id,
                user_id=ctx.user_id,
                organization_id=ctx.organization_id,
                model=image_model,
                provider_key_id=image_provider_key_id,
                input_tokens=0,
                output_tokens=0,
                tool_calls=None,
                tool_iterations=0,
                duration_ms=gen_duration_ms,
                status="success",
                error=None,
                image_count=1,
                cost=image_cost,
                cost_currency=image_cost_currency,
            )
            ctx.session.add(run_log)
        except Exception:
            logger.warning(
                "Failed to create image generation run log",
                exc_info=True,
            )

    await ctx.session.commit()

    try:
        await check_and_fire_alerts(
            ctx.session,
            organization_id=ctx.organization_id,
            run_cost=image_cost,
            run_image_count=1,
        )
    except Exception:
        logger.warning("Image alert fan-out failed", exc_info=True)

    mention = f"[[[{filename}|{file_urn}]]]"

    return ToolResult(
        success=True,
        data=(
            f"Image generated successfully.\n"
            f"File: {filename}\n"
            f"URN: {file_urn}\n"
            f"Mention: {mention}\n"
            f"Size: {len(image_bytes)} bytes\n"
            f"Model: {image_model}\n"
            f"Prompt: {prompt[:100]}\n\n"
            f"Use this exact mention to reference the image: {mention}"
        ),
    )


generate_image = ToolDefinition(
    name="images.generate_image",
    description=(
        "Generate an image from a text prompt using AI. "
        "The image is saved as a file in the user's Attachments folder. "
        "Returns the file URN that can be referenced in notes or messages."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": ("A detailed text description of the image to generate."),
            },
            "size": {
                "type": "string",
                "description": (
                    "Image dimensions. Options: '1024x1024' (square), "
                    "'1536x1024' (landscape), '1024x1536' (portrait). "
                    "Default: '1024x1024'."
                ),
                "enum": ["1024x1024", "1536x1024", "1024x1536"],
                "default": "1024x1024",
            },
            "quality": {
                "type": "string",
                "description": (
                    "Image quality. 'auto' for default, "
                    "'high' for higher quality, "
                    "'low' for faster generation."
                ),
                "enum": ["auto", "high", "low"],
                "default": "auto",
            },
        },
        "required": ["prompt"],
    },
    executor=_execute_generate_image,
    destructive=False,
    timeout_seconds=60,
)

IMAGES_TOOLS: list[ToolDefinition] = [generate_image]
