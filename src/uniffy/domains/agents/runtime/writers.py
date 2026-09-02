"""Pluggable message writers for the streaming runtime."""

from __future__ import annotations

import contextlib
from typing import TYPE_CHECKING, Protocol
from uuid import UUID, uuid4

from sqlalchemy import or_, select, update

from uniffy.core.content.references import (
    extract_all_outgoing_references,
    strip_broadcast_urns,
)
from uniffy.core.models.agents.channel_binding import AgentChannelBinding
from uniffy.core.models.agents.message import AgentMessage, AgentMessageRole
from uniffy.core.models.chat.message import (
    ChatMessage,
    ChatMessageMetadataKind,
    ChatMessageVisibility,
    SenderType,
)
from uniffy.domains.chat.agents import (
    AGENT_THREAD_REPLY_KINDS,
    SenderResolver,
    bump_channel_message_stats,
    record_thread_reply,
)

if TYPE_CHECKING:
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

    from uniffy.domains.agents.sessions.operations import SessionOperations


_FALLBACK_SENDER_NAME = "Unknown"

CHANNEL_CONTEXT_LIMIT = 50
THREAD_REPLY_CONTEXT_LIMIT = 40
# Enough channel lead-in for the thread's topic to make sense without pulling
# the whole room into a branch.
THREAD_AMBIENT_CHANNEL_LIMIT = 10


def _metadata_kind_for(role: str, tool_call_id: str | None) -> ChatMessageMetadataKind:
    """Map runtime role + tool_call_id to a chat `metadata.kind`."""
    if role == AgentMessageRole.SUMMARY:
        return ChatMessageMetadataKind.SUMMARY
    if role == AgentMessageRole.TOOL:
        return ChatMessageMetadataKind.TOOL_RESULT
    if role == AgentMessageRole.ASSISTANT and tool_call_id:
        return ChatMessageMetadataKind.TOOL_CALL
    return ChatMessageMetadataKind.FINAL


class MessageWriter(Protocol):
    """Persistence and context contract for the streaming runtime."""

    @property
    def approval_scope_id(self) -> UUID:
        """Identifier under which destructive-tool approvals are keyed."""

    @property
    def approval_actor_user_id(self) -> UUID | None: ...

    @property
    def approval_agent_id(self) -> UUID | None: ...

    @property
    def approval_channel_id(self) -> UUID | None: ...

    async def add_message(
        self,
        *,
        role: str,
        content: str | None = None,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_creation_input_tokens: int = 0,
        cache_read_input_tokens: int = 0,
        model: str | None = None,
        tool_name: str | None = None,
        tool_call_id: str | None = None,
        tool_args: dict | None = None,
        tool_result: str | None = None,
        tool_metadata: dict | None = None,
        is_thinking: bool = False,
        file_ids: list[str] | None = None,
        invoked_skill_name: str | None = None,
        thinking: list[dict] | None = None,
    ) -> AgentMessage:
        """Persist a message and return an `AgentMessage`-shaped envelope.

        `tool_metadata` is machine-readable result detail for the client and
        only reaches chat rows; `agents_messages` carries no metadata column,
        so the session writer accepts and drops it.
        """

    async def reserve_assistant_placeholder(self) -> AgentMessage | None:
        """Insert an empty in-flight assistant row that streamed deltas patch.

        Returns `None` when the writer does not support per-token streaming;
        callers fall back to the buffer-then-write path.
        """

    async def finalize_assistant_placeholder(
        self,
        *,
        message_id: UUID,
        content: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_creation_input_tokens: int = 0,
        cache_read_input_tokens: int = 0,
        model: str | None = None,
        thinking: list[dict] | None = None,
    ) -> AgentMessage:
        """Persist final content + token usage onto a reserved placeholder."""

    async def load_context_messages(
        self,
        *,
        token_budget: int,
    ) -> tuple[list[AgentMessage], int]:
        """Return ordered conversation history for prompt assembly."""

    async def compact_if_needed(
        self,
        *,
        token_budget: int,
    ) -> None:
        """Schedule async compaction; never block on an LLM call here."""


