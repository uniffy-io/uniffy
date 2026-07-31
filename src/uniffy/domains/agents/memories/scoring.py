"""Lexical scoring of memory entries against a message, language-neutral.

`word_similarity` is the load-bearing choice: `similarity()` normalises by
combined length and scores a genuine CJK substring match at ~0.3, right at
the usual threshold. `unaccent` runs on both sides so accented Latin matches
its bare form. An escaped ILIKE is OR-ed in because trigrams miss short CJK
queries, and it is the only path for queries under MIN_TRIGRAM_QUERY_CHARS.

The haystack is key + description + a CONTENT PREFIX, never full content, and
the query is hard-capped: word_similarity cost scales with BOTH string lengths,
and full 4KB bodies measured ~650ms across three full buckets on the request
path versus ~86ms at quota with these caps (sub-ms on typical bucket sizes). Key and
description are the designed match surface (descriptions are trigger-shaped);
full-content search stays available through memory.read's query mode, where an
explicit tool call can afford it.
"""

from typing import Protocol
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.memory import AgentMemory, MemorySource
from uniffy.domains.agents.memories.sanitize import escape_like
from uniffy.domains.agents.memories.scope import MemoryScopeRef, scope_filters

MIN_TRIGRAM_QUERY_CHARS = 3
MAX_QUERY_CHARS = 256
CONTENT_PREFIX_CHARS = 128
RECALL_SCORE_THRESHOLD = 0.55


class MemoryScorer(Protocol):
    async def score(
        self,
        session: AsyncSession,
        *,
        organization_id: UUID,
        refs: list[MemoryScopeRef],
        query: str,
        threshold: float = RECALL_SCORE_THRESHOLD,
        limit: int = 8,
    ) -> list[tuple[AgentMemory, float]]: ...


class TrigramMemoryScorer:
    async def score(
        self,
        session: AsyncSession,
        *,
        organization_id: UUID,
        refs: list[MemoryScopeRef],
        query: str,
        threshold: float = RECALL_SCORE_THRESHOLD,
        limit: int = 8,
    ) -> list[tuple[AgentMemory, float]]:
        query = query.strip()[:MAX_QUERY_CHARS]
        if not query or not refs:
            return []

        bucket_filter = or_(
            *[and_(*scope_filters(organization_id, ref)) for ref in refs]
        )
        haystack = func.concat_ws(
            " ",
            AgentMemory.key,
            AgentMemory.description,
            func.left(AgentMemory.content, CONTENT_PREFIX_CHARS),
        )
        score = func.word_similarity(func.unaccent(query), func.unaccent(haystack))

        pattern = f"%{escape_like(query)}%"
        substring = haystack.ilike(pattern, escape="\\")
        matches = (
            or_(score > threshold, substring)
            if len(query) >= MIN_TRIGRAM_QUERY_CHARS
            else substring
        )
        # An agent-written "instructions" entry never rides into context
        # unrequested; it stays behind the memory.read pull.
        not_tool_instructions = ~and_(
            AgentMemory.source == MemorySource.TOOL.value,
            AgentMemory.category == "instructions",
        )

        stmt = (
            select(AgentMemory, score.label("recall_score"))
            .where(bucket_filter, matches, not_tool_instructions)
            .order_by(
                score.desc(),
                AgentMemory.access_count.desc(),  # type: ignore[union-attr]
                AgentMemory.updated_at.desc(),
            )
            .limit(limit)
        )
        rows = (await session.execute(stmt)).all()
        return [(row[0], float(row[1])) for row in rows]


def script_class(text: str) -> str:
    """Coarse script label for metrics, decided by the first alphabetic char.

    Keeps non-Latin recall visible in dashboards without ever labelling
    content: the value set is fixed and tiny.
    """
    for ch in text:
        if not ch.isalpha():
            continue
        cp = ord(ch)
        if cp < 0x0250:
            return "latin"
        if 0x0400 <= cp <= 0x052F:
            return "cyrillic"
        if (
            0x3040 <= cp <= 0x30FF
            or 0x3400 <= cp <= 0x4DBF
            or 0x4E00 <= cp <= 0x9FFF
            or 0xAC00 <= cp <= 0xD7AF
        ):
            return "cjk"
        return "other"
    return "none"
