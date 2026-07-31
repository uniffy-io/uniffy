"""Agent runtime RPC handlers - thin coordinators on top of the egress worker.

The handler owns the synchronous preflight cliff: auth, UUID parse, org +
session ownership checks, rate-limit, file permission load. Once those
pass it mints a ``run_id``, writes the run state hash, enqueues
:func:`uniffy.workers.tasks.agent_run.run_agent_session` to the egress
queue, and subscribes to ``agent:run:{run_id}`` via XREAD. Each entry
on the stream is decoded back into a domain event and re-encoded as a
proto envelope for the client. The handler never touches the LLM
itself - the worker drives that turn.
"""

import asyncio
import json
import os
import time
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.agents.v1.runtime_pb2 import (
    AgentStreamEvent,
    CancelStreamRequest,
    CancelStreamResponse,
    GetUsageStatsRequest,
    GetUsageStatsResponse,
    RegenerateImageRequest,
    RegenerateImageResponse,
    RerunFromMessageRequest,
    RerunFromMessageResponse,
    RespondToConfirmationRequest,
    RespondToConfirmationResponse,
    SendMessageRequest,
    SendMessageResponse,
    StreamSendMessageRequest,
    StreamSendMessageResponse,
    SubscribeToRunRequest,
    SubscribeToRunResponse,
)

from uniffy.core.errors import (
    BudgetExceededError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitExceededError,
    ValidationError,
)
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import generate_id
from uniffy.core.valkey.queue import get_queue
from uniffy.core.valkey.rate_limit import check_agent_message_limits
from uniffy.core.valkey.streams import (
    get_run_state,
    request_run_cancel,
    run_stream_key,
    set_run_state,
    stream_xread,
)
from uniffy.db import open_session
from uniffy.domains.agents.budgets.operations import BudgetsOperations
from uniffy.domains.agents.providers.base import EventType, StreamEvent
from uniffy.domains.agents.runtime.approvals import get_approval_store
from uniffy.domains.agents.runtime.converters import (
    runtime_stream_event_from_json,
    runtime_stream_event_to_proto,
    send_message_response_to_proto,
    usage_stats_to_proto,
)
from uniffy.domains.agents.runtime.file_loader import (
    FileContext,
    _file_contexts_to_payload,
    _load_files,
)
from uniffy.domains.agents.runtime.image_regenerate import regenerate_image
from uniffy.domains.agents.runtime.usage import UsageOperations
from uniffy.domains.agents.sessions.operations import SessionOperations
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.observability.metrics import (
    AGENT_RUN_ENQUEUE_FAILURES_TOTAL,
    AGENT_RUN_RECONNECT_TOTAL,
    AGENT_RUN_SUBSCRIBE_TIMEOUT_TOTAL,
)

logger = logger.bind(component="agents.runtime.handlers")

SUBSCRIBE_WALL_BUDGET_SECONDS = 120.0
# How long each XREAD round waits for new events before yielding control
# back to the loop. Each blocking round pins one streams-pool connection
# for that duration, so smaller values let a pod multiplex more
# concurrent subscribers at the cost of more empty round-trips.
SUBSCRIBE_BLOCK_MS = int(os.getenv("AGENT_RUN_SUBSCRIBE_BLOCK_MS", "1000"))
SUBSCRIBE_BATCH_COUNT = 100
SUBSCRIBE_TIMEOUT_MESSAGE = "subscribe_timeout"


async def _enqueue_run(
    *,
    run_id: UUID,
    user_id: UUID,
    organization_id: UUID,
    session_id: UUID,
    content: str,
    files_payload: list[dict[str, Any]] | None,
    user_timezone: str | None,
    rerun_message_id: UUID | None = None,
    invoked_skill_id: UUID | None = None,
) -> None:
    """Enqueue ``run_agent_session`` on the egress fleet."""
    queue = get_queue("egress")
    await queue.enqueue_job(
        "run_agent_session",
        str(run_id),
        str(user_id),
        str(organization_id),
        str(session_id),
        content,
        files_payload,
        user_timezone,
        str(rerun_message_id) if rerun_message_id else None,
        str(invoked_skill_id) if invoked_skill_id else None,
    )


def _header_event(run_id: UUID) -> AgentStreamEvent:
    """First event on a new stream: carries ``run_id``, no oneof payload."""
    return AgentStreamEvent(run_id=str(run_id))


