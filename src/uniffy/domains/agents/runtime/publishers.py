"""Runtime stream publishers.

Two surfaces consume agent runtime events: chat (multi-subscriber
fan-out, no replay) and the direct RPC handler (single subscriber per
``run_id``, replay-required). The ``RuntimeStreamPublisher`` Protocol
abstracts both so the runtime drives one shape regardless of where
events land.

- :class:`ChatStreamPublisher` -- pubsub fan-out via the existing
  per-member channel pipe. Translates each :class:`StreamEvent`
  into the matching chat event, plus DB side-effects (placeholder
  announcement, error-message persistence) that the chat surface
  requires.
- :class:`RunStreamPublisher` -- Valkey Streams XADD keyed on
  ``agent:run:{run_id}`` with monotonic per-run sequence numbers.
  Token bursts are coalesced (default 30ms) before each XADD so the
  per-token publish overhead stays bounded under the LLM's streaming
  rate.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Protocol
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.chat.thread import ChatThreadStats
from uniffy.core.valkey.streams import (
    RUN_STATE_TTL_SECONDS,
    RUN_STREAM_DEFAULT_MAXLEN,
    run_state_key,
    run_stream_key,
    set_run_state,
    stream_xadd,
)
from uniffy.domains.agents.providers.base import EventType, StreamEvent
from uniffy.domains.agents.runtime.converters import runtime_stream_event_to_json
from uniffy.domains.chat.messages.operations import (
    bump_channel_message_stats,
    counts_as_thread_reply,
    drop_thread_reply,
    record_thread_reply,
)
from uniffy.domains.chat.streaming import events as chat_evt
from uniffy.domains.chat.streaming.publisher import publish_channel_event_to_members

logger = logger.bind(component="agents.runtime.publishers")

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


APPROVAL_TTL_SECONDS = 24 * 60 * 60
DEFAULT_TOKEN_FLUSH_MS = int(os.getenv("RUN_STREAM_TOKEN_FLUSH_MS", "30"))
DEFAULT_TOKEN_BUFFER_CAP = 32


class RuntimeStreamPublisher(Protocol):
    """Surface for fanning runtime stream events out to subscribers."""

    async def publish(self, event: StreamEvent) -> None:
        """Publish a single runtime event."""

    async def close(self) -> None:
        """Flush buffers and release any held resources."""


class ChatStreamPublisher:
    """Translate runtime events into chat-surface events.

    Behaviour-preserving extraction of the original
    ``AgentChatBridge._publish_runtime_event`` switch: same chat events,
    same DB side-effects (placeholder announcement, error-message
    persistence), same dedupe via the ``announced_placeholders`` set.
    """

    def __init__(
        self,
        *,
        session: AsyncSession,
        channel_id: UUID,
        agent_id: UUID,
        member_ids: list[UUID],
        actor_user_id: UUID,
        trigger_message_id: UUID,
        thread_root_id: UUID | None,
    ) -> None:
        self._session = session
        self._channel_id = channel_id
        self._agent_id = agent_id
        self._member_ids = member_ids
        self._actor_user_id = actor_user_id
        self._trigger_message_id = trigger_message_id
        self._thread_root_id = thread_root_id
        self._announced_placeholders: set[UUID] = set()

    async def publish(self, event: StreamEvent) -> None:
        """Translate and fan one runtime event into chat events.

        Block-framing events without a chat rendering (text/tool block
        start/end, model call framing, reply start) are dropped here;
        the chat surface reconstructs state from deltas + tool status.
        """
        match event.type:
            case EventType.TEXT_BLOCK_DELTA:
                await self._publish_text_delta(event)
            case (
                EventType.THINKING_BLOCK_DELTA | EventType.THINKING_BLOCK_END
            ):
                await self._publish_thinking(event)
            case EventType.MESSAGE_STORED:
                envelope = event.message
                if envelope.role == "assistant" and envelope.id is not None:
                    self._announced_placeholders.add(envelope.id)
                    await self._publish_message_created(envelope.id)
            case EventType.TOOL_RESULT_START:
                if event.message_id is not None:
                    await self._publish_message_created(event.message_id)
                await publish_channel_event_to_members(
                    self._member_ids,
                    chat_evt.AGENT_TOOL_CALL,
                    chat_evt.build_agent_tool_call_payload(
                        message_id=event.message_id or self._agent_id,
                        agent_id=self._agent_id,
                        tool_name=event.tool_name,
                        tool_call_id=event.tool_call_id,
                        status="STARTED",
                        preview=_truncate_json(event.tool_args),
                    ),
                    channel_id=self._channel_id,
                )
            case EventType.TOOL_RESULT_END:
                if event.message_id is not None:
                    await self._publish_message_created(event.message_id)
                await publish_channel_event_to_members(
                    self._member_ids,
                    chat_evt.AGENT_TOOL_CALL,
                    chat_evt.build_agent_tool_call_payload(
                        message_id=event.message_id or self._agent_id,
                        agent_id=self._agent_id,
                        tool_name=event.tool_name,
                        tool_call_id=event.tool_call_id,
                        status="COMPLETED" if event.success else "FAILED",
                        preview=_truncate(event.tool_result),
                        error_message=None if event.success else event.tool_result,
                    ),
                    channel_id=self._channel_id,
                )
            case EventType.CONFIRMATION_REQUIRED:
                if event.message_id is not None:
                    await self._publish_message_created(event.message_id)
                expires_at = datetime.now(UTC) + timedelta(
                    seconds=APPROVAL_TTL_SECONDS
                )
                request_id = event.request_id or event.message_id or self._agent_id
                await publish_channel_event_to_members(
                    self._member_ids,
                    chat_evt.AGENT_CONFIRMATION_REQUESTED,
                    chat_evt.build_agent_confirmation_requested_payload(
                        message_id=event.message_id or self._agent_id,
                        agent_id=self._agent_id,
                        request_id=request_id,
                        tool_name=event.tool_name,
                        args_preview=_truncate_json(event.tool_args),
                        actor_user_id=self._actor_user_id,
                        expires_at=expires_at,
                    ),
                    channel_id=self._channel_id,
                )
            case EventType.DONE:
                if event.assistant_message is not None:
                    msg_id = event.assistant_message.id
                    if msg_id in self._announced_placeholders:
                        await publish_channel_event_to_members(
                            self._member_ids,
                            chat_evt.AGENT_TOKEN_DELTA,
                            chat_evt.build_agent_token_delta_payload(
                                message_id=msg_id,
                                agent_id=self._agent_id,
                                delta="",
                                sequence=2_000_000_000,
                                final=True,
                            ),
                            channel_id=self._channel_id,
                        )
                        await self._publish_message_event(
                            msg_id, chat_evt.MESSAGE_UPDATED
                        )
                    else:
                        await self._publish_message_created(msg_id)
            case EventType.SKILL_DRAFT:
                await self.write_skill_draft_card(event.draft)
            case EventType.ERROR:
                logger.warning(
                    f"Agent runtime error for agent={self._agent_id} "
                    f"channel={self._channel_id}: {event.error}"
                )
                try:
                    await self.write_agent_error_message(event.error)
                except Exception:
                    logger.exception("Failed to write agent error message to chat")
            case _:
                pass

    async def close(self) -> None:
        """No buffers to flush; kept for protocol parity."""
        return None

    async def _publish_text_delta(self, event: StreamEvent) -> None:
        if event.message_id is None or not event.delta:
            return
        await publish_channel_event_to_members(
            self._member_ids,
            chat_evt.AGENT_TOKEN_DELTA,
            chat_evt.build_agent_token_delta_payload(
                message_id=event.message_id,
                agent_id=self._agent_id,
                delta=event.delta,
                sequence=event.sequence,
            ),
            channel_id=self._channel_id,
        )

    async def _publish_thinking(self, event: StreamEvent) -> None:
        """Fan a thinking delta (or the closing final marker) to the channel.

        Thinking rides its own chat event and never touches message
        content; without a placeholder row there is nothing to anchor
        the pane to, so events before reservation are dropped.
        """
        if event.message_id is None:
            return
        final = event.type is EventType.THINKING_BLOCK_END
        if not final and not event.delta:
            return
        await publish_channel_event_to_members(
            self._member_ids,
            chat_evt.AGENT_THINKING_DELTA,
            chat_evt.build_agent_thinking_delta_payload(
                message_id=event.message_id,
                agent_id=self._agent_id,
                block_id=event.block_id,
                delta=event.delta if not final else "",
                sequence=event.sequence,
                final=final,
                elapsed_ms=event.elapsed_ms,
            ),
            channel_id=self._channel_id,
        )

    async def _publish_message_created(self, message_id: UUID) -> None:
        await self._publish_message_event(message_id, chat_evt.MESSAGE_CREATED)

    async def _publish_message_event(self, message_id: UUID, event_type: str) -> None:
        msg = await self._session.get(ChatMessage, message_id)
        if msg is None:
            return
        await publish_channel_event_to_members(
            self._member_ids,
            event_type,
            chat_evt.build_message_payload(
                message_id=msg.id,
                channel_id=msg.channel_id,
                sender_id=msg.sender_id,
                sender_type=msg.sender_type.value
                if hasattr(msg.sender_type, "value")
                else str(msg.sender_type),
                content=msg.content or "",
                root_id=msg.root_id,
                created_at=msg.created_at,
                metadata=msg.message_metadata,
                reply_to_id=msg.reply_to_id,
            ),
            channel_id=msg.channel_id,
        )
        if event_type == chat_evt.MESSAGE_CREATED and counts_as_thread_reply(msg):
            await self._publish_thread_updated(msg.root_id)

    async def _publish_thread_updated(self, root_message_id: UUID) -> None:
        """Fan the thread's new reply count so root-message footers stay live.

        Columns are selected rather than loaded through the identity map: the
        counter is moved with a Core UPDATE, so a cached ORM row would report
        the pre-reply count.
        """
        row = (
            await self._session.execute(
                select(ChatThreadStats.reply_count, ChatThreadStats.last_reply_at).where(
                    ChatThreadStats.root_message_id == root_message_id
                )
            )
        ).one_or_none()
        if row is None:
            return
        await publish_channel_event_to_members(
            self._member_ids,
            chat_evt.THREAD_UPDATED,
            chat_evt.build_thread_updated_payload(
                root_message_id=root_message_id,
                reply_count=row[0],
                last_reply_at=row[1] or datetime.now(UTC),
                latest_participant_id=self._agent_id,
            ),
            channel_id=self._channel_id,
        )

    async def write_agent_error_message(self, error_text: str) -> None:
        """Persist + fan a ``metadata.kind="agent_error"`` chat row."""
        await self._clear_streaming_placeholders()

        text = (error_text or "Unknown error").strip()
        display = text if len(text) <= 500 else text[:500] + "..."
        meta = {
            "kind": "agent_error",
            "agent_id": str(self._agent_id),
            "trigger_message_id": str(self._trigger_message_id),
            "raw_error": text[:4000],
        }
        row = ChatMessage(
            channel_id=self._channel_id,
            sender_id=self._agent_id,
            sender_type=SenderType.AGENT,
            content=display,
            reply_to_id=self._trigger_message_id,
            root_id=self._thread_root_id,
            message_metadata=meta,
        )
        self._session.add(row)
        await bump_channel_message_stats(
            self._session,
            self._channel_id,
            at=row.created_at,
            is_root=self._thread_root_id is None,
        )
        await self._record_thread_reply(at=row.created_at)
        await self._session.commit()
        await self._session.refresh(row)
        await self._publish_message_created(row.id)

    async def write_skill_draft_card(self, draft) -> None:
        """Persist + fan a ``metadata.kind="skill_draft"`` review card.

        Links the draft row back to this card (``channel_id`` /
        ``origin_chat_message_id``) so a later save/discard can settle the card.
        Metadata values are strings (the chat metadata wire type is
        ``map<string,string>``).
        """
        from uniffy.core.models.agents.skill_draft import AgentSkillDraft

        display = draft.display_name or draft.name or "Untitled skill"
        summary = (draft.description or "").strip()
        body = f"Proposed skill: {display}"
        if summary:
            body = f"{body} - {summary}"
        meta = {
            "kind": "skill_draft",
            "agent_id": str(self._agent_id),
            "draft_id": str(draft.id),
            "draft_kind": draft.kind,
            "draft_name": draft.name or "",
            "draft_display_name": display,
            "draft_description": summary[:500],
            "draft_status": "pending",
            "actor_user_id": str(self._actor_user_id),
            "trigger_message_id": str(self._trigger_message_id),
        }
        row = ChatMessage(
            channel_id=self._channel_id,
            sender_id=self._agent_id,
            sender_type=SenderType.AGENT,
            content=body,
            reply_to_id=self._trigger_message_id,
            root_id=self._thread_root_id,
            message_metadata=meta,
        )
        self._session.add(row)
        await bump_channel_message_stats(
            self._session,
            self._channel_id,
            at=row.created_at,
            is_root=self._thread_root_id is None,
        )
        await self._record_thread_reply(at=row.created_at)
        await self._session.commit()
        await self._session.refresh(row)

        draft_row = await self._session.get(AgentSkillDraft, draft.id)
        if draft_row is not None:
            draft_row.channel_id = self._channel_id
            draft_row.origin_chat_message_id = row.id
            await self._session.commit()

        await self._publish_message_created(row.id)

    async def discard_empty_placeholders(self) -> None:
        """Public hook for a cancelled run: drop empty assistant placeholders
        while keeping any partial text already streamed.

        Commits before the thread fan-out so subscribers never read a count the
        database has not settled on yet.
        """
        await self._clear_streaming_placeholders()
        if self._thread_root_id is not None:
            await self._session.commit()
            await self._publish_thread_updated(self._thread_root_id)

    async def mark_run_stopped(self) -> None:
        """Flag the trigger user message so the UI shows its reply was stopped.

        Stored as the string ``"true"`` because the chat metadata wire type is
        ``map<string, string>``. The fan-out payload is built from the loaded row
        BEFORE commit - commit expires every attribute and an async session can't
        lazy-load them back - then published once the write lands.
        """
        trigger = await self._session.get(ChatMessage, self._trigger_message_id)
        if trigger is None:
            return
        new_meta = {**(trigger.message_metadata or {}), "agent_run_stopped": "true"}
        payload = chat_evt.build_message_payload(
            message_id=trigger.id,
            channel_id=trigger.channel_id,
            sender_id=trigger.sender_id,
            sender_type=trigger.sender_type.value
            if hasattr(trigger.sender_type, "value")
            else str(trigger.sender_type),
            content=trigger.content or "",
            root_id=trigger.root_id,
            created_at=trigger.created_at,
            metadata=new_meta,
            reply_to_id=trigger.reply_to_id,
        )
        trigger.message_metadata = new_meta
        await self._session.commit()
        await publish_channel_event_to_members(
            self._member_ids,
            chat_evt.MESSAGE_UPDATED,
            payload,
            channel_id=self._channel_id,
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

    async def _clear_streaming_placeholders(self) -> None:
        """Drop empty assistant placeholders left over by an aborted run."""
        result = await self._session.execute(
            select(ChatMessage).where(
                ChatMessage.channel_id == self._channel_id,
                ChatMessage.sender_type == SenderType.AGENT,
                ChatMessage.sender_id == self._agent_id,
                ChatMessage.reply_to_id == self._trigger_message_id,
                ChatMessage.message_metadata["streaming"].astext == "true",
            )
        )
        for row in result.scalars().all():
            if self._thread_root_id is not None:
                await drop_thread_reply(self._session, self._thread_root_id)
            await self._session.delete(row)
        await self._session.flush()


class RunStreamPublisher:
    """Append runtime events to a per-run Valkey Stream.

    Each event lands in ``agent:run:{run_id}`` with a monotonic ``seq``.
    Token bursts are coalesced for up to ``flush_ms`` (default 30ms,
    configurable via ``RUN_STREAM_TOKEN_FLUSH_MS``) before each XADD so
    the publish rate stays bounded; any non-token event flushes the
    buffer first to keep ordering. The state hash is rewritten on each
    publish so a late subscriber sees ``last_seq`` aligned with the
    stream tail.
    """

    def __init__(
        self,
        *,
        run_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        flush_ms: int = DEFAULT_TOKEN_FLUSH_MS,
        buffer_cap: int = DEFAULT_TOKEN_BUFFER_CAP,
        maxlen: int = RUN_STREAM_DEFAULT_MAXLEN,
        state_ttl: int = RUN_STATE_TTL_SECONDS,
    ) -> None:
        self._run_id = run_id
        self._user_id = user_id
        self._organization_id = organization_id
        self._session_id = session_id
        self._stream_key = run_stream_key(run_id)
        self._state_key = run_state_key(run_id)
        self._flush_seconds = max(0.0, flush_ms / 1000.0)
        self._buffer_cap = max(1, buffer_cap)
        self._maxlen = maxlen
        self._state_ttl = state_ttl
        self._seq = 0
        self._token_buffer: list[StreamEvent] = []
        self._lock = asyncio.Lock()
        self._started_at = datetime.now(UTC)
        self._pending_flush: asyncio.Task[None] | None = None

    @property
    def last_seq(self) -> int:
        """Highest sequence number written so far. ``0`` if nothing published."""
        return self._seq

    async def publish(self, event: StreamEvent) -> None:
        """Append a single event, coalescing delta bursts when possible.

        Only same-type, same-block deltas coalesce; any other event
        (including a delta from a different block) flushes the buffer
        first so ordering is preserved.
        """
        async with self._lock:
            if event.type in _COALESCABLE_TYPES:
                head = self._token_buffer[0] if self._token_buffer else None
                if head is not None and (
                    head.type is not event.type or head.block_id != event.block_id
                ):
                    self._cancel_pending_flush()
                    await self._flush_tokens_locked()
                self._token_buffer.append(event)
                if len(self._token_buffer) >= self._buffer_cap or self._flush_seconds <= 0:
                    self._cancel_pending_flush()
                    await self._flush_tokens_locked()
                else:
                    self._arm_pending_flush()
                return

            self._cancel_pending_flush()
            await self._flush_tokens_locked()
            await self._xadd_locked(event)

    async def close(self) -> None:
        """Flush any pending tokens. Idempotent."""
        async with self._lock:
            self._cancel_pending_flush()
            await self._flush_tokens_locked()

    def _arm_pending_flush(self) -> None:
        """Schedule a delayed flush if one isn't already running."""
        if self._pending_flush is not None and not self._pending_flush.done():
            return
        self._pending_flush = asyncio.create_task(self._delayed_flush())

    def _cancel_pending_flush(self) -> None:
        """Cancel any in-flight delayed flush task."""
        task = self._pending_flush
        self._pending_flush = None
        if task is not None and not task.done():
            task.cancel()

    async def _delayed_flush(self) -> None:
        """Wait ``flush_ms`` and drain any buffered tokens."""
        try:
            await asyncio.sleep(self._flush_seconds)
        except asyncio.CancelledError:
            return
        async with self._lock:
            if self._pending_flush is asyncio.current_task():
                self._pending_flush = None
            await self._flush_tokens_locked()

    async def _flush_tokens_locked(self) -> None:
        """Coalesce buffered same-block deltas into a single XADD."""
        if not self._token_buffer:
            return
        head = self._token_buffer[0]
        delta = "".join(t.delta for t in self._token_buffer)
        message_id = next(
            (t.message_id for t in self._token_buffer if t.message_id is not None),
            None,
        )
        sequence = max((t.sequence for t in self._token_buffer), default=0)
        coalesced = StreamEvent(
            type=head.type,
            block_id=head.block_id,
            delta=delta,
            message_id=message_id,
            sequence=sequence,
        )
        self._token_buffer.clear()
        await self._xadd_locked(coalesced)

    async def _xadd_locked(self, event: StreamEvent) -> None:
        """Serialise + XADD a single event, then refresh the state hash."""
        self._seq += 1
        payload = {
            "seq": self._seq,
            "event": runtime_stream_event_to_json(event),
        }
        await stream_xadd(self._stream_key, payload, maxlen=self._maxlen)

        status = _status_from_event(event)
        await set_run_state(
            run_id=self._run_id,
            user_id=self._user_id,
            organization_id=self._organization_id,
            session_id=self._session_id,
            status=status,
            last_seq=self._seq,
            error=event.error if event.type is EventType.ERROR else None,
            started_at=self._started_at,
            ttl=self._state_ttl,
        )


_COALESCABLE_TYPES = frozenset({
    EventType.TEXT_BLOCK_DELTA,
    EventType.THINKING_BLOCK_DELTA,
})


def _status_from_event(event: StreamEvent) -> str:
    """Map a runtime event to a coarse run-state ``status``."""
    if event.type is EventType.DONE:
        return "done"
    if event.type is EventType.ERROR:
        return "error"
    return "running"


def _truncate(value: str | None, limit: int = 200) -> str:
    """Shorten a preview string while keeping it human-skimmable."""
    if not value:
        return ""
    if len(value) <= limit:
        return value
    return value[: limit - 3] + "..."


def _truncate_json(payload: dict | None, limit: int = 200) -> str:
    """Render a dict as compact JSON, truncated for preview display."""
    if not payload:
        return ""
    try:
        return _truncate(
            json.dumps(payload, default=str, separators=(",", ":")),
            limit,
        )
    except (TypeError, ValueError):
        return _truncate(str(payload), limit)
