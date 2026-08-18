"""Built-in image generation tool for agents."""

from __future__ import annotations

import hashlib
import os
import time

from loguru import logger

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.content.references import sanitize_mention_label
from uniffy.core.models.audit.event import AuditActorKind, AuditResourceType
from uniffy.core.models.chat.message import ChatMessageMetadataKind
from uniffy.domains.agents.providers.catalog import (
    get_image_parameter_schema,
    resolve_image_params,
)
from uniffy.domains.agents.providers.catalog.schema import ParamAudience
from uniffy.domains.agents.tools.builtin.content_space import (
    creation_space_schema,
    parse_creation_space,
    space_for_access_mode,
)
from uniffy.domains.agents.tools.definitions import (
    CATEGORY_EXTERNAL,
    ToolContext,
    ToolDefinition,
    ToolResult,
)

logger = logger.bind(component="agents.tools.builtin.images")

_EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}

_KNOB_HINTS = {
    "aspect_ratio": "Shape of the image. Pick the one that fits how the image will be used.",
    "resolution": (
        "Output size tier. Higher tiers cost multiples of the lower ones, "
        "so only raise it when the user asks for a large or print-quality image."
    ),
    "quality": "Rendering effort. 'high' costs substantially more than 'low'.",
    "background": "Use 'transparent' only when the user wants a cut-out with no backdrop.",
}


async def _execute_generate_image(ctx: ToolContext, args: dict) -> ToolResult:
    """Generate an image from a text prompt and store it in Attachments.

    Knobs merge call args over the params the runtime resolved for this run,
    then get stripped to what the target model accepts.
    """
    from sqlalchemy import select

    from uniffy.core.models.agents.agent import Agent
    from uniffy.core.models.agents.run_log import AgentRunLog
    from uniffy.core.models.files.file import ExtractionStatus, File
    from uniffy.core.models.files.file_version import FileVersion
    from uniffy.core.search.indexer import build_content_urn
    from uniffy.core.storage import get_s3_client
    from uniffy.core.types import AccessMode, ContentType, generate_id
    from uniffy.domains.agents.providers.operations import ProviderOperations
    from uniffy.domains.files.attachments.operations import AttachmentOperations

    prompt = args.get("prompt", "").strip()
    if not prompt:
        return ToolResult(success=False, data="", error="prompt is required")

    access_mode, space_err = parse_creation_space(args)
    if space_err:
        return ToolResult(success=False, data="", error=space_err)
    assert access_mode is not None
    created_space = space_for_access_mode(access_mode, None)

    call_params = {k: v for k, v in args.items() if k not in {"prompt", "space"}}

    if not ctx.agent_id:
        return ToolResult(
            success=False,
            data="",
            error="No agent context available",
        )

    # Load the agent to get image_model
    result = await ctx.session.execute(
        select(Agent).where(
            Agent.id == ctx.agent_id,
            Agent.organization_id == ctx.organization_id,
        )
    )
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

    params = resolve_image_params(
        ctx.image_params,
        None,
        call_params,
        provider.name,
        image_model,
        max_resolution=ctx.image_max_resolution,
        max_quality=ctx.image_max_quality,
    )
    size = provider.image_billing_size(image_model, params)
    quality = params.get("quality", "auto")

    style = (agent.image_style_prompt or "").strip()
    full_prompt = f"{prompt}\n\nStyle: {style}" if style else prompt

    # Generate the image and track duration
    gen_start = time.monotonic()
    image_bytes, mime_type = await provider.generate_image(
        full_prompt,
        model=image_model,
        params=params,
    )
    gen_duration_ms = int((time.monotonic() - gen_start) * 1000)

    # Upload to S3
    file_id = generate_id()
    ext = _EXTENSIONS.get(mime_type, "png")
    filename = f"generated-image-{file_id}.{ext}"
    storage_key = f"{ctx.organization_id}/{ctx.user_id}/{file_id}/{filename}"

    s3 = get_s3_client()
    await s3.upload_bytes(
        key=storage_key,
        data=image_bytes,
        content_type=mime_type,
    )

    attach_ops = AttachmentOperations(ctx.session)
    if access_mode == AccessMode.OPEN_TO_ORG:
        folder = await attach_ops.get_or_create_org_attachments_folder(ctx.organization_id)
    else:
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
        access_mode=access_mode,
        baseline_role=None,
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
    from uniffy.domains.agents.pricing import (
        PRICING_CURRENCY,
        compute_image_cost,
        get_pricing,
    )

    image_cost = None
    image_cost_currency = None
    try:
        pricing = get_pricing(provider=provider.name, model=image_model)
        if pricing is not None:
            raw_cost = compute_image_cost(
                pricing,
                size=size,
                quality=quality,
                count=1,
            )
            if raw_cost is not None:
                display_currency = await get_display_currency(
                    ctx.session,
                    ctx.organization_id,
                )
                image_cost = await convert_currency(
                    raw_cost,
                    PRICING_CURRENCY,
                    display_currency,
                    ctx.session,
                    ctx.organization_id,
                )
                image_cost_currency = display_currency
    except Exception as exc:
        logger.exception(f"Image cost calculation failed: {exc!r}")

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
                kind="image",
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
            logger.opt(exception=True).warning("Failed to create image generation run log")

    try:
        await write_audit_event(
            ctx.session,
            organization_id=ctx.organization_id,
            actor_user_id=ctx.user_id,
            action=Action.AGENT_IMAGE_GENERATION,
            resource_type=AuditResourceType.FILE,
            resource_id=file_id,
            details={
                "actor_kind": AuditActorKind.AGENT,
                "agent_id": str(ctx.agent_id),
                "model_id": image_model,
                "prompt_hash": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
                "output_file_urn": file_urn,
                "size": size,
                "quality": quality,
                "image_params": params,
                "tokens": 0,
                "cost": float(image_cost) if image_cost is not None else 0.0,
                "cost_currency": image_cost_currency,
                "duration_ms": gen_duration_ms,
            },
        )
    except Exception:
        logger.opt(exception=True).warning("Image generation audit emission failed")

    await ctx.session.commit()

    if access_mode == AccessMode.OPEN_TO_ORG:
        from uniffy.core.converters.common_proto import content_type_to_proto
        from uniffy.core.valkey import ContentAccessAction, publish_content_access_changed

        await publish_content_access_changed(
            content_type=content_type_to_proto(ContentType.FILE),
            content_id=file_id,
            action=ContentAccessAction.GRANTED,
            organization_id=ctx.organization_id,
        )

    # Enqueue thumbnail/extraction jobs only after the file row is committed, so
    # the core worker can load it - mirrors FileOperations._enqueue_processing_jobs.
    # This runs inside the EGRESS worker, which only initialises its own pool, so
    # it has to reach the core queue through the lazy-reconnect accessor; the
    # raising one would leave every generated image without a thumbnail.
    from uniffy.core.valkey import QueueName, get_queue_safe
    from uniffy.workers.utils.mime import get_jobs_for_mime_type

    jobs = get_jobs_for_mime_type(mime_type)
    if jobs:
        queue = await get_queue_safe(QueueName.CORE)
        if queue is None:
            logger.warning(
                "Core queue unavailable; generated image has no thumbnail",
                file_id=str(file_id),
            )
        else:
            for job_name in jobs:
                await queue.enqueue_job(
                    job_name,
                    str(file_id),
                    str(ctx.organization_id),
                )

    try:
        await check_and_fire_alerts(
            ctx.session,
            organization_id=ctx.organization_id,
            run_cost=image_cost,
            run_image_count=1,
        )
    except Exception:
        logger.opt(exception=True).warning("Image alert fan-out failed")

    mention = f"[[[{sanitize_mention_label(filename)}|{file_urn}]]]"

    return ToolResult(
        success=True,
        data=(
            f"Image generated successfully in {created_space.title()}.\n"
            f"File: {filename}\n"
            f"URN: {file_urn}\n"
            f"Mention: {mention}\n"
            f"Size: {len(image_bytes)} bytes\n"
            f"Model: {image_model}\n"
            f"Prompt: {prompt[:100]}\n\n"
            f"Use this exact mention to reference the image: {mention}"
        ),
        metadata={
            "kind": ChatMessageMetadataKind.IMAGE_GENERATION,
            "prompt": prompt,
            "space": created_space,
            "params": params,
            "file_id": str(file_id),
            "file_urn": file_urn,
            "model": image_model,
            "cost": float(image_cost) if image_cost is not None else None,
            "cost_currency": image_cost_currency,
        },
    )


