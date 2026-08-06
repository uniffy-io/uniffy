"""Validate and resolve image-generation parameters against the catalog schema.

Image params carry one layer chat params do not: the model picks some of them
per call, because "make it wide" is the natural way a user asks. Precedence is
therefore call args over conversation override over agent default, with the org
ceiling clamping whatever comes out.
"""

from loguru import logger

from uniffy.domains.agents.providers.catalog.loader import get_catalog, get_model
from uniffy.observability.metrics import AGENT_IMAGE_PARAM_DROPPED_TOTAL

logger = logger.bind(component="agents.providers.catalog.image_params")

RESOLUTION_KNOB = "resolution"
QUALITY_KNOB = "quality"
ASPECT_RATIO_KNOB = "aspect_ratio"

# Ascending cost order, used to clamp against the org ceiling. A model whose
# enum omits a tier simply never sees it.
RESOLUTION_ORDER = ("512px", "1K", "2K", "4K")
QUALITY_ORDER = ("low", "medium", "high")


def image_params_schema(provider: str, model_id: str) -> dict:
    """Knob -> ``ParamSpec``-shaped dict for a model, narrowed per model."""
    from uniffy.domains.agents.providers.catalog.loader import get_image_parameter_schema

    return get_image_parameter_schema(provider, model_id) or {}


def validate_image_params(
    provider: str,
    model_id: str,
    params: dict,
    *,
    audience: str = "builder",
) -> None:
    """Raise ``ValueError`` when ``params`` violates the model's image schema.

    ``audience="user"`` additionally rejects builder-only knobs, so a
    per-conversation override cannot loosen moderation or change the stored
    output format.
    """
    if not params:
        return
    pc = get_catalog().providers.get(provider)
    model = get_model(provider, model_id)
    if pc is None or model is None or not model.supports_image_generation:
        raise ValueError(f"model {model_id!r} has no image parameter schema")

    for knob, value in params.items():
        spec = pc.image_params_base.get(knob)
        if spec is None:
            raise ValueError(f"unknown image parameter {knob!r}")
        if knob in model.unsupported_image_params:
            raise ValueError(f"model {model_id!r} does not accept {knob!r}")
        if audience == "user" and spec.audience == "builder":
            raise ValueError(f"image parameter {knob!r} is set on the agent, not per conversation")
        spec.check_value(knob, value)
        members = model.image_enums.get(knob)
        if members and value not in members:
            raise ValueError(f"{knob} {value!r} not supported by model {model_id!r}")
    if params.get("background") == "transparent" and params.get("output_format") == "jpeg":
        raise ValueError("transparent backgrounds require PNG or WebP output")


def clamp_image_params(
    params: dict,
    *,
    max_resolution: str | None = None,
    max_quality: str | None = None,
) -> dict:
    """Clamp cost-driving knobs down to the org ceiling.

    Clamping rather than rejecting keeps a run alive when a builder default or
    an older override sits above a ceiling an admin lowered later.
    """
    clamped = dict(params)
    for knob, ceiling, order in (
        (RESOLUTION_KNOB, max_resolution, RESOLUTION_ORDER),
        (QUALITY_KNOB, max_quality, QUALITY_ORDER),
    ):
        value = clamped.get(knob)
        if not ceiling or ceiling not in order:
            continue
        # "auto" lets the provider pick, which can land above the ceiling.
        effective = "medium" if (knob == QUALITY_KNOB and value == "auto") else value
        if effective is None and knob == QUALITY_KNOB:
            effective = "medium"
        if effective not in order:
            continue
        if order.index(effective) > order.index(ceiling):
            clamped[knob] = ceiling
    return clamped


def resolve_image_params(
    agent_params: dict | None,
    override_params: dict | None,
    call_params: dict | None,
    provider: str,
    model_id: str,
    *,
    max_resolution: str | None = None,
    max_quality: str | None = None,
) -> dict:
    """Merge the three layers, clamp to the ceiling, strip what the model rejects."""
    merged: dict = {
        **(agent_params or {}),
        **(override_params or {}),
        **(call_params or {}),
    }
    merged = clamp_image_params(merged, max_resolution=max_resolution, max_quality=max_quality)
    if not merged:
        return {}

    kept: dict = {}
    for knob, value in merged.items():
        try:
            validate_image_params(provider, model_id, {knob: value})
        except ValueError as exc:
            AGENT_IMAGE_PARAM_DROPPED_TOTAL.labels(provider=provider, param=knob).inc()
            logger.warning(
                "Dropped image param not valid for the target model",
                model=model_id,
                param=knob,
                reason=str(exc),
            )
            continue
        kept[knob] = value
    if kept.get("background") == "transparent" and kept.get("output_format") == "jpeg":
        kept["output_format"] = "png"
    return kept


def strip_unsupported_image_params(provider: str, model_id: str, params: dict) -> dict:
    """Drop knobs a newly selected image model rejects, for a stored layer."""
    kept: dict = {}
    for knob, value in (params or {}).items():
        try:
            validate_image_params(provider, model_id, {knob: value})
        except ValueError:
            continue
        kept[knob] = value
    if kept.get("background") == "transparent" and kept.get("output_format") == "jpeg":
        kept["output_format"] = "png"
    return kept
