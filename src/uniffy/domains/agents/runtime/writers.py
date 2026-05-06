"""Pluggable message writers for the streaming runtime.

A writer is the persistence boundary that `stream_send_message` drives into.
Two implementations exist:

- `SessionMessageWriter` wraps `SessionOperations` and is a no-op relative
  to pre-Phase-2 behavior. Every existing call site keeps working.
- `ChatChannelMessageWriter` persists into `chat_messages` with
  `sender_type=AGENT`. In Phase 2a the class is a stub; the implementation
  lands in 2b (context) and 2c (event translation + writes).

Both writers hide the backing store from the runtime. Runtime events still
carry `AgentMessage` shapes -- the chat writer constructs lightweight
envelope objects (not persisted to `agents_messages`) so downstream event
handlers see a uniform type. Destination-specific consumers (the chat
bridge, session RPC handler) interpret the envelope as needed.
"""

from __future__ import annotations

import contextlib
from typing import TYPE_CHECKING, Protocol
from uuid import UUID, uuid4

from sqlalchemy import or_, select, update

from uniffy.core.content.references import extract_all_outgoing_references
from uniffy.core.models.agents.channel_binding import AgentChannelBinding
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.models.chat.message import ChatMessage, SenderType

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from uniffy.domains.agents.sessions.operations import SessionOperations


_FALLBACK_SENDER_NAME = "Unknown"


def _metadata_kind_for(role: str, tool_call_id: str | None) -> str:
    """Map runtime role + presence of tool_call_id to a chat `metadata.kind`.

    The chat renderer uses `kind` to pick the correct message card
    (final turn vs tool call vs tool result vs summary).
    """
    if role == "summary":
        return "summary"
    if role == "tool":
        return "tool_result"
    if role == "assistant" and tool_call_id:
        return "tool_call"
    return "final"


class MessageWriter(Protocol):
    """Persistence and context contract for the streaming runtime.

    All write paths and the context load go through this protocol so the
    runtime body does not care whether it is driving an `AgentSession` or
    a `ChatChannel`.
    """

    @property
    def approval_scope_id(self) -> UUID:
        """Identifier under which destructive-tool approvals are keyed."""

    @property
    def approval_actor_user_id(self) -> UUID | None:
        """User whose click resolves an approval (chat path only)."""

    @property
    def approval_agent_id(self) -> UUID | None:
        """Agent whose tool triggered the approval (chat path only)."""

    @property
    def approval_channel_id(self) -> UUID | None:
        """Channel the approval belongs to (chat path only)."""

    async def add_message(
        self,
        *,
        role: str,
        content: str | None = None,
        input_tokens: int = 0,
        output_tokens: int = 0,
        model: str | None = None,
        tool_name: str | None = None,
        tool_call_id: str | None = None,
        tool_args: dict | None = None,
        tool_result: str | None = None,
        is_thinking: bool = False,
        file_ids: list[str] | None = None,
    ) -> AgentMessage:
        """Persist a message and return an `AgentMessage`-shaped envelope."""

    async def reserve_assistant_placeholder(self) -> AgentMessage | None:
        """Insert an empty in-flight assistant row that streamed deltas patch.

        Returns the envelope wrapping the new row (so the runtime can
        announce it to subscribers via `RuntimeMessageStoredEvent`), or
        `None` if the writer does not support per-token streaming -- in
        that case the runtime keeps the buffer-then-write path.
        """

    async def finalize_assistant_placeholder(
        self,
        *,
        message_id: UUID,
        content: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        model: str | None = None,
    ) -> AgentMessage:
        """Persist the final content + token usage onto a reserved placeholder.

        Clears the `metadata.streaming` flag so subscribers know the row
        is no longer in-flight. Returns an `AgentMessage` envelope for
        the finalized row.
        """

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
        """Schedule async compaction when the context exceeds the budget.

        Implementations enqueue an out-of-band job (or no-op when the
        destination has its own compaction system); the runtime never
        blocks on an LLM summarisation call here.
        """