def _stamp_run_id(event: AgentStreamEvent, run_id: UUID) -> AgentStreamEvent:
    """Stamp ``run_id`` onto an AgentStreamEvent and return it."""
    event.run_id = str(run_id)
    return event


def _synthetic_error_event(run_id: UUID, error_text: str) -> AgentStreamEvent:
    """Build an AgentStreamEvent error envelope for terminal cases."""
    return _stamp_run_id(
        runtime_stream_event_to_proto(
            StreamEvent(type=EventType.ERROR, error=error_text)
        ),
        run_id,
    )


async def _subscribe_runtime_events(
    run_id: UUID,
) -> AsyncIterator[StreamEvent]:
    """Drain the per-run Valkey stream as decoded domain events.

    Stops on the first terminal DONE / ERROR event. Honours a 120s wall
    budget across all blocking rounds; on overrun yields a synthetic
    error event and exits. Runtime errors raised by ``stream_xread``
    collapse rounds to empty so the wall budget remains the final stop
    condition.
    """
    stream_key = run_stream_key(run_id)
    last_id = "0"
    deadline = time.monotonic() + SUBSCRIBE_WALL_BUDGET_SECONDS

    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            AGENT_RUN_SUBSCRIBE_TIMEOUT_TOTAL.inc()
            yield StreamEvent(type=EventType.ERROR, error=SUBSCRIBE_TIMEOUT_MESSAGE)
            return

        block_ms = min(SUBSCRIBE_BLOCK_MS, max(50, int(remaining * 1000)))
        entries = await stream_xread(
            stream_key,
            last_id=last_id,
            count=SUBSCRIBE_BATCH_COUNT,
            block_ms=block_ms,
        )
        if not entries:
            continue

        for message_id, payload in entries:
            last_id = message_id
            event_blob = payload.get("event")
            if not isinstance(event_blob, dict):
                logger.warning(
                    f"Stream entry without event payload (run={run_id}, id={message_id})"
                )
                continue
            try:
                event = runtime_stream_event_from_json(event_blob)
            except (ValueError, KeyError) as exc:
                logger.warning(
                    f"Stream payload decode failed (run={run_id}, id={message_id}): {exc}"
                )
                continue
            yield event
            if event.type in (EventType.DONE, EventType.ERROR):
                return


