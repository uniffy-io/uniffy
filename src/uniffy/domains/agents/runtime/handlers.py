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
import time
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.agents.v1.runtime_pb2 import (
    ConfirmationResponse,
    ConfirmationResponseAck,
    GetUsageStatsRequest,
    GetUsageStatsResponse,
    SendMessageRequest,
    SendMessageResponse,
    StreamSendMessageEvent,
    SubscribeToRunRequest,
)

from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    RateLimitExceededError,
    ValidationError,
)
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.core.valkey.queue import get_queue
from uniffy.core.valkey.rate_limit import check_agent_rate_limits
from uniffy.core.valkey.streams import (
    get_run_state,
    run_stream_key,
    set_run_state,
    stream_xread,
)
from uniffy.db import open_session
from uniffy.domains.agents.runtime.approvals import get_approval_store
from uniffy.domains.agents.runtime.converters import (
    runtime_stream_event_from_json,
    runtime_stream_event_to_proto,
    send_message_response_to_proto,
    usage_stats_to_proto,
)
from uniffy.domains.agents.runtime.operations import FileContext
from uniffy.domains.agents.runtime.stream_events import (
    RuntimeDoneEvent,
    RuntimeErrorEvent,
    RuntimeMessageStoredEvent,
    RuntimeStreamEvent,
)
from uniffy.domains.agents.runtime.usage import UsageOperations
from uniffy.domains.agents.sessions.operations import SessionOperations
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.files.operations import FileOperations
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.observability.metrics import (
    AGENT_RUN_ENQUEUE_FAILURES_TOTAL,
    AGENT_RUN_RECONNECT_TOTAL,
    AGENT_RUN_SUBSCRIBE_TIMEOUT_TOTAL,
)

SUBSCRIBE_WALL_BUDGET_SECONDS = 120.0
SUBSCRIBE_BLOCK_MS = 5000
SUBSCRIBE_BATCH_COUNT = 100
SUBSCRIBE_TIMEOUT_MESSAGE = "subscribe_timeout"


async def _load_files(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    file_ids: list[str],
) -> list[FileContext]:
    """Load files from the database with full permission checks.

    Each id is resolved through :class:`FileOperations.get_by_id`, which
    runs the canonical view check. The returned :class:`FileContext`
    list is what the worker rebuilds from the JSON payload.
    """
    ops = FileOperations(session)
    files: list[FileContext] = []
    for fid in file_ids:
        file = await ops.get_by_id(user_id, organization_id, UUID(fid))
        files.append(
            FileContext(
                file_id=str(file.id),
                media_type=file.mime_type or "",
                filename=file.filename,
                storage_key=file.storage_key,
                extracted_text=(
                    file.media_info.extracted_text
                    if file.media_info and file.media_info.extracted_text
                    else None
                ),
                extraction_status=(
                    file.extraction_status.value
                    if hasattr(file.extraction_status, "value")
                    else str(file.extraction_status)
                ),
            )
        )
    return files


def _file_contexts_to_payload(
    files: list[FileContext] | None,
) -> list[dict[str, Any]] | None:
    """Serialise a :class:`FileContext` list into the worker's JSON shape."""
    if not files:
        return None
    return [
        {
            "file_id": f.file_id,
            "media_type": f.media_type,
            "filename": f.filename,
            "storage_key": f.storage_key,
            "extracted_text": f.extracted_text,
            "extraction_status": f.extraction_status,
        }
        for f in files
    ]


async def _enqueue_run(
    *,
    run_id: UUID,
    user_id: UUID,
    organization_id: UUID,
    session_id: UUID,
    content: str,
    files_payload: list[dict[str, Any]] | None,
    user_timezone: str | None,
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
    )


def _build_run_id_event(run_id: UUID) -> StreamSendMessageEvent:
    """First proto event yielded - carries ``run_id`` and no oneof payload."""
    event = StreamSendMessageEvent()
    event.run_id = str(run_id)
    return event


def _stamp_run_id(
    proto_event: StreamSendMessageEvent,
    run_id: UUID,
) -> StreamSendMessageEvent:
    """Stamp ``run_id`` on a proto envelope and return it."""
    proto_event.run_id = str(run_id)
    return proto_event


def _build_synthetic_error_event(
    run_id: UUID,
    error_text: str,
) -> StreamSendMessageEvent:
    """Build a proto error envelope with ``run_id`` for terminal cases."""
    return _stamp_run_id(
        runtime_stream_event_to_proto(RuntimeErrorEvent(error=error_text)),
        run_id,
    )


