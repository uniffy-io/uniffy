"""AgentChatBridge: runtime-to-chat orchestrator.

The bridge is the seam between chat message events and the agent
runtime. It owns:

1. Orchestration: load the trigger message + channel + agent, invoke
   ``RuntimeOperations.stream_send_message`` with a ``ChatDestination``,
   and forward each runtime event to a ``ChatStreamPublisher`` that
   handles the chat-side translation + DB side-effects.
2. The confirmation-decision resume.

The writer inside the runtime persists chat messages; the bridge is
only responsible for the fan-out side (driving the publisher + the
``MESSAGE_CREATED`` companion for new chat rows).
"""

from __future__ import annotations

import asyncio
import contextlib
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
from uniffy.core.types import ContentType, SubjectType, generate_id
from uniffy.core.valkey.streams import (
    clear_chat_active_run,
    is_cancel_requested,
    set_chat_active_run,
    set_run_state,
    touch_run_state,
)
from uniffy.domains.agents.runtime.approvals import get_approval_store
from uniffy.domains.agents.runtime.destinations import ChatDestination
from uniffy.domains.agents.runtime.file_loader import FileContext, _safe_load_files
from uniffy.domains.agents.runtime.operations import RuntimeOperations
from uniffy.domains.agents.runtime.publishers import ChatStreamPublisher
from uniffy.domains.chat.streaming import events as chat_evt
from uniffy.domains.chat.streaming.publisher import publish_channel_event_to_members
from uniffy.domains.files.attachments.operations import AttachmentOperations

logger = logger.bind(component="agents.chat_integration.operations")

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


APPROVAL_TTL_SECONDS = 24 * 60 * 60

# The client expires an agent-typing entry after a short TTL. A turn that runs
# silently (image generation, a long tool, slow reasoning) would otherwise let
# the working indicator vanish mid-run, so re-assert typing on this interval.
TYPING_HEARTBEAT_SECONDS = 8

