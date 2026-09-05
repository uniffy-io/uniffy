"""Skill-evolution analyzer: turn a finished conversation into pending drafts.

The analyzer only ever proposes drafts (``status=pending``); it never activates
a skill. Saving a draft is always an explicit user action through
``SaveSkillDraft`` - this module must preserve that invariant.
"""

import os
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, or_, select

from uniffy.core.json_codec import loads
from uniffy.core.models.agents.message import AgentMessage, AgentMessageRole
from uniffy.core.models.agents.message_feedback import AgentFeedbackRating, AgentMessageFeedback
from uniffy.core.models.agents.skill import AgentSkill
from uniffy.core.models.agents.skill_draft import (
    AgentSkillDraft,
    AgentSkillDraftKind,
    AgentSkillDraftStatus,
)
from uniffy.core.models.agents.skill_usage import AgentSkillUsage
from uniffy.core.models.chat.message import ChatMessageMetadataKind, ChatMessageVisibility
from uniffy.domains.agents.skills.operations import SkillOperations
from uniffy.domains.agents.skills.validation import (
    SKILL_DESCRIPTION_MAX,
    SKILL_DISPLAY_NAME_MAX,
    SKILL_NAME_MAX,
    cap_preserving_mentions,
    has_hard_injection,
    sanitize_skill_text,
)
from uniffy.infrastructure.valkey.ops import get_ops_client

logger = logger.bind(component="agents.skills.analysis")

_TRANSCRIPT_MESSAGE_CAP = 60
_TRANSCRIPT_CHAR_CAP = 16000
_CONTENT_CHAR_CAP = 8000
_MAX_PROPOSALS = 3
_TOOL_ERROR_PREFIXES = (
    "Not found:",
    "Permission denied:",
    "Validation error:",
    "Internal error:",
)

_OPT_IN_NAMESPACE = "agents"
_OPT_IN_KEY = "skill_evolution_enabled"
_DEFAULT_DAILY_BUDGET = 50
# A draft the user discarded stays suppressed for this long so the analyzer
# does not re-propose the same idea on the next run and nag the user.
_RECENTLY_RESOLVED_DAYS = 14


@dataclass
class SkillProposal:
    """One analyzer suggestion before it becomes a draft row."""

    action: AgentSkillDraftKind
    name: str
    display_name: str
    content: str
    description: str = ""
    target_skill_name: str = ""
    rationale: str = ""


@dataclass
class ActiveSkill:
    skill_id: UUID
    name: str
    display_name: str
    viewed: bool


@dataclass
class SessionSignals:
    """What the analyzer learned about a conversation before prompting the LLM."""

    transcript: str
    active_skills: list[ActiveSkill] = field(default_factory=list)
    negative_feedback: int = 0
    tool_errors: dict[str, int] = field(default_factory=dict)

    @property
    def advertised_not_viewed(self) -> list[ActiveSkill]:
        return [s for s in self.active_skills if not s.viewed]


async def is_skill_evolution_enabled(session, organization_id: UUID) -> bool:
    """Resolve the per-org opt-in, falling back to the deploy-time env default.

    Off by default so self-hosted/air-gapped deployments never call an LLM for
    background analysis without the operator turning it on.
    """
    from uniffy.core.config.settings.organization import OrgSettingsOperations

    settings = await OrgSettingsOperations(session).get_namespace(organization_id, _OPT_IN_NAMESPACE)
    row = settings.get(_OPT_IN_KEY)
    if row is not None and row.value is not None:
        return bool(row.value)
    return os.getenv("AGENT_SKILL_EVOLUTION_ENABLED", "false").strip().lower() == "true"  # noqa: PLR2004


async def consume_analysis_budget(organization_id: UUID) -> bool:
    """Reserve one analysis run against the per-org daily budget.

    Returns False when the org is over budget or Valkey is unavailable (fail
    closed - a missing budget counter must not let the analyzer run unbounded).
    """
    client = get_ops_client()
    if client is None:
        return False
    try:
        cap = int(os.getenv("AGENT_SKILL_ANALYSIS_DAILY_BUDGET", str(_DEFAULT_DAILY_BUDGET)))
    except ValueError:
        cap = _DEFAULT_DAILY_BUDGET
    if cap <= 0:
        return False
    day = datetime.now(UTC).strftime("%Y%m%d")
    key = f"skill_analysis_budget:{organization_id}:{day}"
    try:
        count = await client.incr(key)
        if count == 1:
            await client.expire(key, 86400)
    except Exception:
        return False
    return count <= cap