async def _subscribe_runtime_events(
    run_id: UUID,
) -> AsyncIterator[RuntimeStreamEvent]:
    """Drain the per-run Valkey stream as decoded domain events.

    Stops on the first :class:`RuntimeDoneEvent` /
    :class:`RuntimeErrorEvent`. Honours a 120s wall budget across all
    blocking rounds; on overrun yields a synthetic error event and
    exits. Runtime errors raised by ``stream_xread`` collapse rounds to
    empty so the wall budget remains the final stop condition.
    """
    stream_key = run_stream_key(run_id)
    last_id = "0"
    deadline = time.monotonic() + SUBSCRIBE_WALL_BUDGET_SECONDS

    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            AGENT_RUN_SUBSCRIBE_TIMEOUT_TOTAL.inc()
            yield RuntimeErrorEvent(error=SUBSCRIBE_TIMEOUT_MESSAGE)
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
            if isinstance(event, (RuntimeDoneEvent, RuntimeErrorEvent)):
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
        :class:`SendMessageResponse` derived from the
        :class:`RuntimeDoneEvent`. A terminal :class:`RuntimeErrorEvent`
        becomes ``ConnectError(INTERNAL)``; the 120s wall budget surfaces
        as ``ConnectError(DEADLINE_EXCEEDED)``.
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
        except ConnectError:
            raise
        except Exception as exc:
            logger.error(f"send_message preflight failed: {exc}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

        del files_payload  # already enqueued; not needed for the subscribe loop

        try:
            user_message = None
            assistant_message = None
            model_used = ""

            async for event in _subscribe_runtime_events(run_id):
                if isinstance(event, RuntimeMessageStoredEvent):
                    if user_message is None and event.message.role == "user":
                        user_message = event.message
                    continue

                if isinstance(event, RuntimeDoneEvent):
                    assistant_message = event.assistant_message
                    model_used = event.model_used
                    break

                if isinstance(event, RuntimeErrorEvent):
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
            logger.error(f"Error in send_message subscribe loop: {exc}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def stream_send_message(
        self,
        request: SendMessageRequest,
        ctx: RequestContext,
    ) -> AsyncIterator[StreamSendMessageEvent]:
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
        except ConnectError:
            raise
        except Exception as exc:
            logger.error(f"stream_send_message preflight failed: {exc}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

        yield _build_run_id_event(run_id)

        try:
            async for event in _subscribe_runtime_events(run_id):
                yield _stamp_run_id(runtime_stream_event_to_proto(event), run_id)
        except (asyncio.CancelledError, GeneratorExit):
            logger.info(f"stream_send_message cancelled by client (run={run_id})")
            raise
        except ConnectError:
            raise
        except Exception as exc:
            logger.error(
                f"Error in stream_send_message subscribe loop (run={run_id}): {exc}",
                exc_info=True,
            )
            yield _build_synthetic_error_event(run_id, "Internal server error")

    async def subscribe_to_run(
        self,
        request: SubscribeToRunRequest,
        ctx: RequestContext,
    ) -> AsyncIterator[StreamSendMessageEvent]:
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

        yield _build_run_id_event(run_id)

        try:
            async for event in _subscribe_runtime_events(run_id):
                yield _stamp_run_id(runtime_stream_event_to_proto(event), run_id)
        except (asyncio.CancelledError, GeneratorExit):
            logger.info(f"subscribe_to_run cancelled by client (run={run_id})")
            raise
        except ConnectError:
            raise
        except Exception as exc:
            logger.error(
                f"Error in subscribe_to_run loop (run={run_id}): {exc}",
                exc_info=True,
            )
            yield _build_synthetic_error_event(run_id, "Internal server error")

    async def _preflight_and_enqueue(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        request: SendMessageRequest,
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
            await session_ops.get_session(
                user_id=user_id,
                organization_id=organization_id,
                session_id=session_id,
            )

            await check_agent_rate_limits(
                user_id=str(user_id),
                organization_id=str(organization_id),
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
            )
        except Exception as exc:
            AGENT_RUN_ENQUEUE_FAILURES_TOTAL.inc()
            logger.error(
                f"Failed to enqueue run_agent_session (run={run_id}): {exc}",
                exc_info=True,
            )
            raise ConnectError(Code.UNAVAILABLE, "Agent runtime queue unavailable")

        return run_id, files_payload

    async def respond_to_confirmation(
        self,
        request: ConfirmationResponse,
        ctx: RequestContext,
    ) -> ConfirmationResponseAck:
        """Resolve a pending destructive-tool approval."""
        get_user_id_from_context(ctx)

        try:
            session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid session_id format")

        if not request.tool_call_id:
            raise ConnectError(Code.INVALID_ARGUMENT, "tool_call_id is required")

        store = get_approval_store()
        accepted = await store.respond(session_id, request.tool_call_id, request.approved)

        return ConfirmationResponseAck(accepted=accepted)

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

                user_result = await session.execute(
                    select(User.is_system_admin).where(User.id == user_id)
                )
                is_sys_admin = user_result.scalar_one_or_none() or False

                is_org_admin = membership.role in (
                    OrganizationRole.ADMIN,
                    OrganizationRole.OWNER,
                )

                scoped_user_id = None if (is_org_admin or is_sys_admin) else user_id

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
            logger.error(f"Error in get_usage_stats: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
