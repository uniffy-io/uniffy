"""Provider context-window resolution for runtime compaction budgets."""

from uniffy.domains.agents.providers.base import LLMProvider
from uniffy.domains.agents.sessions.operations import FALLBACK_CONTEXT_WINDOW


async def resolve_context_window(provider: LLMProvider, model: str) -> int:
    try:
        available = await provider.get_available_models()
        for candidate in available:
            if candidate.id == model:
                return candidate.context_window
    except Exception:
        pass
    return FALLBACK_CONTEXT_WINDOW
