from loguru import logger

from uniffy.domains.agents.metrics import AGENT_OUTPUT_REPAIRS_TOTAL
from uniffy.domains.agents.providers.catalog.loader import list_provider_ids
from uniffy.domains.agents.runtime.output_format import OutputSurface, normalize_model_markdown

logger = logger.bind(component="agents.runtime.output")

_PROVIDERS = frozenset(list_provider_ids())


def prepare_model_markdown(
    text: str,
    *,
    surface: OutputSurface,
    provider: str | None,
    model: str | None,
    agent_name: str | None = None,
) -> str:
    content, repairs = normalize_model_markdown(text, surface=surface, agent_name=agent_name)
    if repairs:
        provider_label = provider if provider in _PROVIDERS else "unknown"
        for kind in repairs:
            AGENT_OUTPUT_REPAIRS_TOTAL.labels(
                kind=kind, surface=surface.value, provider=provider_label
            ).inc()
        logger.warning(
            "Repaired model Markdown",
            kinds=repairs,
            surface=surface.value,
            provider=provider_label,
            model=model,
        )
    return content