def build_image_tool_schema(provider: str, model_id: str) -> dict:
    """Tool schema for the image model an agent actually runs on.

    The static definition below is a fallback for agents with no image model.
    Once one resolves, the runtime swaps in this schema so the enums match what
    the provider accepts and the model cannot emit a value that would 400.
    Builder-audience knobs are left out entirely - they are the builder's call,
    not the LLM's.
    """
    schema: dict = {
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": "A detailed text description of the image to generate.",
            },
            "space": creation_space_schema(),
        },
        "required": ["prompt"],
    }
    for knob, spec in (get_image_parameter_schema(provider, model_id) or {}).items():
        if spec.get("audience") == ParamAudience.BUILDER or spec.get("type") != "enum":  # noqa: PLR2004
            continue
        entry: dict = {"type": "string", "enum": list(spec["enum"])}
        default = spec.get("default")
        hint = _KNOB_HINTS.get(knob, "")
        if default is not None:
            entry["description"] = (
                f"{hint} Omit to use the configured default ({default})."
            ).strip()
        elif hint:
            entry["description"] = hint
        schema["properties"][knob] = entry
    return schema


generate_image = ToolDefinition(
    name="images.generate_image",
    display_name="Generate Image",
    group="Images",
    category=CATEGORY_EXTERNAL,
    description=(
        "Generate an image from a text prompt using AI. "
        "The image is saved as a Personal file unless the user explicitly requests "
        "Organization. "
        "Returns the file URN that can be referenced in notes or messages. "
        "Omit the optional knobs unless the user asked for a specific shape or size - "
        "the agent's configured defaults apply otherwise."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": ("A detailed text description of the image to generate."),
            },
            "space": creation_space_schema(),
        },
        "required": ["prompt"],
    },
    executor=_execute_generate_image,
    destructive=False,
    timeout_seconds=300,
)

IMAGES_TOOLS: list[ToolDefinition] = [generate_image]
