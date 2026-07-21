"""Per-(channel, agent) context window operations for chat surfaces."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.channel_binding import AgentChannelBinding
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.types import SubjectType
from uniffy.domains.agents.cache import fetch_agent_row
from uniffy.domains.agents.providers.operations import ProviderOperations
from uniffy.domains.agents.runtime.compactor import summarise_conversation
from uniffy.domains.agents.runtime.model_resolver import resolve_model
from uniffy.domains.agents.runtime.operations import _get_model_context_window
from uniffy.domains.agents.sessions.operations import (
    DEFAULT_CONTEXT_TOKEN_BUDGET_RATIO,
    FALLBACK_CONTEXT_WINDOW,
)

MAX_AGENT_IDS_PER_BATCH = 100

CHAT_COMPACTION_MIN_KEEP = 5
CHAT_COMPACTION_MAX_LOAD = 200


def _format_chat_entry(
    msg: ChatMessage,
    senders: dict[UUID, str],
    self_agent_id: UUID,
) -> tuple[str, str]:
    """Render one chat message as a `(label, content)` tuple for the summariser."""
    meta = msg.message_metadata or {}
    kind = meta.get("kind")
    content = msg.content or ""
    if kind == "tool_call":
        tool_name = meta.get("tool_name", "tool")
        return ("ASSISTANT", f"[Tool call: {tool_name}] {content}")
    if kind == "tool_result":
        tool_name = meta.get("tool_name", "tool")
        return ("TOOL", f"[Tool result: {tool_name}] {content}")
    if kind == "summary":
        return ("SUMMARY", content)

    if msg.sender_type == SenderType.AGENT and msg.sender_id == self_agent_id:
        return ("ASSISTANT", content)

    name = senders.get(msg.sender_id, "Unknown") if msg.sender_id else "Unknown"
    return (f"[{name}]", content)


from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.streaming.events import (
    MESSAGE_CREATED,
    build_message_payload,
)
from uniffy.domains.chat.streaming.publisher import publish_channel_event_to_members

logger = logger.bind(component="agents.chat_integration.context")


@dataclass(frozen=True)
class ContextStats:
    total_messages: int
    active_messages: int
    compacted_messages: int
    summary_count: int
    active_tokens: int
    last_input_tokens: int
    last_output_tokens: int
    last_cache_read_tokens: int
    token_budget: int
    tokens_until_compaction: int
    context_window_tokens: int
    was_reset: bool
    manual_reset_at: datetime | None


@dataclass(frozen=True)
class ResetResult:
    divider_message_id: UUID
    reset_at: datetime
    stats: ContextStats


@dataclass(frozen=True)
class CompactResult:
    compacted: bool
    messages_compacted: int
    tokens_before: int
    tokens_after: int
    tokens_saved: int
    summary_message_id: UUID | None
    stats: ContextStats


class ChatAgentContextOperations:
    """Stats, reset, and compact for one (channel, agent) pair."""

    def __init__(
        self,
        session: AsyncSession,
        access: ChatAccessChecker | None = None,
    ) -> None:
        self._session = session
        self._access = access or ChatAccessChecker(session)

    async def get_stats(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        agent_id: UUID,
    ) -> ContextStats:
        """Read binding + count chat messages; auto-creates the binding row if missing."""
        channel = await self._access.get_channel(channel_id, organization_id)
        await self._require_read(user_id, organization_id, channel)

        agent = await fetch_agent_row(self._session, agent_id, organization_id)
        if agent is None:
            raise NotFoundError("agent", str(agent_id))

        binding = await self._ensure_binding(channel_id, agent_id, channel.owner_id)
        context_window = await self._resolve_context_window(organization_id, agent)
        return await self._build_stats(channel_id, agent_id, binding, context_window)

    async def get_stats_for_agents(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        agent_ids: list[UUID],
    ) -> dict[UUID, ContextStats]:
        """Batched stats for N (channel, agent) pairs; missing bindings are skipped."""
        if len(agent_ids) > MAX_AGENT_IDS_PER_BATCH:
            raise ValidationError(
                "agent_ids",
                f"Maximum {MAX_AGENT_IDS_PER_BATCH} agent_ids per call",
            )
        if not agent_ids:
            return {}

        channel = await self._access.get_channel(channel_id, organization_id)
        await self._require_read(user_id, organization_id, channel)

        unique_ids = list(dict.fromkeys(agent_ids))
        bindings = await self._fetch_bindings(channel_id, unique_ids)

        result: dict[UUID, ContextStats] = {}
        for agent_id in unique_ids:
            binding = bindings.get(agent_id)
            if binding is None:
                continue
            try:
                agent = await fetch_agent_row(self._session, agent_id, organization_id)
                if agent is None:
                    continue
                context_window = await self._resolve_context_window(organization_id, agent)
                stats = await self._build_stats(
                    channel_id, agent_id, binding, context_window
                )
            except (PermissionDeniedError, NotFoundError):
                continue
            except Exception:
                logger.warning(
                    f"Skipping agent {agent_id} in batch context stats for "
                    f"channel {channel_id}",
                    component="agents.chat_integration.context",
                )
                continue
            result[agent_id] = stats
        return result

    async def get_config(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        agent_id: UUID,
    ) -> AgentChannelBinding:
        channel, _agent, binding = await self._load_triple(
            organization_id, channel_id, agent_id
        )
        await self._require_read(user_id, organization_id, channel)
        return binding

    async def update_config(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        agent_id: UUID,
        model_override: str | None = None,
        model_params_override: dict | None = None,
    ) -> AgentChannelBinding:
        """`None` arguments leave the field unchanged; empty values clear it."""
        channel, _agent, binding = await self._load_triple(
            organization_id, channel_id, agent_id
        )
        await self._require_mutate(user_id, organization_id, channel)

        if model_override is not None:
            binding.model_override = model_override.strip() or None

        if model_params_override is not None:
            binding.model_params_override = model_params_override or None

        await self._session.commit()
        await self._session.refresh(binding)
        return binding

    async def _fetch_bindings(
        self,
        channel_id: UUID,
        agent_ids: list[UUID],
    ) -> dict[UUID, AgentChannelBinding]:
        result = await self._session.execute(
            select(AgentChannelBinding).where(
                AgentChannelBinding.channel_id == channel_id,
                AgentChannelBinding.agent_id.in_(agent_ids),
            )
        )
        return {b.agent_id: b for b in result.scalars().all()}

    async def reset(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        agent_id: UUID,
    ) -> ResetResult:
        """Drop the agent's view of pre-now history; inserts a divider message."""
        channel, agent, binding = await self._load_triple(
            organization_id, channel_id, agent_id
        )
        await self._require_mutate(user_id, organization_id, channel)

        now = datetime.now(UTC)
        reset_by_name = await self._resolve_user_display_name(user_id)
        meta = {
            "kind": "context_reset",
            "agent_id": str(agent_id),
            "reset_by_user_id": str(user_id),
            "reset_by_name": reset_by_name,
        }
        divider = ChatMessage(
            channel_id=channel_id,
            sender_id=agent_id,
            sender_type=SenderType.AGENT,
            content="",
            message_metadata=meta,
        )
        self._session.add(divider)
        await self._session.flush()

        binding.manual_reset_at = now
        binding.last_active_token_estimate = 0
        binding.last_output_token_estimate = 0
        binding.last_cache_read_token_estimate = 0
        await self._session.commit()
        await self._session.refresh(divider)
        await self._session.refresh(binding)

        await self._publish_divider(channel_id, agent.name, divider, now)

        context_window = await self._resolve_context_window(organization_id, agent)
        stats = await self._build_stats(channel_id, agent_id, binding, context_window)
        return ResetResult(
            divider_message_id=divider.id,
            reset_at=now,
            stats=stats,
        )

    async def _publish_divider(
        self,
        channel_id: UUID,
        agent_name: str,
        divider: ChatMessage,
        now: datetime,
    ) -> None:
        await self._publish_chat_event(channel_id, agent_name, divider, now)

    async def _publish_chat_event(
        self,
        channel_id: UUID,
        agent_name: str,
        message: ChatMessage,
        now: datetime,
    ) -> None:
        # USER-only fan-out: AGENT members have no Valkey subscription.
        # Publish failures are swallowed; DB state is authoritative.
        try:
            user_ids_result = await self._session.execute(
                select(ChatChannelMember.subject_id).where(
                    ChatChannelMember.channel_id == channel_id,
                    ChatChannelMember.subject_type == SubjectType.USER,
                )
            )
            user_ids = [row[0] for row in user_ids_result.all()]
            if not user_ids:
                return
            await publish_channel_event_to_members(
                user_ids,
                MESSAGE_CREATED,
                build_message_payload(
                    message_id=message.id,
                    channel_id=channel_id,
                    sender_id=message.sender_id,
                    sender_type=message.sender_type.value,
                    content=message.content or "",
                    root_id=None,
                    created_at=now,
                    sender_name=agent_name,
                    metadata=message.message_metadata or {},
                ),
            )
        except Exception:
            logger.warning(
                f"Reset divider publish failed for channel {channel_id}",
                component="agents.chat_integration.context",
            )

    async def compact(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        agent_id: UUID,
    ) -> CompactResult:
        """Force compaction for one (channel, agent) pair."""
        channel, agent, binding = await self._load_triple(
            organization_id, channel_id, agent_id
        )
        await self._require_mutate(user_id, organization_id, channel)

        provider, model_id = await self._resolve_provider_and_model(
            organization_id, agent, binding
        )
        context_window = await self._resolve_window_for_provider(provider, model_id)

        active_rows = await self._load_active_messages(channel_id, binding)
        no_op_stats = await self._build_stats(channel_id, agent_id, binding, context_window)
        if len(active_rows) <= CHAT_COMPACTION_MIN_KEEP:
            return CompactResult(
                compacted=False,
                messages_compacted=0,
                tokens_before=no_op_stats.active_tokens,
                tokens_after=no_op_stats.active_tokens,
                tokens_saved=0,
                summary_message_id=None,
                stats=no_op_stats,
            )

        to_compact = active_rows[:-CHAT_COMPACTION_MIN_KEEP]
        if not to_compact:
            return CompactResult(
                compacted=False,
                messages_compacted=0,
                tokens_before=no_op_stats.active_tokens,
                tokens_after=no_op_stats.active_tokens,
                tokens_saved=0,
                summary_message_id=None,
                stats=no_op_stats,
            )

        senders_meta = await self._resolve_sender_names(to_compact)
        entries = [_format_chat_entry(m, senders_meta, agent_id) for m in to_compact]
        # Provider-reported prompt size at the last agent turn; overwritten next turn.
        tokens_before = int(binding.last_active_token_estimate or 0)

        summary = await summarise_conversation(
            provider=provider,
            model=model_id,
            entries=entries,
        )
        if summary is None:
            return CompactResult(
                compacted=False,
                messages_compacted=0,
                tokens_before=tokens_before,
                tokens_after=tokens_before,
                tokens_saved=0,
                summary_message_id=None,
                stats=no_op_stats,
            )

        now = datetime.now(UTC)
        summary_meta = {
            "kind": "summary",
            "agent_id": str(agent_id),
            "model": model_id,
            "compacted_msg_ids": [str(m.id) for m in to_compact],
            "input_tokens": summary.input_tokens,
            "output_tokens": summary.output_tokens,
        }
        summary_msg = ChatMessage(
            channel_id=channel_id,
            sender_id=agent_id,
            sender_type=SenderType.AGENT,
            content=summary.content,
            message_metadata=summary_meta,
        )
        self._session.add(summary_msg)
        await self._session.flush()

        new_compacted = list(binding.compaction_summary_msg_ids or [])
        new_compacted.extend(m.id for m in to_compact)
        binding.compaction_summary_msg_ids = new_compacted
        binding.last_compacted_at = now
        # Reset the cached prompt size; next live turn repopulates from provider counts.
        binding.last_active_token_estimate = 0
        binding.last_output_token_estimate = 0
        binding.last_cache_read_token_estimate = 0
        await self._session.commit()
        await self._session.refresh(summary_msg)
        await self._session.refresh(binding)

        await self._publish_summary(channel_id, agent.name, summary_msg, now)

        stats = await self._build_stats(channel_id, agent_id, binding, context_window)
        return CompactResult(
            compacted=True,
            messages_compacted=len(to_compact),
            tokens_before=tokens_before,
            tokens_after=0,
            tokens_saved=tokens_before,
            summary_message_id=summary_msg.id,
            stats=stats,
        )

    async def _load_active_messages(
        self,
        channel_id: UUID,
        binding: AgentChannelBinding,
    ) -> list[ChatMessage]:
        already_compacted = set(binding.compaction_summary_msg_ids or [])
        conditions = [
            ChatMessage.channel_id == channel_id,
            ChatMessage.is_deleted == False,  # noqa: E712
        ]
        if binding.manual_reset_at is not None:
            conditions.append(ChatMessage.created_at > binding.manual_reset_at)

        result = await self._session.execute(
            select(ChatMessage)
            .where(*conditions)
            .order_by(ChatMessage.created_at)
            .limit(CHAT_COMPACTION_MAX_LOAD)
        )
        rows = list(result.scalars().all())
        return [
            m
            for m in rows
            if m.id not in already_compacted
            and (m.message_metadata or {}).get("visibility") != "agent_internal"
            and (m.message_metadata or {}).get("streaming") is not True
            and (m.message_metadata or {}).get("kind") != "context_reset"
        ]

    async def _resolve_sender_names(
        self,
        rows: list[ChatMessage],
    ) -> dict[UUID, str]:
        from uniffy.domains.chat.sender_resolver import SenderResolver

        resolver = SenderResolver(self._session)
        refs = [(m.sender_type, m.sender_id) for m in rows if m.sender_id]
        if not refs:
            return {}
        resolved = await resolver.resolve_many(refs)
        return {sid: info.display_name for sid, info in resolved.items()}

    async def _resolve_user_display_name(self, user_id: UUID) -> str:
        """Best-effort display name; falls back to a placeholder."""
        from uniffy.core.models.login.user import User

        result = await self._session.execute(
            select(User.full_name, User.username, User.email).where(User.id == user_id)
        )
        row = result.one_or_none()
        if row is None:
            return "Unknown"
        full_name, username, email = row
        return full_name or username or email or "Unknown"

    async def _resolve_provider_and_model(
        self,
        organization_id: UUID,
        agent: Agent,
        binding: AgentChannelBinding,
    ) -> tuple[object, str]:
        provider_ops = ProviderOperations(self._session)
        if agent.primary_provider_key_id:
            provider, _pk = await provider_ops.get_provider_for_key(
                organization_id=organization_id,
                key_id=agent.primary_provider_key_id,
            )
        else:
            # The override may live on a different provider than the agent's
            # primary model; resolve from the effective model.
            provider = await provider_ops.get_provider_for_model(
                organization_id=organization_id,
                model_id=binding.model_override or agent.primary_model,
            )
        model_id = await resolve_model(
            session_model_override=binding.model_override,
            agent_primary_model=agent.primary_model,
            agent_fallback_models=list(agent.fallback_models or []),
            provider=provider,
        )
        return provider, model_id

    async def _resolve_window_for_provider(self, provider: object, model_id: str) -> int:
        try:
            return await _get_model_context_window(provider, model_id)
        except Exception:
            return FALLBACK_CONTEXT_WINDOW

    async def _publish_summary(
        self,
        channel_id: UUID,
        agent_name: str,
        summary_msg: ChatMessage,
        now: datetime,
    ) -> None:
        await self._publish_chat_event(channel_id, agent_name, summary_msg, now)

    async def _load_triple(
        self,
        organization_id: UUID,
        channel_id: UUID,
        agent_id: UUID,
    ) -> tuple[ChatChannel, Agent, AgentChannelBinding]:
        channel = await self._access.get_channel(channel_id, organization_id)

        agent = (
            await self._session.execute(
                select(Agent).where(
                    Agent.id == agent_id,
                    Agent.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if agent is None:
            raise NotFoundError("agent", str(agent_id))

        binding = await self._ensure_binding(channel_id, agent_id, channel.owner_id)
        return channel, agent, binding

    async def _ensure_binding(
        self,
        channel_id: UUID,
        agent_id: UUID,
        owner_user_id: UUID,
    ) -> AgentChannelBinding:
        """Idempotent fetch-or-insert."""
        existing = (
            await self._session.execute(
                select(AgentChannelBinding).where(
                    AgentChannelBinding.channel_id == channel_id,
                    AgentChannelBinding.agent_id == agent_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing

        stmt = pg_insert(AgentChannelBinding).values(
            channel_id=channel_id,
            agent_id=agent_id,
            created_by_user_id=owner_user_id,
        )
        stmt = stmt.on_conflict_do_nothing(constraint="agents_channel_bindings_unique")
        await self._session.execute(stmt)
        await self._session.commit()

        return (
            await self._session.execute(
                select(AgentChannelBinding).where(
                    AgentChannelBinding.channel_id == channel_id,
                    AgentChannelBinding.agent_id == agent_id,
                )
            )
        ).scalar_one()

    async def _require_read(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel: ChatChannel,
    ) -> None:
        await self._access.check_access(user_id, organization_id, channel)

    async def _require_mutate(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel: ChatChannel,
    ) -> None:
        # DM members may mutate freely; group channels require elevated role.
        if channel.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
            member = await self._access.get_membership(channel.id, user_id)
            if member is None:
                raise PermissionDeniedError("mutate", "channel context")
            return

        if not await self._access.require_elevated(user_id, organization_id, channel.id):
            raise PermissionDeniedError("mutate", "channel context")

    async def _resolve_context_window(
        self,
        organization_id: UUID,
        agent: Agent,
    ) -> int:
        """Resolve the model's context window; falls back when no provider is bound."""
        if not agent.primary_provider_key_id and not agent.primary_model:
            return FALLBACK_CONTEXT_WINDOW

        provider_ops = ProviderOperations(self._session)
        try:
            if agent.primary_provider_key_id:
                provider, _pk = await provider_ops.get_provider_for_key(
                    organization_id=organization_id,
                    key_id=agent.primary_provider_key_id,
                )
            else:
                provider = await provider_ops.get_provider_for_model(
                    organization_id=organization_id,
                    model_id=agent.primary_model,
                )
            return await _get_model_context_window(provider, agent.primary_model)
        except Exception:
            return FALLBACK_CONTEXT_WINDOW

    async def _build_stats(
        self,
        channel_id: UUID,
        agent_id: UUID,
        binding: AgentChannelBinding,
        context_window_tokens: int,
    ) -> ContextStats:
        manual_reset_at = binding.manual_reset_at

        total_q = (
            select(func.count(ChatMessage.id))
            .where(
                ChatMessage.channel_id == channel_id,
                ChatMessage.is_deleted == False,  # noqa: E712
            )
        )
        if manual_reset_at is not None:
            total_q = total_q.where(ChatMessage.created_at > manual_reset_at)
        total_messages = (await self._session.execute(total_q)).scalar_one()

        summary_q = (
            select(func.count(ChatMessage.id))
            .where(
                ChatMessage.channel_id == channel_id,
                ChatMessage.sender_type == SenderType.AGENT,
                ChatMessage.sender_id == agent_id,
                ChatMessage.is_deleted == False,  # noqa: E712
                ChatMessage.message_metadata["kind"].astext == "summary",
            )
        )
        if manual_reset_at is not None:
            summary_q = summary_q.where(ChatMessage.created_at > manual_reset_at)
        summary_count = (await self._session.execute(summary_q)).scalar_one()

        compacted_messages = len(binding.compaction_summary_msg_ids or [])
        active_messages = max(total_messages - compacted_messages, 0)

        last_input_tokens = max(int(binding.last_active_token_estimate or 0), 0)
        last_output_tokens = max(int(binding.last_output_token_estimate or 0), 0)
        last_cache_read_tokens = max(int(binding.last_cache_read_token_estimate or 0), 0)
        active_tokens = last_input_tokens + last_output_tokens
        token_budget = int(context_window_tokens * DEFAULT_CONTEXT_TOKEN_BUDGET_RATIO)
        tokens_until_compaction = max(token_budget - active_tokens, 0)

        return ContextStats(
            total_messages=int(total_messages),
            active_messages=int(active_messages),
            compacted_messages=int(compacted_messages),
            summary_count=int(summary_count),
            active_tokens=active_tokens,
            last_input_tokens=last_input_tokens,
            last_output_tokens=last_output_tokens,
            last_cache_read_tokens=last_cache_read_tokens,
            token_budget=token_budget,
            tokens_until_compaction=tokens_until_compaction,
            context_window_tokens=int(context_window_tokens),
            was_reset=manual_reset_at is not None,
            manual_reset_at=manual_reset_at,
        )