def _is_tool_error(tool_result: str | None) -> bool:
    if not tool_result:
        return False
    if tool_result.startswith(_TOOL_ERROR_PREFIXES):
        return True
    if '"success": false' in tool_result or '"success":false' in tool_result:  # noqa: PLR2004
        return True
    return "exceeded" in tool_result and "timeout" in tool_result  # noqa: PLR2004


def _format_turn(msg: AgentMessage) -> str | None:
    role = msg.role
    if role == AgentMessageRole.USER:
        return f"User: {(msg.content or '').strip()}" if msg.content else None
    if role == AgentMessageRole.ASSISTANT:
        return f"Assistant: {(msg.content or '').strip()}" if msg.content else None
    if role == AgentMessageRole.TOOL:
        status = "error" if _is_tool_error(msg.tool_result) else "ok"
        return f"[tool {msg.tool_name or '?'} -> {status}]"
    return None


class SkillEvolutionAnalyzer:
    """Gather conversation signals and turn LLM suggestions into pending drafts."""

    def __init__(self, session) -> None:
        self._session = session

    async def gather_session_signals(
        self, *, session_id: UUID, organization_id: UUID
    ) -> SessionSignals | None:
        rows = (
            (
                await self._session.execute(
                    select(AgentMessage)
                    .where(
                        AgentMessage.session_id == session_id,
                        AgentMessage.is_invalidated == False,  # noqa: E712
                        AgentMessage.is_compacted == False,  # noqa: E712
                        AgentMessage.role != AgentMessageRole.SUMMARY,
                    )
                    .order_by(AgentMessage.created_at.desc())
                    .limit(_TRANSCRIPT_MESSAGE_CAP)
                )
            )
            .scalars()
            .all()
        )
        messages = list(reversed(rows))
        transcript = self._build_transcript(messages)
        if not transcript:
            return None

        tool_errors: dict[str, int] = {}
        for msg in messages:
            if msg.role == AgentMessageRole.TOOL and _is_tool_error(msg.tool_result):
                name = msg.tool_name or "unknown"
                tool_errors[name] = tool_errors.get(name, 0) + 1

        negative = (
            await self._session.execute(
                select(AgentMessageFeedback.agents_message_id)
                .join(AgentMessage, AgentMessage.id == AgentMessageFeedback.agents_message_id)
                .where(
                    AgentMessage.session_id == session_id,
                    AgentMessageFeedback.rating == AgentFeedbackRating.DOWN,
                )
            )
        ).all()

        active = await self._load_active_skills(session_id)
        return SessionSignals(
            transcript=transcript,
            active_skills=active,
            negative_feedback=len(negative),
            tool_errors=tool_errors,
        )

    async def gather_channel_signals(
        self, *, channel_id: UUID, organization_id: UUID
    ) -> SessionSignals | None:
        """Transcript-only signals for a team-chat channel agent turn."""
        from uniffy.core.models.chat.message import ChatMessage, SenderType

        rows = (
            (
                await self._session.execute(
                    select(ChatMessage)
                    .where(
                        ChatMessage.channel_id == channel_id,
                        ChatMessage.is_deleted == False,  # noqa: E712
                        ChatMessage.sender_type.in_([SenderType.USER, SenderType.AGENT]),
                    )
                    .order_by(ChatMessage.created_at.desc())
                    .limit(_TRANSCRIPT_MESSAGE_CAP)
                )
            )
            .scalars()
            .all()
        )

        lines: list[str] = []
        for msg in reversed(rows):
            meta = msg.message_metadata or {}
            # A channel agent stamps a 'kind' on every row it writes; only
            # kind='final' replies are the human-facing turns, so keep those
            # and the user rows (which carry no kind) while dropping internal
            # visibility and non-final agent rows (tool_call/tool_result/summary/...).
            kind = meta.get("kind")
            if meta.get("visibility") == ChatMessageVisibility.AGENT_INTERNAL or (
                kind and kind != ChatMessageMetadataKind.FINAL
            ):
                continue
            body = (msg.content or "").strip()
            if not body:
                continue
            who = "Assistant" if msg.sender_type == SenderType.AGENT else "User"
            lines.append(f"{who}: {body}")
        transcript = self._cap_transcript(lines)
        if not transcript:
            return None
        return SessionSignals(transcript=transcript)

    async def run_analysis(
        self, *, signals: SessionSignals, provider, model: str
    ) -> list[SkillProposal]:
        """Prompt the LLM with the gathered signals and parse its proposals."""
        system, user = build_analysis_messages(signals)
        result = await provider.chat_completion(
            messages=[{"role": "user", "content": user}],
            model=model,
            system=system,
        )
        return parse_proposals(result.content)

    async def apply_proposals(
        self,
        proposals: list[SkillProposal],
        *,
        organization_id: UUID,
        user_id: UUID,
        agent_id: UUID,
        session_id: UUID | None,
        channel_id: UUID | None,
        active_skills: list[ActiveSkill],
    ) -> list[AgentSkillDraft]:
        """Persist accepted proposals as pending drafts; never activates a skill."""
        if not proposals:
            return []

        skill_ops = SkillOperations(self._session)
        name_index: dict[str, UUID] = {}
        for s in active_skills:
            name_index[s.name.lower()] = s.skill_id
            name_index[s.display_name.lower()] = s.skill_id

        existing = await self._suppressed_draft_keys(organization_id=organization_id)
        created: list[AgentSkillDraft] = []
        for proposal in proposals[:_MAX_PROPOSALS]:
            prepared = self._prepare(proposal, name_index)
            if prepared is None:
                continue
            kind, target_skill_id, name, display_name = prepared
            content = cap_preserving_mentions(
                sanitize_skill_text(proposal.content), _CONTENT_CHAR_CAP
            )
            description = sanitize_skill_text(proposal.description)[:SKILL_DESCRIPTION_MAX]
            # An LLM echoing a prompt-injection delimiter from the analyzed
            # transcript must not seed a draft for the user to review.
            if has_hard_injection(content, description):
                logger.warning("skill analysis: dropped a proposal with injection markers")
                continue
            dedup_key = (kind, str(target_skill_id) if target_skill_id else "", name.lower())
            if dedup_key in existing:
                continue
            existing.add(dedup_key)
            draft = await skill_ops.propose_skill_draft(
                user_id=user_id,
                organization_id=organization_id,
                agent_id=agent_id,
                session_id=session_id,
                kind=kind,
                target_skill_id=target_skill_id,
                name=name,
                display_name=display_name,
                description=description,
                content=content,
                rationale=sanitize_skill_text(proposal.rationale),
            )
            if channel_id is not None:
                draft.channel_id = channel_id
                await self._session.commit()
            created.append(draft)
        return created

    def _prepare(
        self, proposal: SkillProposal, name_index: dict[str, UUID]
    ) -> tuple[AgentSkillDraftKind, UUID | None, str, str] | None:
        name = (proposal.name or "").strip()
        content = (proposal.content or "").strip()
        if not name or not content or len(name) > SKILL_NAME_MAX:
            return None
        display_name = ((proposal.display_name or "").strip() or name)[:SKILL_DISPLAY_NAME_MAX]
        action = AgentSkillDraftKind(proposal.action)

        target_id: UUID | None = None
        target_ref = (proposal.target_skill_name or "").strip().lower()
        if target_ref:
            target_id = name_index.get(target_ref)
        # Bias toward improving an injected skill: a "create" that collides with
        # an active skill name becomes an edit of that skill.
        if target_id is None and action is AgentSkillDraftKind.CREATE:
            target_id = name_index.get(name.lower())

        if target_id is not None:
            kind = (
                AgentSkillDraftKind.EVOLVE
                if action is AgentSkillDraftKind.EVOLVE
                else AgentSkillDraftKind.EDIT
            )
        else:
            kind = AgentSkillDraftKind.CREATE
        return kind, target_id, name, display_name

    async def _suppressed_draft_keys(self, *, organization_id: UUID) -> set[tuple[str, str, str]]:
        """Keys to skip: still-open pending drafts plus recently-discarded ones.

        Org-wide, matching the builder review inbox: a draft anyone already
        raised suppresses duplicates from other users' feedback.
        """
        cutoff = datetime.now(UTC) - timedelta(days=_RECENTLY_RESOLVED_DAYS)
        rows = (
            await self._session.execute(
                select(
                    AgentSkillDraft.kind,
                    AgentSkillDraft.target_skill_id,
                    AgentSkillDraft.name,
                ).where(
                    AgentSkillDraft.organization_id == organization_id,
                    AgentSkillDraft.is_deleted == False,  # noqa: E712
                    or_(
                        AgentSkillDraft.status == AgentSkillDraftStatus.PENDING,
                        and_(
                            AgentSkillDraft.status == AgentSkillDraftStatus.DISCARDED,
                            AgentSkillDraft.updated_at >= cutoff,
                        ),
                    ),
                )
            )
        ).all()
        return {(kind, str(tid) if tid else "", (name or "").lower()) for kind, tid, name in rows}

    async def _load_active_skills(self, session_id: UUID) -> list[ActiveSkill]:
        usage_rows = (
            await self._session.execute(
                select(
                    AgentSkillUsage.skill_id,
                    AgentSkillUsage.injected,
                    AgentSkillUsage.viewed,
                    AgentSkillUsage.invoked,
                ).where(AgentSkillUsage.session_id == session_id)
            )
        ).all()
        viewed_by_skill: dict[UUID, bool] = {}
        for skill_id, injected, viewed, invoked in usage_rows:
            if not injected:
                continue
            viewed_by_skill[skill_id] = viewed_by_skill.get(skill_id, False) or bool(
                viewed or invoked
            )
        if not viewed_by_skill:
            return []
        skills = (
            (
                await self._session.execute(
                    select(AgentSkill).where(AgentSkill.id.in_(viewed_by_skill.keys()))
                )
            )
            .scalars()
            .all()
        )
        return [
            ActiveSkill(
                skill_id=s.id,
                name=s.name,
                display_name=s.display_name,
                viewed=viewed_by_skill.get(s.id, False),
            )
            for s in skills
        ]

    def _build_transcript(self, messages: list[AgentMessage]) -> str:
        lines = [line for msg in messages if (line := _format_turn(msg))]
        return self._cap_transcript(lines)

    def _cap_transcript(self, lines: list[str]) -> str:
        transcript = "\n".join(lines)
        if len(transcript) > _TRANSCRIPT_CHAR_CAP:
            transcript = transcript[-_TRANSCRIPT_CHAR_CAP:]
        return transcript.strip()


