"""AgentChatBridge: runtime-to-chat translator.

The bridge is the seam between chat message events and the agent runtime.
It owns:

1. The orchestration: load trigger message + channel + agent, invoke
   `RuntimeOperations.stream_send_message` with a `ChatDestination`, and
   translate each streamed runtime event into chat events.
2. The confirmation-decision resume (Phase 2e wires real behavior).

The writer inside the runtime persists chat messages; the bridge is
only responsible for the fan-out side (publishing stream events + the
`MESSAGE_CREATED` companion for new chat rows).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.approval_audit import AgentApprovalAudit
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.types import SubjectType
from uniffy.domains.agents.runtime.approvals import get_approval_store
from uniffy.domains.agents.runtime.destinations import ChatDestination
from uniffy.domains.agents.runtime.operations import RuntimeOperations
from uniffy.domains.agents.runtime.stream_events import (
    RuntimeConfirmationRequiredEvent,
    RuntimeDoneEvent,
    RuntimeErrorEvent,
    RuntimeMessageStoredEvent,
    RuntimeStreamEvent,
    RuntimeTokenEvent,
    RuntimeToolCallEvent,
    RuntimeToolResultEvent,
)
from uniffy.domains.chat.streaming import events as chat_evt
from uniffy.domains.chat.streaming.publisher import publish_channel_event_to_members

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


APPROVAL_TTL_SECONDS = 24 * 60 * 60


class AgentChatBridge:
    """Facade between chat messages and the agent runtime."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def respond_to_chat_message(
        self,
        channel_id: UUID,
        trigger_message_id: UUID,
        agent_id: UUID,
        trigger_rule: str | None = None,
    ) -> None:
        """Invoke the agent in response to a user chat message.

        Drives `RuntimeOperations.stream_send_message` with a
        `ChatDestination`, fans translated events into the chat
        stream, and relies on the runtime's writer for persistence.
        """
        trigger = await self._session.get(ChatMessage, trigger_message_id)
        if trigger is None or trigger.channel_id != channel_id:
            logger.warning("Agent invocation skipped: trigger message missing or channel mismatch")
            return
        if trigger.sender_type != SenderType.USER:
            # Loop guard D8: only user turns trigger agents.
            return

        channel = await self._session.get(ChatChannel, channel_id)
        if channel is None:
            logger.warning(f"Agent invocation skipped: channel {channel_id} not found")
            return

        agent = await self._session.get(Agent, agent_id)
        if agent is None or agent.organization_id != channel.organization_id:
            logger.warning("Agent invocation skipped: agent missing or wrong org")
            return

        member_ids = await self._load_user_member_ids(channel_id)
        user_id = trigger.sender_id

        await publish_channel_event_to_members(
            member_ids,
            chat_evt.AGENT_TYPING,
            chat_evt.build_agent_typing_payload(
                agent_id=agent_id,
                display_name=agent.name or "",
                started=True,
                root_id=trigger.root_id,
            ),
            channel_id=channel_id,
        )

        try:
            runtime_ops = RuntimeOperations(self._session)
            # Thread continuation: if the trigger is itself a thread reply,
            # the agent's response lands under the same root. If the trigger
            # is a top-level message but the user is starting a thread
            # *against* it (root), we leave thread_root_id=None and the
            # response stays at channel root -- `reply_to_id` alone is enough
            # to render the quote preview.
            thread_root_id = trigger.root_id
            destination = ChatDestination(
                channel_id=channel_id,
                agent_id=agent_id,
                trigger_message_id=trigger_message_id,
                thread_root_id=thread_root_id,
                trigger_rule=trigger_rule,
            )
            # Track placeholder rows announced during this run so RuntimeDoneEvent
            # can publish MESSAGE_UPDATED (settling the in-flight bubble) instead
            # of MESSAGE_CREATED (which dedupes and would not refresh metadata).
            announced_placeholders: set[UUID] = set()
            async for event in runtime_ops.stream_send_message(
                destination=destination,
                user_id=user_id,
                organization_id=channel.organization_id,
                content=trigger.content,
            ):
                await self._publish_runtime_event(
                    event=event,
                    channel_id=channel_id,
                    agent_id=agent_id,
                    member_ids=member_ids,
                    actor_user_id=user_id,
                    announced_placeholders=announced_placeholders,
                    trigger_message_id=trigger_message_id,
                    thread_root_id=thread_root_id,
                )
        except Exception as exc:
            logger.exception("Agent chat invocation failed")
            # Surface the failure as a chat message so the user is not left
            # staring at a silent typing indicator. Best-effort: a publish
            # failure here must not mask the original exception in logs.
            try:
                await self._write_agent_error_message(
                    channel_id=channel_id,
                    agent_id=agent_id,
                    trigger_message_id=trigger_message_id,
                    thread_root_id=trigger.root_id,
                    member_ids=member_ids,
                    error_text=str(exc),
                )
            except Exception:
                logger.exception("Failed to write agent error message to chat")
        finally:
            await publish_channel_event_to_members(
                member_ids,
                chat_evt.AGENT_TYPING,
                chat_evt.build_agent_typing_payload(
                    agent_id=agent_id,
                    display_name=agent.name or "",
                    started=False,
                    root_id=trigger.root_id,
                ),
                channel_id=channel_id,
            )

    async def _publish_runtime_event(
        self,
        *,
        event: RuntimeStreamEvent,
        channel_id: UUID,
        agent_id: UUID,
        member_ids: list[UUID],
        actor_user_id: UUID,
        announced_placeholders: set[UUID],
        trigger_message_id: UUID,
        thread_root_id: UUID | None,
    ) -> None:
        """Translate one runtime event into chat stream events.

        - `RuntimeTokenEvent` carrying a `message_id` becomes
          `AGENT_TOKEN_DELTA` so the frontend can patch the in-flight
          assistant bubble incrementally instead of waiting for the
          full message.
        - `RuntimeMessageStoredEvent` for an assistant placeholder
          fires `MESSAGE_CREATED` with empty content so the bubble is
          rendered before the first delta arrives.
        - `RuntimeDoneEvent` for a previously-announced placeholder
          fires `MESSAGE_UPDATED` (instead of MESSAGE_CREATED) so the
          settled metadata replaces the streaming flag.
        """
        if isinstance(event, RuntimeTokenEvent):
            if event.message_id is None or not event.text:
                return
            await publish_channel_event_to_members(
                member_ids,
                chat_evt.AGENT_TOKEN_DELTA,
                chat_evt.build_agent_token_delta_payload(
                    message_id=event.message_id,
                    agent_id=agent_id,
                    delta=event.text,
                    sequence=event.sequence,
                ),
                channel_id=channel_id,
            )
            return

        if isinstance(event, RuntimeMessageStoredEvent):
            envelope = event.message
            # Only assistant-role placeholder rows need fan-out: they
            # are the empty bubble the deltas patch. The trigger user
            # row is already in the channel.
            if envelope.role == "assistant" and envelope.id is not None:
                announced_placeholders.add(envelope.id)
                await self._publish_message_created(envelope.id, member_ids)
            return

        if isinstance(event, RuntimeToolCallEvent):
            if event.message_id is not None:
                await self._publish_message_created(event.message_id, member_ids)
            await publish_channel_event_to_members(
                member_ids,
                chat_evt.AGENT_TOOL_CALL,
                chat_evt.build_agent_tool_call_payload(
                    message_id=event.message_id or agent_id,
                    agent_id=agent_id,
                    tool_name=event.tool_name,
                    tool_call_id=event.tool_call_id,
                    status="STARTED",
                    preview=_truncate_json(event.tool_args),
                ),
                channel_id=channel_id,
            )
            return

        if isinstance(event, RuntimeToolResultEvent):
            if event.message_id is not None:
                await self._publish_message_created(event.message_id, member_ids)
            await publish_channel_event_to_members(
                member_ids,
                chat_evt.AGENT_TOOL_CALL,
                chat_evt.build_agent_tool_call_payload(
                    message_id=event.message_id or agent_id,
                    agent_id=agent_id,
                    tool_name=event.tool_name,
                    tool_call_id=event.tool_call_id,
                    status="COMPLETED" if event.success else "FAILED",
                    preview=_truncate(event.result),
                    error_message=None if event.success else event.result,
                ),
                channel_id=channel_id,
            )
            return

        if isinstance(event, RuntimeConfirmationRequiredEvent):
            if event.message_id is not None:
                await self._publish_message_created(event.message_id, member_ids)
            expires_at = datetime.now(UTC) + timedelta(seconds=APPROVAL_TTL_SECONDS)
            request_id = event.request_id or event.message_id or agent_id
            await publish_channel_event_to_members(
                member_ids,
                chat_evt.AGENT_CONFIRMATION_REQUESTED,
                chat_evt.build_agent_confirmation_requested_payload(
                    message_id=event.message_id or agent_id,
                    agent_id=agent_id,
                    request_id=request_id,
                    tool_name=event.tool_name,
                    args_preview=_truncate_json(event.tool_args),
                    actor_user_id=actor_user_id,
                    expires_at=expires_at,
                ),
                channel_id=channel_id,
            )
            return

        if isinstance(event, RuntimeDoneEvent):
            if event.assistant_message is not None:
                msg_id = event.assistant_message.id
                if msg_id in announced_placeholders:
                    # Fire a terminal AGENT_TOKEN_DELTA with final=true
                    # FIRST so the frontend reducer clears the streaming
                    # flag immediately. Relying solely on MESSAGE_UPDATED
                    # metadata to clear it is fragile -- proto wires the
                    # `metadata` map as `map<string,string>`, so any
                    # serialization quirk between Python `True` and the
                    # JS-side check leaves the bubble stuck on plain text
                    # forever. The reducer treats `final=true` as a
                    # decisive signal and deletes the streaming key.
                    await publish_channel_event_to_members(
                        member_ids,
                        chat_evt.AGENT_TOKEN_DELTA,
                        chat_evt.build_agent_token_delta_payload(
                            message_id=msg_id,
                            agent_id=agent_id,
                            delta="",
                            sequence=2_000_000_000,
                            final=True,
                        ),
                        channel_id=channel_id,
                    )
                    await self._publish_message_updated(msg_id, member_ids)
                else:
                    await self._publish_message_created(msg_id, member_ids)
            return

        if isinstance(event, RuntimeErrorEvent):
            logger.warning(
                f"Agent runtime error for agent={agent_id} channel={channel_id}: {event.error}"
            )
            try:
                await self._write_agent_error_message(
                    channel_id=channel_id,
                    agent_id=agent_id,
                    trigger_message_id=trigger_message_id,
                    thread_root_id=thread_root_id,
                    member_ids=member_ids,
                    error_text=event.error,
                )
            except Exception:
                logger.exception("Failed to write agent error message to chat")

    async def _write_agent_error_message(
        self,
        *,
        channel_id: UUID,
        agent_id: UUID,
        trigger_message_id: UUID,
        thread_root_id: UUID | None,
        member_ids: list[UUID],
        error_text: str,
    ) -> None:
        """Persist + fan a `metadata.kind="agent_error"` chat row.

        Replaces the previously silent failure path (a swallowed runtime
        exception with only AGENT_TYPING stop). The frontend renders the
        row as a styled error pill.

        Also clears any in-flight streaming placeholder the runtime
        reserved before crashing -- otherwise an empty assistant bubble
        lingers in the channel and re-loads of `load_context_messages`
        skip it via the `streaming=true` guard.
        """
        await self._clear_streaming_placeholders(channel_id, agent_id, trigger_message_id)

        text = (error_text or "Unknown error").strip()
        # Cap stored content for the chat row; the full text lands in
        # `metadata.raw_error` so the UI's expander still has it.
        display = text if len(text) <= 500 else text[:500] + "..."
        meta = {
            "kind": "agent_error",
            "agent_id": str(agent_id),
            "trigger_message_id": str(trigger_message_id),
            "raw_error": text[:4000],
        }
        row = ChatMessage(
            channel_id=channel_id,
            sender_id=agent_id,
            sender_type=SenderType.AGENT,
            content=display,
            reply_to_id=trigger_message_id,
            root_id=thread_root_id,
            message_metadata=meta,
        )
        self._session.add(row)
        await self._session.commit()
        await self._session.refresh(row)
        await self._publish_message_created(row.id, member_ids)

    async def _clear_streaming_placeholders(
        self,
        channel_id: UUID,
        agent_id: UUID,
        trigger_message_id: UUID,
    ) -> None:
        """Drop empty assistant placeholders left over by an aborted run.

        The runtime reserves a `kind=final, streaming=true` row on the
        first non-empty token. If the provider raises before the row is
        finalized (e.g. mid-stream 429), the empty bubble stays in the
        channel forever. Hard-delete is safe -- the row carries no
        content yet and was never visible to the user as text.
        """
        result = await self._session.execute(
            select(ChatMessage).where(
                ChatMessage.channel_id == channel_id,
                ChatMessage.sender_type == SenderType.AGENT,
                ChatMessage.sender_id == agent_id,
                ChatMessage.reply_to_id == trigger_message_id,
                ChatMessage.message_metadata["streaming"].astext == "true",
            )
        )
        for row in result.scalars().all():
            await self._session.delete(row)
        await self._session.flush()

    async def _publish_message_created(
        self,
        message_id: UUID,
        member_ids: list[UUID],
    ) -> None:
        """Fetch a persisted chat message and fan `MESSAGE_CREATED` out."""
        await self._publish_message_event(message_id, member_ids, chat_evt.MESSAGE_CREATED)

    async def _publish_message_updated(
        self,
        message_id: UUID,
        member_ids: list[UUID],
    ) -> None:
        """Fan `MESSAGE_UPDATED` for a row whose content/metadata changed.

        Used when the runtime finalizes a placeholder that subscribers
        already saw via `MESSAGE_CREATED` -- a second `MESSAGE_CREATED`
        would dedupe on the client and never refresh the streaming flag
        or canonical content.
        """
        await self._publish_message_event(message_id, member_ids, chat_evt.MESSAGE_UPDATED)

    async def _publish_message_event(
        self,
        message_id: UUID,
        member_ids: list[UUID],
        event_type: str,
    ) -> None:
        msg = await self._session.get(ChatMessage, message_id)
        if msg is None:
            return
        await publish_channel_event_to_members(
            member_ids,
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

    async def _load_user_member_ids(self, channel_id: UUID) -> list[UUID]:
        """Return the user-subject member ids for fan-out."""
        result = await self._session.execute(
            select(ChatChannelMember.subject_id).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.subject_type == SubjectType.USER,
            )
        )
        return [r[0] for r in result.all()]

    async def build_runtime_context_from_chat(self, channel_id: UUID, agent_id: UUID) -> None:
        """Standalone context builder (unused - runtime drives writer directly).

        Phase 2 folds context assembly into the runtime's writer
        abstraction (`ChatChannelMessageWriter.load_context_messages`)
        and the chat-destination setup branch of `stream_send_message`.
        Kept for plan-parity and potential ad-hoc context previews.
        """
        raise NotImplementedError(
            "build_runtime_context_from_chat unused; runtime invokes the "
            "writer directly when destination is ChatDestination"
        )

    async def publish_runtime_event_to_chat(
        self, event: object, channel_id: UUID, agent_id: UUID
    ) -> None:
        """Legacy translator entry-point. Translation lives in the orchestrator."""
        raise NotImplementedError(
            "publish_runtime_event_to_chat is internal; use respond_to_chat_message"
        )

    async def handle_confirmation_decision(
        self,
        request_id: UUID,
        channel_id: UUID,
        message_id: UUID,
        decision: str,
        decided_by: UUID,
        rationale: str | None = None,
    ) -> None:
        """Resolve a pending destructive-tool approval.

        Validates caller is the `actor_user_id` recorded on the pending
        request, flips the Valkey approval state (which wakes any
        waiting tool loop in this pod), writes an audit row, persists a
        `metadata.kind='confirmation_resolved'` chat message, and fans
        an `AGENT_CONFIRMATION_RESOLVED` stream event.
        """
        if decision not in ("approved", "denied"):
            raise ValidationError("decision", "must be 'approved' or 'denied'")

        store = get_approval_store()
        state = await store.get_state(channel_id, request_id)
        if state is None:
            raise NotFoundError("AgentApproval", str(request_id))

        existing_status = state.get("status")
        if existing_status in ("approved", "denied"):
            # Idempotent: already resolved. Do not re-publish.
            logger.info(
                f"Approval {request_id} already {existing_status}; "
                f"ignoring new {decision} from {decided_by}"
            )
            return

        actor_user_id_str = state.get("actor_user_id")
        if actor_user_id_str and str(decided_by) != actor_user_id_str:
            raise PermissionDeniedError("resolve", "agent confirmation")

        ok = await store.respond(
            channel_id,
            request_id,
            decision == "approved",
            decided_by=decided_by,
            rationale=rationale,
        )
        if not ok:
            logger.warning(f"Approval respond returned no-op for request={request_id}")

        agent_id_str = state.get("agent_id") or ""
        agent_id: UUID | None = None
        try:
            if agent_id_str:
                agent_id = UUID(agent_id_str)
        except ValueError:
            agent_id = None

        tool_name = state.get("tool_name") or ""
        requested_at_raw = state.get("requested_at")
        try:
            requested_at = (
                datetime.fromisoformat(requested_at_raw) if requested_at_raw else datetime.now(UTC)
            )
        except TypeError, ValueError:
            requested_at = datetime.now(UTC)

        decided_at = datetime.now(UTC)
        expires_at = requested_at + timedelta(seconds=APPROVAL_TTL_SECONDS)

        if agent_id is not None:
            try:
                audit_row = AgentApprovalAudit(
                    request_id=request_id,
                    channel_id=channel_id,
                    message_id=message_id,
                    agent_id=agent_id,
                    tool_name=tool_name,
                    args_json=state.get("args_json") or {},
                    status=decision,
                    decided_by=decided_by,
                    decided_at=decided_at,
                    requested_at=requested_at,
                    expires_at=expires_at,
                )
                self._session.add(audit_row)
                await self._session.commit()
            except Exception:
                await self._session.rollback()
                logger.warning(f"Failed to write approval audit for {request_id}")

        if agent_id is not None:
            try:
                resolved_msg = ChatMessage(
                    channel_id=channel_id,
                    sender_id=agent_id,
                    sender_type=SenderType.AGENT,
                    content="",
                    reply_to_id=message_id,
                    message_metadata={
                        "kind": "confirmation_resolved",
                        "agent_id": str(agent_id),
                        "request_id": str(request_id),
                        "tool_name": tool_name,
                        "decision": decision,
                        "decided_by": str(decided_by),
                    },
                )
                self._session.add(resolved_msg)
                await self._session.commit()
                await self._session.refresh(resolved_msg)
            except Exception:
                await self._session.rollback()
                logger.warning(f"Failed to persist confirmation_resolved message for {request_id}")

        member_ids = await self._load_user_member_ids(channel_id)
        await publish_channel_event_to_members(
            member_ids,
            chat_evt.AGENT_CONFIRMATION_RESOLVED,
            chat_evt.build_agent_confirmation_resolved_payload(
                message_id=message_id,
                request_id=request_id,
                decision=decision,
                decided_by_user_id=decided_by,
                decided_at=decided_at,
            ),
            channel_id=channel_id,
        )


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
    except TypeError, ValueError:
        return _truncate(str(payload), limit)