class SessionMessageWriter:
    """Session writer that persists into `agents_messages`."""

    def __init__(
        self,
        *,
        session_ops: SessionOperations,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
    ) -> None:
        self._session_ops = session_ops
        self._user_id = user_id
        self._organization_id = organization_id
        self._session_id = session_id

    @property
    def approval_scope_id(self) -> UUID:
        return self._session_id

    @property
    def approval_actor_user_id(self) -> UUID | None:
        # The RespondToConfirmation handler rejects responses whose
        # caller does not match this id. Returning None would make every
        # Allow click fail with PERMISSION_DENIED.
        return self._user_id

    @property
    def approval_agent_id(self) -> UUID | None:
        return None

    @property
    def approval_channel_id(self) -> UUID | None:
        return None

    @property
    def session_id(self) -> UUID:
        return self._session_id

    async def add_message(
        self,
        *,
        role: str,
        content: str | None = None,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_creation_input_tokens: int = 0,
        cache_read_input_tokens: int = 0,
        model: str | None = None,
        tool_name: str | None = None,
        tool_call_id: str | None = None,
        tool_args: dict | None = None,
        tool_result: str | None = None,
        tool_metadata: dict | None = None,
        is_thinking: bool = False,
        file_ids: list[str] | None = None,
        invoked_skill_name: str | None = None,
        thinking: list[dict] | None = None,
    ) -> AgentMessage:
        return await self._session_ops.add_message(
            user_id=self._user_id,
            organization_id=self._organization_id,
            session_id=self._session_id,
            role=role,
            content=content,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_creation_input_tokens=cache_creation_input_tokens,
            cache_read_input_tokens=cache_read_input_tokens,
            model=model,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            tool_args=tool_args,
            tool_result=tool_result,
            is_thinking=is_thinking,
            file_ids=file_ids,
            invoked_skill_name=invoked_skill_name,
            thinking=thinking,
        )

    async def reserve_assistant_placeholder(self) -> AgentMessage | None:
        return None

    async def finalize_assistant_placeholder(
        self,
        *,
        message_id: UUID,
        content: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_creation_input_tokens: int = 0,
        cache_read_input_tokens: int = 0,
        model: str | None = None,
        thinking: list[dict] | None = None,
    ) -> AgentMessage:
        raise NotImplementedError(
            "SessionMessageWriter does not support placeholder reservation",
        )

    async def load_context_messages(
        self,
        *,
        token_budget: int,
    ) -> tuple[list[AgentMessage], int]:
        return await self._session_ops.get_session_context(
            user_id=self._user_id,
            organization_id=self._organization_id,
            session_id=self._session_id,
            token_budget=token_budget,
        )

    async def compact_if_needed(
        self,
        *,
        token_budget: int,
    ) -> None:
        await self._session_ops.enqueue_compaction_if_needed(
            session_id=self._session_id,
            token_budget=token_budget,
        )