# How often the egress task polls the run-state cancel flag so a user "stop"
# interrupts an in-flight tool (e.g. image generation) within ~this window.
CANCEL_POLL_SECONDS = 1.5


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

        Drives ``RuntimeOperations.stream_send_message`` with a
        ``ChatDestination`` and forwards each event to a fresh
        :class:`ChatStreamPublisher` bound to the trigger's channel +
        member set.
        """
        trigger = await self._session.get(ChatMessage, trigger_message_id)
        if trigger is None or trigger.channel_id != channel_id:
            logger.warning("Agent invocation skipped: trigger message missing or channel mismatch")
            return
        if trigger.sender_type != SenderType.USER:
            return

        channel = await self._session.get(ChatChannel, channel_id)
        if channel is None:
            logger.warning(f"Agent invocation skipped: channel {channel_id} not found")
            return
        organization_id = channel.organization_id

        agent = await self._session.get(Agent, agent_id)
        if agent is None or agent.organization_id != organization_id:
            logger.warning("Agent invocation skipped: agent missing or wrong org")
            return

        member_ids = await self._load_user_member_ids(channel_id)
        user_id = trigger.sender_id
        thread_root_id = trigger.root_id
        # Snapshot ORM-backed values now. A mid-run cancel rolls the session back,
        # which expires every attribute; the cleanup path can't drive an async
        # lazy-load (it raises MissingGreenlet), so the cleanup must read locals only.
        agent_name = agent.name or ""

        files = await self._load_trigger_attachments(
            user_id=user_id,
            organization_id=organization_id,
            trigger_message_id=trigger_message_id,
        )

        publisher = ChatStreamPublisher(
            session=self._session,
            channel_id=channel_id,
            agent_id=agent_id,
            member_ids=member_ids,
            actor_user_id=user_id,
            trigger_message_id=trigger_message_id,
            thread_root_id=thread_root_id,
        )

        async def _emit_agent_typing(*, started: bool) -> None:
            await publish_channel_event_to_members(
                member_ids,
                chat_evt.AGENT_TYPING,
                chat_evt.build_agent_typing_payload(
                    agent_id=agent_id,
                    display_name=agent_name,
                    started=started,
                    root_id=thread_root_id,
                ),
                channel_id=channel_id,
            )

        run_id = generate_id()
        await set_run_state(
            run_id=run_id,
            user_id=user_id,
            organization_id=organization_id,
            session_id=channel_id,
            status="running",
        )
        await set_chat_active_run(channel_id, agent_id, run_id)

        async def _typing_heartbeat() -> None:
            while True:
                await asyncio.sleep(TYPING_HEARTBEAT_SECONDS)
                await _emit_agent_typing(started=True)
                # Keep run-state + active-run alive for long turns. touch_run_state
                # only bumps the TTL, so a pending cancel flag is never clobbered.
                await touch_run_state(run_id)
                await set_chat_active_run(channel_id, agent_id, run_id)

        async def _drive_stream() -> None:
            runtime_ops = RuntimeOperations(self._session)
            destination = ChatDestination(
                channel_id=channel_id,
                agent_id=agent_id,
                trigger_message_id=trigger_message_id,
                thread_root_id=thread_root_id,
                trigger_rule=trigger_rule,
            )
            async for event in runtime_ops.stream_send_message(
                destination=destination,
                user_id=user_id,
                organization_id=organization_id,
                content=trigger.content,
                files=files,
            ):
                await publisher.publish(event)

        async def _cancel_watcher(task: asyncio.Task[None]) -> None:
            while not task.done():
                await asyncio.sleep(CANCEL_POLL_SECONDS)
                if await is_cancel_requested(run_id):
                    task.cancel()
                    return

        await _emit_agent_typing(started=True)
        heartbeat = asyncio.create_task(_typing_heartbeat())
        stream_task = asyncio.create_task(_drive_stream())
        watcher = asyncio.create_task(_cancel_watcher(stream_task))

        cancelled = False
        try:
            await stream_task
        except asyncio.CancelledError:
            # Watcher cancelled the run on a user "stop" (interrupting the
            # in-flight tool / generation mid-await).
            cancelled = True
        except Exception as exc:
            logger.exception("Agent chat invocation failed")
            try:
                await publisher.write_agent_error_message(str(exc))
            except Exception:
                logger.exception("Failed to write agent error message to chat")
        finally:
            heartbeat.cancel()
            watcher.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat
            with contextlib.suppress(asyncio.CancelledError):
                await watcher
            # A stop clicked just as the stream finishes never raises
            # CancelledError - the watcher's poll loses the race - but the cancel
            # flag is still set. Honor it so the marker reflects the user's intent.
            stop_requested = cancelled
            if not stop_requested:
                with contextlib.suppress(Exception):
                    stop_requested = await is_cancel_requested(run_id)

            if cancelled:
                # The run task was interrupted mid-await; reset the session
                # before the cleanup writes and drop any empty placeholder so
                # no blank bubble is left behind (partial text is kept).
                with contextlib.suppress(Exception):
                    await self._session.rollback()
                    await publisher.discard_empty_placeholders()
                    await self._session.commit()

            if stop_requested:
                try:
                    await publisher.mark_run_stopped()
                except Exception:
                    logger.exception("Failed to mark trigger message as stopped")

            await publisher.close()
            with contextlib.suppress(Exception):
                await set_run_state(
                    run_id=run_id,
                    user_id=user_id,
                    organization_id=organization_id,
                    session_id=channel_id,
                    status="cancelled" if stop_requested else "completed",
                )
            with contextlib.suppress(Exception):
                await clear_chat_active_run(channel_id, agent_id)
            await _emit_agent_typing(started=False)

    async def _load_user_member_ids(self, channel_id: UUID) -> list[UUID]:
        """Return the user-subject member ids for fan-out."""
        result = await self._session.execute(
            select(ChatChannelMember.subject_id).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.subject_type == SubjectType.USER,
            )
        )
        return [r[0] for r in result.all()]

    async def _load_trigger_attachments(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        trigger_message_id: UUID,
    ) -> list[FileContext] | None:
        """Resolve the trigger chat message's attachments into FileContexts.

        Runs as the message sender so the canonical view check fires per
        file. Per-file permission errors are swallowed (the readable
        files still flow through) so a single revoked attachment cannot
        block the agent from responding to the rest of the message.
        Returns ``None`` when the trigger has no attachments.
        """
        try:
            attachment_ops = AttachmentOperations(self._session)
            tuples = await attachment_ops.list_attachments(
                user_id=user_id,
                organization_id=organization_id,
                content_type=ContentType.CHAT_MESSAGE,
                content_id=trigger_message_id,
            )
        except Exception:
            logger.exception(
                "Failed to list attachments for chat-triggered agent invocation",
            )
            return None

        file_ids = [str(att.file_id) for att, _file, _owner in tuples]
        if not file_ids:
            return None

        files = await _safe_load_files(
            self._session,
            user_id,
            organization_id,
            file_ids,
        )
        return files or None

    async def handle_confirmation_decision(
        self,
        request_id: UUID,
        channel_id: UUID,
        message_id: UUID,
        decision: str,
        decided_by: UUID,
        rationale: str | None = None,
    ) -> None:
        """Resolve a pending destructive-tool approval."""
        if decision not in ("approved", "denied"):
            raise ValidationError("decision", "must be 'approved' or 'denied'")

        store = get_approval_store()
        state = await store.get_state(channel_id, request_id)
        if state is None:
            raise NotFoundError("AgentApproval", str(request_id))

        existing_status = state.get("status")
        if existing_status in ("approved", "denied"):
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
        except (TypeError, ValueError):
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