_ANALYSIS_SYSTEM_PROMPT = (
    "You analyze a finished conversation between a user and an AI agent and decide "
    'whether a reusable "skill" (a markdown instruction snippet that shapes the '
    "agent's behavior) should be created or improved.\n\n"
    "Propose a skill ONLY when there is durable, reusable guidance worth capturing: "
    "the user taught a preference or procedure, corrected the agent, or the agent "
    "repeatedly stumbled in a way a skill would fix. Do NOT propose skills for "
    "one-off facts, trivia, or normal successful turns.\n\n"
    "Prefer EDITING an existing active skill over creating a new one when the guidance "
    'fits an active skill\'s topic. Use "evolve" when the change is driven by the agent '
    "getting something wrong (negative feedback, repeated tool errors).\n\n"
    """Return ONLY a JSON object, no prose. Each proposal has these keys:
- "action": "create" | "edit" | "evolve"
- "target_skill_name": name of an active skill (edit/evolve only)
- "name": machine name in snake_case
- "display_name": human-readable name
- "description": one line
- "content": the markdown instructions
- "rationale": why this is worth saving

Shape: {"proposals": [{"action": "...", "name": "...", ...}]}
Return {"proposals": []} when nothing is worth saving. Propose at most 3."""
)


def build_analysis_messages(signals: SessionSignals) -> tuple[str, str]:
    """Assemble the (system, user) prompt pair from gathered signals."""
    parts = ["Conversation transcript:", signals.transcript, ""]
    if signals.active_skills:
        listed = "\n".join(f"- {s.display_name} ({s.name})" for s in signals.active_skills)
        parts += ["Skills active during this conversation:", listed, ""]
    if signals.negative_feedback:
        parts.append(
            f"The user gave {signals.negative_feedback} thumbs-down on the agent's replies."
        )
    if signals.tool_errors:
        errs = ", ".join(f"{name} ({count}x)" for name, count in signals.tool_errors.items())
        parts.append(f"Tools that errored: {errs}.")
    not_viewed = signals.advertised_not_viewed
    if not_viewed:
        names = ", ".join(s.display_name for s in not_viewed)
        parts.append(f"These skills were advertised but never opened by the agent: {names}.")
    return _ANALYSIS_SYSTEM_PROMPT, "\n".join(parts).strip()


def parse_proposals(text: str) -> list[SkillProposal]:
    """Parse the LLM JSON output into proposals, tolerating code fences."""
    raw = (text or "").strip()
    if not raw:
        return []
    if raw.startswith("```"):
        raw = raw.split("```", 2)[1] if raw.count("```") >= 2 else raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:]
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end < start:
        return []
    try:
        data = loads(raw[start : end + 1])
    except ValueError, TypeError:
        logger.debug("skill analysis: could not parse LLM output as JSON")
        return []

    items = data.get("proposals") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []

    proposals: list[SkillProposal] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            action = AgentSkillDraftKind(
                str(item.get("action", AgentSkillDraftKind.CREATE)).strip().lower()
            )
        except ValueError:
            action = AgentSkillDraftKind.CREATE
        proposals.append(
            SkillProposal(
                action=action,
                name=str(item.get("name", "")).strip(),
                display_name=str(item.get("display_name", "")).strip(),
                content=str(item.get("content", "")).strip(),
                description=str(item.get("description", "")).strip(),
                target_skill_name=str(item.get("target_skill_name", "")).strip(),
                rationale=str(item.get("rationale", "")).strip(),
            )
        )
    return proposals