class ChatChannelMessageWriter:
    """Persist runtime steps into `chat_messages` as `sender_type=AGENT`.

    Approval scope is the channel id so destructive-tool approvals in
    different DMs never collide.
    """

    def __init__(
        self,
        *,
        session: AsyncSession,
        user_id: UUID,
        organization_id: UUID,
        channel_id: UUID,
        agent_id: UUID,
        trigger_message_id: UUID,
        thread_root_id: UUID | None = None,
    ) -> None:
        self._session = session
        self._user_id = user_id
        self._organization_id = organization_id
        self._channel_id = channel_id
        self._agent_id = agent_id
        self._trigger_message_id = trigger_message_id
        # Inherited by every agent-authored row so tool cards, results, and
        # the final reply all land inside the trigger's thread.
        self._thread_root_id = thread_root_id

    @property
    def approval_scope_id(self) -> UUID:
        return self._channel_id

    @property
    def approval_actor_user_id(self) -> UUID | None:
        return self._user_id

    @property
    def approval_agent_id(self) -> UUID | None:
        return self._agent_id

    @property
    def approval_channel_id(self) -> UUID | None:
        return self._channel_id

    async def _record_active_tokens(
        self,
        input_tokens: int,
        output_tokens: int = 0,
        cache_creation_input_tokens: int = 0,
        cache_read_input_tokens: int = 0,
    ) -> None:
        """Cache provider-reported prompt + completion sizes on the binding.

        Gated by `last_active_token_estimate < :new_value OR IS NULL` so
        concurrent agents in the same channel race deterministically -- the
        larger input wins. Output and cache fields are written in the same
        row to stay paired with the latest turn. `last_active_token_estimate`
        stores the FULL prompt size (uncached + cache hits) since both
        contribute to context window pressure; cache hits are stored
        separately so the meter can surface the savings.
        """
        if input_tokens <= 0 and cache_creation_input_tokens <= 0 and cache_read_input_tokens <= 0:
            return
        new_cache_creation = max(0, int(cache_creation_input_tokens))
        new_cache_read = max(0, int(cache_read_input_tokens))
        new_input = max(0, int(input_tokens)) + new_cache_creation + new_cache_read
        new_output = max(0, int(output_tokens))
        with contextlib.suppress(Exception):
            await self._session.execute(
                update(AgentChannelBinding)
                .where(
                    AgentChannelBinding.channel_id == self._channel_id,
                    AgentChannelBinding.agent_id == self._agent_id,
                    or_(
                        AgentChannelBinding.last_active_token_estimate < new_input,
                        AgentChannelBinding.last_active_token_estimate.is_(None),
                    ),
                )
                .values(
                    last_active_token_estimate=new_input,
                    last_output_token_estimate=new_output,
                    last_cache_read_token_estimate=new_cache_read,
                )
            )

    async def _record_thread_reply(self, *, at: datetime) -> None:
        """Move the thread counter + participants for an in-thread agent row."""
        if self._thread_root_id is None:
            return
        await record_thread_reply(
            self._session,
            root_message_id=self._thread_root_id,
            channel_id=self._channel_id,
            sender_type=SenderType.AGENT,
            sender_id=self._agent_id,
            at=at,
        )

    async def add_message(
        self,
        *,
        role: str,
        content: str | None = None,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_creation_input_tokens: int = 0,
        cache_read_input_tokens: int = 0,
        model: str | None = None,
        tool_name: str | None = None,
        tool_call_id: str | None = None,
        tool_args: dict | None = None,
        tool_result: str | None = None,
        tool_metadata: dict | None = None,
        is_thinking: bool = False,
        file_ids: list[str] | None = None,
        invoked_skill_name: str | None = None,
        thinking: list[dict] | None = None,
    ) -> AgentMessage:
        """Persist a runtime-step message into `chat_messages`.

        `role="user"` is a no-op (the trigger user message is already in the
        channel); returns an envelope to keep the MESSAGE_STORED event
        uniform. Other roles persist a `sender_type=AGENT` row whose
        `metadata.kind` drives the renderer card choice.
        """
        if role == AgentMessageRole.USER:
            return AgentMessage(
                id=self._trigger_message_id,
                session_id=self._channel_id,
                role="user",
                content=content,
                file_ids=file_ids,
                invoked_skill_name=invoked_skill_name,
            )

        kind = _metadata_kind_for(role, tool_call_id)
        meta: dict = {
            "kind": kind,
            "agent_id": str(self._agent_id),
            "trigger_message_id": str(self._trigger_message_id),
        }
        if tool_name:
            meta["tool_name"] = tool_name
        if tool_call_id:
            meta["tool_call_id"] = tool_call_id
        if tool_args is not None:
            meta["tool_args"] = tool_args
        if tool_result is not None:
            meta["tool_result"] = tool_result
        if tool_metadata:
            meta["tool_meta"] = tool_metadata
        if model:
            meta["model"] = model
        if input_tokens:
            meta["input_tokens"] = input_tokens
        if output_tokens:
            meta["output_tokens"] = output_tokens
        if cache_creation_input_tokens:
            meta["cache_creation_input_tokens"] = cache_creation_input_tokens
        if cache_read_input_tokens:
            meta["cache_read_input_tokens"] = cache_read_input_tokens
        if thinking:
            meta["thinking"] = thinking

        # Agent replies bypass the send_message broadcast gate, so echoed
        # @channel/@here markup must not reach mentioned_urns (badge fan-out).
        urn_mentions = (
            sorted(
                strip_broadcast_urns(
                    extract_all_outgoing_references(
                        content,
                        organization_id=self._organization_id,
                    )
                )
            )
            if content
            else []
        )
        chat_msg = ChatMessage(
            channel_id=self._channel_id,
            sender_id=self._agent_id,
            sender_type=SenderType.AGENT,
            content=content or "",
            reply_to_id=self._trigger_message_id,
            root_id=self._thread_root_id,
            message_metadata=meta,
            mentioned_urns=urn_mentions or None,
        )
        self._session.add(chat_msg)
        await self._record_active_tokens(
            input_tokens,
            output_tokens,
            cache_creation_input_tokens,
            cache_read_input_tokens,
        )
        # Compaction summaries are context artifacts, not conversation activity.
        if role != AgentMessageRole.SUMMARY:
            await bump_channel_message_stats(
                self._session,
                self._channel_id,
                at=chat_msg.created_at,
                is_root=self._thread_root_id is None,
            )
        if self._thread_root_id is not None and kind in AGENT_THREAD_REPLY_KINDS:
            await self._record_thread_reply(at=chat_msg.created_at)
        await self._session.commit()
        await self._session.refresh(chat_msg)

        return AgentMessage(
            id=chat_msg.id,
            session_id=self._channel_id,
            role=role,
            content=content,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            tool_args=tool_args,
            tool_result=tool_result,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            created_at=chat_msg.created_at,
        )

    async def reserve_assistant_placeholder(self) -> AgentMessage | None:
        """Insert an empty `kind=final` row flagged `streaming=true` that
        AGENT_TOKEN_DELTA events patch client-side. Called on the first
        non-empty token so empty `tool_use` turns leave no ghost bubble.
        """
        meta: dict = {
            "kind": "final",
            "agent_id": str(self._agent_id),
            "trigger_message_id": str(self._trigger_message_id),
            "streaming": True,
        }
        chat_msg = ChatMessage(
            channel_id=self._channel_id,
            sender_id=self._agent_id,
            sender_type=SenderType.AGENT,
            content="",
            reply_to_id=self._trigger_message_id,
            root_id=self._thread_root_id,
            message_metadata=meta,
        )
        self._session.add(chat_msg)
        await bump_channel_message_stats(
            self._session,
            self._channel_id,
            at=chat_msg.created_at,
            is_root=self._thread_root_id is None,
        )
        # The placeholder IS the reply row (finalized in place), so it counts
        # here; a discarded placeholder gives the count back.
        if self._thread_root_id is not None:
            await self._record_thread_reply(at=chat_msg.created_at)
        await self._session.commit()
        await self._session.refresh(chat_msg)
        return AgentMessage(
            id=chat_msg.id,
            session_id=self._channel_id,
            role="assistant",
            content="",
            created_at=chat_msg.created_at,
        )

    async def finalize_assistant_placeholder(
        self,
        *,
        message_id: UUID,
        content: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_creation_input_tokens: int = 0,
        cache_read_input_tokens: int = 0,
        model: str | None = None,
        thinking: list[dict] | None = None,
    ) -> AgentMessage:
        """Write final content + token usage onto a reserved placeholder.

        Clears `metadata.streaming` so subscribers know the row is settled.
        Falls back to `add_message` if the row vanished.
        """
        chat_msg = await self._session.get(ChatMessage, message_id)
        if chat_msg is None:
            return await self.add_message(
                role="assistant",
                content=content,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_creation_input_tokens=cache_creation_input_tokens,
                cache_read_input_tokens=cache_read_input_tokens,
                model=model,
                thinking=thinking,
            )

        chat_msg.content = content or ""
        # Same broadcast strip as the insert path: finalize rewrites the row.
        urn_mentions = (
            sorted(
                strip_broadcast_urns(
                    extract_all_outgoing_references(
                        content,
                        organization_id=self._organization_id,
                    )
                )
            )
            if content
            else []
        )
        chat_msg.mentioned_urns = urn_mentions or None
        meta = dict(chat_msg.message_metadata or {})
        meta.pop("streaming", None)
        if model:
            meta["model"] = model
        if input_tokens:
            meta["input_tokens"] = input_tokens
        if output_tokens:
            meta["output_tokens"] = output_tokens
        if cache_creation_input_tokens:
            meta["cache_creation_input_tokens"] = cache_creation_input_tokens
        if cache_read_input_tokens:
            meta["cache_read_input_tokens"] = cache_read_input_tokens
        if thinking:
            meta["thinking"] = thinking
        chat_msg.message_metadata = meta
        await self._record_active_tokens(
            input_tokens,
            output_tokens,
            cache_creation_input_tokens,
            cache_read_input_tokens,
        )
        await self._session.commit()
        await self._session.refresh(chat_msg)

        return AgentMessage(
            id=chat_msg.id,
            session_id=self._channel_id,
            role="assistant",
            content=content,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_creation_input_tokens=cache_creation_input_tokens,
            cache_read_input_tokens=cache_read_input_tokens,
            created_at=chat_msg.created_at,
        )

    async def _load_thread_context_rows(self, conditions: list) -> list[ChatMessage]:
        """Root message, that thread's own replies, and what preceded it.

        Ambient rows stop at the root's timestamp so the window stays a single
        story: what led to the topic, then the topic, then the branch. Channel
        talk that happened after the thread opened belongs to the channel.
        """
        root = (
            await self._session.execute(
                select(ChatMessage).where(*conditions, ChatMessage.id == self._thread_root_id)
            )
        ).scalar_one_or_none()

        ambient_conditions = [*conditions, ChatMessage.root_id.is_(None)]
        if root is not None:
            ambient_conditions.append(ChatMessage.created_at < root.created_at)
        ambient_result = await self._session.execute(
            select(ChatMessage)
            .where(*ambient_conditions)
            .order_by(ChatMessage.created_at.desc())
            .limit(THREAD_AMBIENT_CHANNEL_LIMIT)
        )
        rows = list(ambient_result.scalars().all())
        rows.reverse()

        if root is not None:
            rows.append(root)

        replies_result = await self._session.execute(
            select(ChatMessage)
            .where(*conditions, ChatMessage.root_id == self._thread_root_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(THREAD_REPLY_CONTEXT_LIMIT)
        )
        replies = list(replies_result.scalars().all())
        replies.reverse()
        rows.extend(replies)

        return rows

    async def load_context_messages(
        self,
        *,
        token_budget: int,
    ) -> tuple[list[AgentMessage], int]:
        """Return recent channel history as `AgentMessage`-shaped envelopes.

        From this agent's perspective, USER messages and other agents'
        messages are both `role="user"` with `[name]:` prefixed content;
        only the current agent's own rows stay as `role="assistant"`.
        Envelopes are in-memory; `session_id` is a sentinel.
        """
        binding_row = (
            await self._session.execute(
                select(
                    AgentChannelBinding.manual_reset_at,
                    AgentChannelBinding.compaction_summary_msg_ids,
                ).where(
                    AgentChannelBinding.channel_id == self._channel_id,
                    AgentChannelBinding.agent_id == self._agent_id,
                )
            )
        ).one_or_none()
        manual_reset_at = binding_row[0] if binding_row else None
        compacted_ids = set(binding_row[1] or []) if binding_row else set()

        conditions = [
            ChatMessage.channel_id == self._channel_id,
            ChatMessage.is_deleted == False,  # noqa: E712
        ]
        if manual_reset_at is not None:
            conditions.append(ChatMessage.created_at > manual_reset_at)

        # A branch is its own conversation: a threaded turn reads its thread,
        # a channel turn reads the channel. Loading both flat let sibling
        # threads bleed into each other, in time order, with nothing marking
        # which branch a line came from.
        if self._thread_root_id is None:
            result = await self._session.execute(
                select(ChatMessage)
                .where(*conditions, ChatMessage.root_id.is_(None))
                .order_by(ChatMessage.created_at.desc())
                .limit(CHANNEL_CONTEXT_LIMIT)
            )
            rows = list(result.scalars().all())
            rows.reverse()
        else:
            rows = await self._load_thread_context_rows(conditions)

        rows = [m for m in rows if m.id not in compacted_ids]

        resolver = SenderResolver(self._session)
        refs = [(m.sender_type, m.sender_id) for m in rows if m.sender_id]
        resolved = await resolver.resolve_many(refs) if refs else {}

        sentinel_session_id = uuid4()
        envelopes: list[AgentMessage] = []
        for m in rows:
            meta = m.message_metadata or {}
            if meta.get("visibility") == ChatMessageVisibility.AGENT_INTERNAL:
                continue
            # Stale in-flight placeholder (finalize failed); empty content
            # would inject a blank assistant turn.
            if meta.get("streaming") is True:
                continue
            # Reset dividers are UI-only markers; guard catches the boundary
            # divider written exactly at `now()`.
            if meta.get("kind") == ChatMessageMetadataKind.CONTEXT_RESET:
                continue

            kind = meta.get("kind")
            is_self_agent = m.sender_type == SenderType.AGENT and m.sender_id == self._agent_id

            if is_self_agent and kind == ChatMessageMetadataKind.SUMMARY:
                role = AgentMessageRole.SUMMARY
            elif is_self_agent and kind == ChatMessageMetadataKind.TOOL_CALL:
                role = AgentMessageRole.ASSISTANT
            elif is_self_agent and kind == ChatMessageMetadataKind.TOOL_RESULT:
                role = AgentMessageRole.TOOL
            elif is_self_agent:
                role = AgentMessageRole.ASSISTANT
            else:
                # Includes USER, SYSTEM, and AGENT-from-a-different-agent.
                role = AgentMessageRole.USER

            content = m.content or None
            if role == AgentMessageRole.USER and content:
                info = resolved.get(m.sender_id) if m.sender_id else None
                name = info.display_name if info else _FALLBACK_SENDER_NAME
                content = f"[{name}]: {content}"

            envelopes.append(
                AgentMessage(
                    id=m.id,
                    session_id=sentinel_session_id,
                    role=role,
                    content=content,
                    tool_name=meta.get("tool_name"),
                    tool_call_id=meta.get("tool_call_id"),
                    tool_args=meta.get("tool_args"),
                    tool_result=meta.get("tool_result"),
                    model=meta.get("model"),
                    input_tokens=int(meta.get("input_tokens") or 0),
                    output_tokens=int(meta.get("output_tokens") or 0),
                    created_at=m.created_at,
                )
            )

        return envelopes, len(envelopes)

    async def compact_if_needed(
        self,
        *,
        token_budget: int,
    ) -> None:
        # Chat-channel compaction is driven by ChatAgentContextOperations,
        # not by the runtime.
        return
