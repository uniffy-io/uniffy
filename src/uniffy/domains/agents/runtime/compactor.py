"""Reusable conversation summariser shared by session + chat compaction.

Phase 8c extraction. The summary prompt + provider call lived inside
`SessionOperations.compact_session_if_needed`; the chat path
(`ChatAgentContextOperations.compact`) needs the same primitive.

The helper is deliberately format-agnostic. Callers shape the message
list into `(speaker_label, content)` tuples (e.g. "USER", "ASSISTANT",
"[Tool: notes.search]") so the summariser's prompt stays uniform across
both surfaces. The model + provider are passed in so the caller controls
provider/model resolution against the agent config.
"""

from __future__ import annotations

from dataclasses import dataclass

from loguru import logger

from uniffy.domains.agents.providers.base import LLMProvider

_SUMMARY_SYSTEM_PROMPT = "You are a conversation summarizer. Produce a concise summary."

_SUMMARY_USER_PROMPT_TEMPLATE = (
    "Summarize the following conversation, preserving key facts, "
    "decisions, user preferences, and any referenced content URNs. "
    "Be concise but thorough. Do not lose important details.\n\n{body}"
)


@dataclass(frozen=True)
class SummaryResult:
    """Outcome of a single summarisation call."""

    content: str
    input_tokens: int
    output_tokens: int


def format_conversation_lines(entries: list[tuple[str, str]]) -> str:
    """Render `(label, content)` tuples into the conversation block text.

    Empty contents are skipped (matches the pre-extraction behaviour).
    """
    rendered = [f"{label}: {body}" for label, body in entries if body]
    return "\n".join(rendered)


async def summarise_conversation(
    *,
    provider: LLMProvider,
    model: str,
    entries: list[tuple[str, str]],
) -> SummaryResult | None:
    """Run the LLM summariser over the conversation entries.

    Returns `None` when the rendered conversation is empty (nothing to
    summarise) or the provider produced empty content. Errors are logged
    and re-raised so the caller can decide whether the parent operation
    should fail or no-op.
    """
    body = format_conversation_lines(entries)
    if not body:
        return None

    try:
        result = await provider.chat_completion(
            messages=[{"role": "user", "content": _SUMMARY_USER_PROMPT_TEMPLATE.format(body=body)}],
            model=model,
            system=_SUMMARY_SYSTEM_PROMPT,
        )
    except Exception as exc:
        logger.error(f"Compaction summarisation failed: {exc}")
        raise

    if not result.content:
        return None

    return SummaryResult(
        content=result.content,
        input_tokens=int(getattr(result, "input_tokens", 0) or 0),
        output_tokens=int(getattr(result, "output_tokens", 0) or 0),
    )