class SessionMessageWriter:
    """Session writer that persists into `agents_messages`.

    Delegates to `SessionOperations` unchanged; the runtime treats every
    call as it did before Phase 2. Approval scope is the session id.
    """

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
        return None

    @property
    def approval_agent_id(self) -> UUID | None:
        return None

    @property
    def approval_channel_id(self) -> UUID | None:
        return None

    @property
    def session_id(self) -> UUID:
        """Session id. Exposed for run-log creation (session path only)."""
        return self._session_id

    async def add_message(
        self,
        *,
        role: str,
        content: str | None = None,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_read_input_tokens: int = 0,
        model: str | None = None,
        tool_name: str | None = None,
        tool_call_id: str | None = None,
        tool_args: dict | None = None,
        tool_result: str | None = None,
        is_thinking: bool = False,
        file_ids: list[str] | None = None,
    ) -> AgentMessage:
        return await self._session_ops.add_message(
            user_id=self._user_id,
            organization_id=self._organization_id,
            session_id=self._session_id,
            role=role,
            content=content,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_input_tokens=cache_read_input_tokens,
            model=model,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            tool_args=tool_args,
            tool_result=tool_result,
            is_thinking=is_thinking,
            file_ids=file_ids,
        )

    async def reserve_assistant_placeholder(self) -> AgentMessage | None:
        """Session writer does not stream deltas; placeholder unused."""
        return None

    async def finalize_assistant_placeholder(
        self,
        *,
        message_id: UUID,
        content: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        model: str | None = None,
    ) -> AgentMessage:
        """Unreachable -- session writer never returns a placeholder to finalize."""
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
    """Phase 2a skeleton. Full implementation lands in 2b/2c/2g.

    Construction records the (channel, agent, trigger) triple and sets the
    approval scope to the channel id so a destructive-tool approval in one
    DM does not collide with another DM's pending approval.
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
        # When the trigger is a thread reply, `thread_root_id` points at the
        # thread's root message and every agent-authored row inherits it so
        # tool cards + tool results + the final reply all land inside the
        # same thread instead of the channel root.
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
        cache_read_input_tokens: int = 0,
    ) -> None:
        """Cache provider-reported prompt + completion sizes on the binding.

        ``input_tokens`` and ``output_tokens`` come straight from the LLM
        response and are the only accurate signal for what the model just
        ingested + just produced. ``cache_read_input_tokens`` is the
        share of the prompt served from Anthropic's prompt cache --
        billed at ~10% of base input price. The chat context meter
        reads these columns instead of re-running a heuristic.

        ``last_active_token_estimate`` stores the *full* prompt size
        (uncached input + cache hits), since both contribute to context
        window pressure. The cache-hit count is stored separately so
        the meter can show the savings.

        The UPDATE is gated by ``last_active_token_estimate < :new_value
        OR last_active_token_estimate IS NULL`` so when two agents in
        the same channel commit concurrently the larger input wins
        deterministically. Output and cache fields are written in the
        same row so the trio stays paired with the latest turn.
        """
        if input_tokens <= 0 and cache_read_input_tokens <= 0:
            return
        new_cache_read = max(0, int(cache_read_input_tokens))
        new_input = max(0, int(input_tokens)) + new_cache_read
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

    async def add_message(
        self,
        *,
        role: str,
        content: str | None = None,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_read_input_tokens: int = 0,
        model: str | None = None,
        tool_name: str | None = None,
        tool_call_id: str | None = None,
        tool_args: dict | None = None,
        tool_result: str | None = None,
        is_thinking: bool = False,
        file_ids: list[str] | None = None,
    ) -> AgentMessage:
        """Persist a runtime-step message into `chat_messages`.

        `role="user"` is a no-op: the triggering user message is already
        in the channel as `trigger_message_id`. We return an envelope so
        the runtime's `RuntimeMessageStoredEvent` flow stays uniform.

        Every other role persists a `sender_type=AGENT` message in the
        channel and returns an envelope. The `metadata.kind` field is
        how the renderer distinguishes tool cards / tool results /
        summaries / final turns.
        """
        if role == "user":
            return AgentMessage(
                id=self._trigger_message_id,
                session_id=self._channel_id,
                role="user",
                content=content,
                file_ids=file_ids,
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
        if model:
            meta["model"] = model
        if input_tokens:
            meta["input_tokens"] = input_tokens
        if output_tokens:
            meta["output_tokens"] = output_tokens
        if cache_read_input_tokens:
            meta["cache_read_input_tokens"] = cache_read_input_tokens

        urn_mentions = (
            sorted(
                extract_all_outgoing_references(
                    content,
                    organization_id=self._organization_id,
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
            input_tokens, output_tokens, cache_read_input_tokens
        )
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
        """Insert an empty `kind=final` row flagged `streaming=true`.

        The row is the anchor every AGENT_TOKEN_DELTA event will patch
        client-side. The runtime calls this on the first non-empty token
        of a stream so empty stop_reason="tool_use" turns do not leave
        ghost bubbles in the channel.
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
        cache_read_input_tokens: int = 0,
        model: str | None = None,
    ) -> AgentMessage:
        """Write final content + token usage onto a reserved placeholder.

        The reservation set `metadata.streaming=true`; finalisation drops
        it so subscribers can tell the row is settled. Falls back to a
        fresh `add_message` if the row vanished (e.g. transient delete).
        """
        chat_msg = await self._session.get(ChatMessage, message_id)
        if chat_msg is None:
            return await self.add_message(
                role="assistant",
                content=content,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_read_input_tokens=cache_read_input_tokens,
                model=model,
            )

        chat_msg.content = content or ""
        urn_mentions = (
            sorted(
                extract_all_outgoing_references(
                    content,
                    organization_id=self._organization_id,
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
        if cache_read_input_tokens:
            meta["cache_read_input_tokens"] = cache_read_input_tokens
        chat_msg.message_metadata = meta
        await self._record_active_tokens(
            input_tokens, output_tokens, cache_read_input_tokens
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
            cache_read_input_tokens=cache_read_input_tokens,
            created_at=chat_msg.created_at,
        )

    async def load_context_messages(
        self,
        *,
        token_budget: int,
    ) -> tuple[list[AgentMessage], int]:
        """Return recent channel history as `AgentMessage`-shaped envelopes.

        Pulls the most recent 50 non-deleted messages in the channel,
        excluding anything tagged `metadata.visibility == 'agent_internal'`,
        and renders them oldest-first.

        Sender attribution: each USER-authored message gets its content
        prefixed with `[{display_name}]: ` so the LLM can distinguish
        participants in group channels. AGENT-authored messages from a
        DIFFERENT agent than the current one are likewise prefixed AND
        remapped to `role="user"` — from this agent's perspective, another
        agent is an external participant. Only the current agent's own
        history stays as `role="assistant"`, unprefixed.

        Envelope mapping:
          - USER / SYSTEM -> role="user", content prefixed
          - AGENT (same id) + kind=="summary" -> role="summary"
          - AGENT (same id) + kind=="tool_call" -> role="assistant" + tool_*
          - AGENT (same id) + kind=="tool_result" -> role="tool" + tool_*
          - AGENT (same id) otherwise -> role="assistant"
          - AGENT (different id) -> role="user", content prefixed

        The envelopes are in-memory only (session_id is a sentinel); they
        are never added to the ORM session and never persisted.
        """
        from uniffy.domains.chat.sender_resolver import SenderResolver

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

        result = await self._session.execute(
            select(ChatMessage)
            .where(*conditions)
            .order_by(ChatMessage.created_at.desc())
            .limit(50)
        )
        rows = [m for m in result.scalars().all() if m.id not in compacted_ids]
        rows.reverse()

        resolver = SenderResolver(self._session)
        refs = [(m.sender_type, m.sender_id) for m in rows if m.sender_id]
        resolved = await resolver.resolve_many(refs) if refs else {}

        sentinel_session_id = uuid4()
        envelopes: list[AgentMessage] = []
        for m in rows:
            meta = m.message_metadata or {}
            if meta.get("visibility") == "agent_internal":
                continue
            # Skip stale in-flight placeholders (streaming flag never cleared
            # because finalize failed). They carry empty content and would
            # inject a blank assistant turn into the prompt.
            if meta.get("streaming") is True:
                continue
            # Reset dividers are UI-only markers and must never enter the
            # prompt. The `manual_reset_at` filter above already excludes any
            # divider written by an earlier reset; this guard catches the
            # boundary divider written exactly at `now()`.
            if meta.get("kind") == "context_reset":
                continue

            kind = meta.get("kind")
            is_self_agent = m.sender_type == SenderType.AGENT and m.sender_id == self._agent_id

            if is_self_agent and kind == "summary":
                role = "summary"
            elif is_self_agent and kind == "tool_call":
                role = "assistant"
            elif is_self_agent and kind == "tool_result":
                role = "tool"
            elif is_self_agent:
                role = "assistant"
            else:
                # Includes USER, SYSTEM, and AGENT-from-a-different-agent.
                role = "user"

            content = m.content or None
            if role == "user" and content:
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
        """No-op. Chat-channel compaction is driven separately by
        ``ChatAgentContextOperations.compact`` in
        ``chat_integration/context.py`` (writes a ``kind='summary'`` chat
        row and bumps ``binding.compaction_summary_msg_ids``); the runtime
        never enqueues that here.
        """
        return
