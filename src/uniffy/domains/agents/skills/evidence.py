"""Authorized, bounded conversation evidence for a human-requested draft."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.message import AgentMessage, AgentMessageRole
from uniffy.core.models.agents.session import AgentSession
from uniffy.core.models.agents.skill import AgentSkill, SkillSurface
from uniffy.core.models.agents.skill_draft import AgentSkillDraft
from uniffy.core.models.agents.skill_invocation import AgentSkillInvocation, SkillInvocationStatus
from uniffy.core.models.agents.skill_version import AgentSkillVersion
from uniffy.core.models.chat.message import ChatMessage, ChatMessageMetadataKind, SenderType
from uniffy.domains.agents.agents.operations import AgentOperations
from uniffy.domains.chat.access import ChatAccessChecker

MAX_EVIDENCE_MESSAGES = 20
MAX_EVIDENCE_CHARACTERS = 24000


@dataclass(frozen=True)
class DraftEvidence:
    agent: Agent
    messages: tuple[dict[str, str], ...]
    version: AgentSkillVersion | None
    model_override: str | None = None


async def load_draft_evidence(session: AsyncSession, draft: AgentSkillDraft) -> DraftEvidence:
    if draft.proposed_by_agent_id is None:
        raise ValidationError("agent_id", "Choose an agent for this draft")
    agent = await AgentOperations(session).get_for_runtime(
        draft.owner_id, draft.organization_id, draft.proposed_by_agent_id
    )
    ids = [UUID(value) for value in draft.evidence_message_ids]
    if not ids or len(ids) > MAX_EVIDENCE_MESSAGES or len(set(ids)) != len(ids):
        raise ValidationError("evidence_message_ids", "Choose between 1 and 20 distinct messages")
    if (draft.session_id is None) == (draft.channel_id is None):
        raise ValidationError("destination", "Choose one conversation")
    model_override = None
    if draft.session_id is not None:
        if draft.thread_root_id is not None:
            raise ValidationError("thread_root_id", "Sessions do not have chat threads")
        destination = (
            await session.execute(
                select(AgentSession).where(
                    AgentSession.id == draft.session_id,
                    AgentSession.organization_id == draft.organization_id,
                    AgentSession.agent_id == agent.id,
                    AgentSession.user_id == draft.owner_id,
                )
            )
        ).scalar_one_or_none()
        if destination is None:
            raise PermissionDeniedError("generate", "Choose a conversation you own")
        model_override = destination.model_override
        rows = (
            await session.execute(
                select(
                    AgentMessage.id,
                    AgentMessage.role,
                    func.substr(AgentMessage.content, 1, MAX_EVIDENCE_CHARACTERS + 1).label(
                        "content"
                    ),
                )
                .where(
                    AgentMessage.session_id == destination.id,
                    AgentMessage.id.in_(ids),
                    AgentMessage.is_invalidated.is_(False),
                    AgentMessage.was_cancelled.is_(False),
                    AgentMessage.role.in_((AgentMessageRole.USER, AgentMessageRole.ASSISTANT)),
                )
                .order_by(AgentMessage.created_at, AgentMessage.id)
            )
        ).all()
        messages = tuple(
            {"id": str(row.id), "role": row.role, "content": row.content or ""} for row in rows
        )
    else:
        checker = ChatAccessChecker(session)
        channel = await checker.get_channel(draft.channel_id, draft.organization_id)
        await checker.check_access(draft.owner_id, draft.organization_id, channel)
        # Generation publishes a card into this conversation under the requester's authority.
        await checker.require_send(draft.owner_id, channel)
        branch = ChatMessage.root_id.is_(None)
        if draft.thread_root_id is not None:
            root = (
                await session.execute(
                    select(ChatMessage.id).where(
                        ChatMessage.id == draft.thread_root_id,
                        ChatMessage.channel_id == channel.id,
                        ChatMessage.root_id.is_(None),
                        ChatMessage.is_deleted.is_(False),
                    )
                )
            ).scalar_one_or_none()
            if root is None:
                raise NotFoundError("Thread", str(draft.thread_root_id))
            branch = or_(ChatMessage.id == root, ChatMessage.root_id == root)
        rows = (
            await session.execute(
                select(
                    ChatMessage.id,
                    ChatMessage.sender_type,
                    ChatMessage.sender_id,
                    ChatMessage.message_metadata,
                    func.substr(ChatMessage.content, 1, MAX_EVIDENCE_CHARACTERS + 1).label(
                        "content"
                    ),
                )
                .where(
                    ChatMessage.channel_id == channel.id,
                    ChatMessage.id.in_(ids),
                    ChatMessage.is_deleted.is_(False),
                    branch,
                    ChatMessage.sender_type.in_((SenderType.USER, SenderType.AGENT)),
                )
                .order_by(ChatMessage.created_at, ChatMessage.id)
            )
        ).all()
        messages = tuple(
            {
                "id": str(row.id),
                "role": AgentMessageRole.USER
                if row.sender_type == SenderType.USER
                else AgentMessageRole.ASSISTANT,
                "content": row.content or "",
            }
            for row in rows
            if row.sender_type == SenderType.USER
            or (
                row.sender_id == agent.id
                and (row.message_metadata or {}).get("kind") == ChatMessageMetadataKind.FINAL
                and str((row.message_metadata or {}).get("streaming")).lower() != "true"  # noqa: PLR2004 - wire flag
            )
        )
    if {m["id"] for m in messages} != set(draft.evidence_message_ids):
        raise ValidationError(
            "evidence_message_ids", "Some selected messages are unavailable in this conversation"
        )
    if sum(len(m["content"]) for m in messages) > MAX_EVIDENCE_CHARACTERS:
        raise ValidationError("evidence_message_ids", "Select fewer or shorter messages")
    version = await _load_invoked_version(session, draft, messages)
    return DraftEvidence(agent, messages, version, model_override)


async def _load_invoked_version(
    session: AsyncSession, draft: AgentSkillDraft, messages: tuple[dict[str, str], ...]
) -> AgentSkillVersion | None:
    if draft.invocation_id is None:
        return None
    invocation = (
        await session.execute(
            select(AgentSkillInvocation).where(
                AgentSkillInvocation.id == draft.invocation_id,
                AgentSkillInvocation.organization_id == draft.organization_id,
                AgentSkillInvocation.user_id == draft.owner_id,
                AgentSkillInvocation.agent_id == draft.proposed_by_agent_id,
                AgentSkillInvocation.session_id == draft.session_id,
                AgentSkillInvocation.channel_id == draft.channel_id,
                AgentSkillInvocation.surface
                == (SkillSurface.SESSION if draft.session_id else SkillSurface.CHAT),
                AgentSkillInvocation.status == SkillInvocationStatus.COMPLETED,
            )
        )
    ).scalar_one_or_none()
    ids = {m["id"] for m in messages}
    if invocation is None or str(invocation.response_message_id) not in ids:
        raise ValidationError("invocation_id", "Choose a response from your skill invocation")
    if invocation.trigger_message_id and str(invocation.trigger_message_id) not in ids:
        raise ValidationError("evidence_message_ids", "Include the request that invoked this skill")
    version = (
        await session.execute(
            select(AgentSkillVersion)
            .join(
                AgentSkill,
                AgentSkill.id == AgentSkillVersion.skill_id,
            )
            .where(
                AgentSkillVersion.id == invocation.skill_version_id,
                AgentSkillVersion.skill_id == invocation.skill_id,
                AgentSkillVersion.version_number == invocation.skill_version_number,
                or_(
                    AgentSkill.organization_id == draft.organization_id,
                    AgentSkill.organization_id.is_(None),
                ),
            )
        )
    ).scalar_one_or_none()
    if version is None:
        raise NotFoundError("SkillVersion", str(invocation.skill_version_id))
    return version