class RuntimeHandlers:
    """RPC handlers for runtime service."""

    async def send_message(
        self,
        request: SendMessageRequest,
        ctx: RequestContext,
    ) -> SendMessageResponse:
        """Handle ``SendMessage`` (unary).

        Runs the same enqueue + subscribe shape as the streaming handler
        but drains the events into a buffer and returns the final
        :class:`SendMessageResponse` derived from the DONE event. A
        terminal ERROR event becomes ``ConnectError(INTERNAL)``; the
        120s wall budget surfaces as ``ConnectError(DEADLINE_EXCEEDED)``.
        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        if not request.content or not request.content.strip():
            raise ConnectError(Code.INVALID_ARGUMENT, "Message content cannot be empty")

        try:
            run_id, files_payload = await self._preflight_and_enqueue(
                user_id=user_id,
                organization_id=org_id,
                session_id=session_id,
                request=request,
            )
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except RateLimitExceededError as e:
            raise ConnectError(Code.RESOURCE_EXHAUSTED, str(e))
        except BudgetExceededError as e:
            raise ConnectError(Code.RESOURCE_EXHAUSTED, str(e))
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"send_message preflight failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

        del files_payload  # already enqueued; not needed for the subscribe loop

        try:
            user_message = None
            assistant_message = None
            model_used = ""

            async for event in _subscribe_runtime_events(run_id):
                if event.type is EventType.MESSAGE_STORED:
                    if user_message is None and event.message.role == "user":
                        user_message = event.message
                    continue

                if event.type is EventType.DONE:
                    assistant_message = event.assistant_message
                    model_used = event.model
                    break

                if event.type is EventType.ERROR:
                    if event.error == SUBSCRIBE_TIMEOUT_MESSAGE:
                        raise ConnectError(
                            Code.DEADLINE_EXCEEDED,
                            SUBSCRIBE_TIMEOUT_MESSAGE,
                        )
                    raise ConnectError(Code.INTERNAL, event.error or "Agent run failed")

            if user_message is None or assistant_message is None:
                raise ConnectError(
                    Code.INTERNAL,
                    "Agent run ended before producing a final response",
                )

            return send_message_response_to_proto(
                user_message=user_message,
                assistant_message=assistant_message,
                model_used=model_used,
            )
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"Error in send_message subscribe loop: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def stream_send_message(
        self,
        request: StreamSendMessageRequest,
        ctx: RequestContext,
    ) -> AsyncIterator[StreamSendMessageResponse]:
        """Handle ``StreamSendMessage`` (server-streaming).

        Runs the synchronous preflight, enqueues the egress job, yields a
        ``run_id`` header event, then relays each stream entry to the
        client. The wall budget belongs to ``_subscribe_runtime_events``;
        cancellation by the client is logged and exits cleanly.
        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        if not request.content or not request.content.strip():
            raise ConnectError(Code.INVALID_ARGUMENT, "Message content cannot be empty")

        try:
            run_id, _ = await self._preflight_and_enqueue(
                user_id=user_id,
                organization_id=org_id,
                session_id=session_id,
                request=request,
            )
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except RateLimitExceededError as e:
            raise ConnectError(Code.RESOURCE_EXHAUSTED, str(e))
        except BudgetExceededError as e:
            raise ConnectError(Code.RESOURCE_EXHAUSTED, str(e))
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"stream_send_message preflight failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

        yield StreamSendMessageResponse(event=_header_event(run_id))

        try:
            async for event in _subscribe_runtime_events(run_id):
                yield StreamSendMessageResponse(
                    event=_stamp_run_id(runtime_stream_event_to_proto(event), run_id),
                )
        except (asyncio.CancelledError, GeneratorExit):
            logger.info(f"stream_send_message cancelled by client (run={run_id})")
            raise
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(
                f"Error in stream_send_message subscribe loop (run={run_id}): {exc}"
            )
            yield StreamSendMessageResponse(
                event=_synthetic_error_event(run_id, "Internal server error"),
            )

    async def rerun_from_message(
        self,
        request: RerunFromMessageRequest,
        ctx: RequestContext,
    ) -> AsyncIterator[RerunFromMessageResponse]:
        """Stream a fresh assistant response anchored on an edited message.

        Validates the anchor (user role, not invalidated, owned by caller),
        enqueues a run job, then relays per-run events. Mirrors the shape
        of ``stream_send_message`` so the frontend can reuse its handler.
        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            message_id = UUID(request.message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                org_ops = OrganizationOperations(session)
                await org_ops.require_org_member(user_id, org_id)
                session_ops = SessionOperations(session)
                msg, agent_session = await session_ops.load_message(
                    user_id=user_id,
                    organization_id=org_id,
                    message_id=message_id,
                )
                if msg.role != "user":
                    raise ConnectError(
                        Code.INVALID_ARGUMENT,
                        "rerun is only supported on user messages",
                    )
                if msg.is_invalidated:
                    raise ConnectError(
                        Code.INVALID_ARGUMENT,
                        "cannot rerun an invalidated message",
                    )
                await check_agent_message_limits(
                    session,
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_session.agent_id,
                )
                await BudgetsOperations(session).check_preflight(
                    user_id=user_id,
                    organization_id=org_id,
                )
                session_id = agent_session.id

            run_id = generate_id()
            await set_run_state(
                run_id=run_id,
                user_id=user_id,
                organization_id=org_id,
                session_id=session_id,
                status="queued",
                last_seq=0,
            )

            await _enqueue_run(
                run_id=run_id,
                user_id=user_id,
                organization_id=org_id,
                session_id=session_id,
                content="",
                files_payload=None,
                user_timezone=request.user_timezone or None,
                rerun_message_id=message_id,
            )
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except RateLimitExceededError as e:
            raise ConnectError(Code.RESOURCE_EXHAUSTED, str(e))
        except BudgetExceededError as e:
            raise ConnectError(Code.RESOURCE_EXHAUSTED, str(e))
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"rerun_from_message preflight failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

        yield RerunFromMessageResponse(event=_header_event(run_id))

        try:
            async for event in _subscribe_runtime_events(run_id):
                yield RerunFromMessageResponse(
                    event=_stamp_run_id(runtime_stream_event_to_proto(event), run_id),
                )
        except (asyncio.CancelledError, GeneratorExit):
            logger.info(f"rerun_from_message cancelled by client (run={run_id})")
            raise
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(
                f"Error in rerun_from_message subscribe loop (run={run_id}): {exc}"
            )
            yield RerunFromMessageResponse(
                event=_synthetic_error_event(run_id, "Internal server error"),
            )

    async def subscribe_to_run(
        self,
        request: SubscribeToRunRequest,
        ctx: RequestContext,
    ) -> AsyncIterator[SubscribeToRunResponse]:
        """Resume an in-flight run by ``run_id``.

        Replays the per-run Valkey stream from its head, then tails live
        until the run completes or the 120s wall budget elapses. Auth +
        ownership are checked against the run state hash; an expired
        state hash maps to NOT_FOUND, a foreign caller maps to
        PERMISSION_DENIED.
        """
        AGENT_RUN_RECONNECT_TOTAL.inc()
        user_id = get_user_id_from_context(ctx)

        try:
            run_id = UUID(request.run_id)
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        state = await get_run_state(run_id)
        if state is None:
            raise ConnectError(Code.NOT_FOUND, "run not found or expired")

        if state.get("user_id") != str(user_id):
            raise ConnectError(Code.PERMISSION_DENIED, "not your run")
        if state.get("organization_id") != str(org_id):
            raise ConnectError(Code.PERMISSION_DENIED, "not your run")

        yield SubscribeToRunResponse(event=_header_event(run_id))

        try:
            async for event in _subscribe_runtime_events(run_id):
                yield SubscribeToRunResponse(
                    event=_stamp_run_id(runtime_stream_event_to_proto(event), run_id),
                )
        except (asyncio.CancelledError, GeneratorExit):
            logger.info(f"subscribe_to_run cancelled by client (run={run_id})")
            raise
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(
                f"Error in subscribe_to_run loop (run={run_id}): {exc}"
            )
            yield SubscribeToRunResponse(
                event=_synthetic_error_event(run_id, "Internal server error"),
            )

    async def cancel_stream(
        self,
        request: CancelStreamRequest,
        ctx: RequestContext,
    ) -> CancelStreamResponse:
        """Flip the cancel flag on an in-flight run.

        Auth: caller must match the ``user_id`` + ``organization_id``
        recorded in the run-state hash. Idempotent -- cancelling an
        already-finished or expired run reports ``cancelled=false``
        without raising.
        """
        user_id = get_user_id_from_context(ctx)
        try:
            run_id = UUID(request.run_id)
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        state = await get_run_state(run_id)
        if state is None:
            return CancelStreamResponse(cancelled=False)
        if state.get("user_id") != str(user_id):
            raise ConnectError(Code.PERMISSION_DENIED, "not your run")
        if state.get("organization_id") != str(org_id):
            raise ConnectError(Code.PERMISSION_DENIED, "not your run")

        flagged = await request_run_cancel(run_id)
        return CancelStreamResponse(cancelled=flagged)

    async def _preflight_and_enqueue(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        request: SendMessageRequest | StreamSendMessageRequest,
    ) -> tuple[UUID, list[dict[str, Any]] | None]:
        """Run synchronous preflight checks and enqueue ``run_agent_session``.

        Returns the freshly minted ``run_id`` and the JSON-safe files
        payload that was attached to the egress job (returned only so
        callers can log it; the worker already has its copy).
        """
        async with open_session() as session:
            org_ops = OrganizationOperations(session)
            await org_ops.require_org_member(user_id, organization_id)

            session_ops = SessionOperations(session)
            agent_session = await session_ops.get_session(
                user_id=user_id,
                organization_id=organization_id,
                session_id=session_id,
            )

            await check_agent_message_limits(
                session,
                user_id=user_id,
                organization_id=organization_id,
                agent_id=agent_session.agent_id,
            )

            await BudgetsOperations(session).check_preflight(
                user_id=user_id,
                organization_id=organization_id,
            )

            files: list[FileContext] | None = None
            if request.file_ids:
                files = await _load_files(
                    session,
                    user_id,
                    organization_id,
                    list(request.file_ids),
                )

        files_payload = _file_contexts_to_payload(files)
        run_id = generate_id()

        invoked_skill_id: UUID | None = None
        if request.invoked_skill_id:
            try:
                invoked_skill_id = UUID(request.invoked_skill_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid invoked_skill_id format")

        await set_run_state(
            run_id=run_id,
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
            status="queued",
            last_seq=0,
        )

        try:
            await _enqueue_run(
                run_id=run_id,
                user_id=user_id,
                organization_id=organization_id,
                session_id=session_id,
                content=request.content.strip(),
                files_payload=files_payload,
                user_timezone=request.user_timezone or None,
                invoked_skill_id=invoked_skill_id,
            )
        except Exception as exc:
            AGENT_RUN_ENQUEUE_FAILURES_TOTAL.inc()
            logger.exception(
                f"Failed to enqueue run_agent_session (run={run_id}): {exc}"
            )
            raise ConnectError(Code.UNAVAILABLE, "Agent runtime queue unavailable")

        return run_id, files_payload

    async def respond_to_confirmation(
        self,
        request: RespondToConfirmationRequest,
        ctx: RequestContext,
    ) -> RespondToConfirmationResponse:
        """Resolve a pending destructive-tool approval.

        Only the user who triggered the run (recorded on the approval as
        ``actor_user_id``) may approve or deny. Anyone else - including
        org admins - gets PERMISSION_DENIED. The approval row must exist
        in the durable Valkey store; if it is absent or unreadable we
        refuse rather than fall through to the in-process event, since
        the local event carries no identity.
        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
            session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        if not request.tool_call_id:
            raise ConnectError(Code.INVALID_ARGUMENT, "tool_call_id is required")

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(
                    user_id, organization_id
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))

        store = get_approval_store()
        state = await store.get_state(session_id, request.tool_call_id)
        if state is None:
            raise ConnectError(Code.NOT_FOUND, "approval not found or expired")

        actor = state.get("actor_user_id")
        if actor != str(user_id):
            raise ConnectError(
                Code.PERMISSION_DENIED, "only the run's initiator can respond"
            )

        accepted = await store.respond(
            session_id,
            request.tool_call_id,
            request.approved,
            decided_by=user_id,
        )

        return RespondToConfirmationResponse(accepted=accepted)

    async def get_usage_stats(
        self,
        request: GetUsageStatsRequest,
        ctx: RequestContext,
    ) -> GetUsageStatsResponse:
        """Aggregated usage statistics for an organization."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        days = request.days if request.days > 0 else 30
        interval = request.interval if request.interval else "1d"

        try:
            async with open_session() as session:
                org_ops = OrganizationOperations(session)
                membership = await org_ops.require_org_member(user_id, org_id)

                # Org-wide usage follows the org role only. A platform operator
                # holding a plain member seat gets their own rows like anyone
                # else; cross-tenant reach requires a SupportSession.
                is_org_admin = membership.role in (
                    OrganizationRole.ADMIN,
                    OrganizationRole.OWNER,
                )

                scoped_user_id = None if is_org_admin else user_id

                ops = UsageOperations(session)
                stats = await ops.get_usage_stats(
                    organization_id=org_id,
                    days=days,
                    interval=interval,
                    user_id=scoped_user_id,
                )
                return usage_stats_to_proto(stats)

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error in get_usage_stats: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def regenerate_image(
        self,
        request: RegenerateImageRequest,
        ctx: RequestContext,
    ) -> RegenerateImageResponse:
        """Re-run a generated image with adjusted parameters."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            message_id = UUID(request.message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid id format")

        patch: dict = {}
        if request.params_patch.strip():
            try:
                patch = json.loads(request.params_patch)
            except json.JSONDecodeError as exc:
                raise ConnectError(
                    Code.INVALID_ARGUMENT, "params_patch is not valid JSON"
                ) from exc
            if not isinstance(patch, dict):
                raise ConnectError(
                    Code.INVALID_ARGUMENT, "params_patch must be a JSON object"
                )

        try:
            new_id, metadata = await regenerate_image(
                user_id=user_id,
                organization_id=org_id,
                channel_id=channel_id,
                message_id=message_id,
                params_patch=patch,
            )
            return RegenerateImageResponse(
                message_id=str(new_id),
                result_metadata=json.dumps(metadata),
            )
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except (ValidationError, BudgetExceededError) as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except RateLimitExceededError as e:
            raise ConnectError(Code.RESOURCE_EXHAUSTED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error in regenerate_image: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
