"""What a finished, stopped or failed task run leaves on the task."""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.acting_agent import acting_agent
from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.events.bus import stage_notification_events
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.models.projects.field_definition import TaskStatusSemantic
from uniffy.core.models.projects.task import Task
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import ContentType, NotificationType
from uniffy.domains.comments.operations import AgentAuthor, CommentOperations
from uniffy.domains.projects.operations import TaskOperations
from uniffy.domains.projects.statuses import load_task_status_semantics

logger = logger.bind(component="agents.tasks.handback")

MAX_SUMMARY_CHARS = 4000
_EMPTY_SUMMARY = "Finished. Open the session for the details."


@dataclass(frozen=True)
class RunFacts:
    """Identity of one assignment run, read before anything can expire its rows."""

    assignment_id: UUID
    organization_id: UUID
    task_id: UUID
    agent_id: UUID
    agent_name: str
    assigned_by: UUID
    session_id: UUID | None
    task_key: str
    run_id: UUID | None = None
    started_at: datetime | None = None
    change_request: str | None = None


async def review_status_id(session: AsyncSession, project_id: UUID) -> str | None:
    semantics = await load_task_status_semantics(session, project_id)
    return semantics.ids.get(TaskStatusSemantic.REVIEW)


async def post_agent_comment(session: AsyncSession, facts: RunFacts, body: str) -> None:
    """Best effort: losing the assigner's comment rights must not fail the run's bookkeeping."""
    try:
        # Reply notifications go through the outbox; the egress fleet has no core queue.
        with stage_notification_events(session):
            await CommentOperations(session).create_comment(
                user_id=facts.assigned_by,
                organization_id=facts.organization_id,
                content_type=ContentType.TASK,
                content_id=facts.task_id,
                body=body,
                agent_author=AgentAuthor(agent_id=facts.agent_id, session_id=facts.session_id),
            )
        await session.commit()
    except Exception:
        await session.rollback()
        logger.opt(exception=True).warning(
            "Agent task comment not posted for assignment {}", facts.assignment_id
        )


async def notify_assigner(session: AsyncSession, facts: RunFacts, *, title: str, body: str) -> None:
    """Through the outbox: the egress fleet has no core queue, and the core sweep delivers it."""
    with stage_notification_events(session):
        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.TASK_AGENT_FINISHED,
                organization_id=facts.organization_id,
                # No actor: the recipient is the person the agent worked for, and actors are
                # never notified of their own events.
                actor_id=None,
                title=title,
                body=body,
                source_urn=f"urn:uniffy:content:TASK:{facts.task_id}",
                target_user_ids=[facts.assigned_by],
                content_type=ContentType.TASK,
                content_id=facts.task_id,
                metadata={"agent_id": str(facts.agent_id), "agent_name": facts.agent_name},
                acting_agent_id=facts.agent_id,
            )
        )
    await session.commit()


async def hand_back(
    session: AsyncSession,
    facts: RunFacts,
    *,
    final_message_id: UUID | None,
    storage: ObjectStorage,
    search_indexer: SearchIndexer,
    buffer: UpdateBuffer,
) -> None:
    """Move the task to review when the project has a review status, then post the summary."""
    task = await session.get(Task, facts.task_id)
    in_review = False
    if task is not None and not task.is_deleted and task.completed_at is None:
        review_id = await review_status_id(session, task.project_id)
        # The agent may have moved it to review itself; that still reads as ready for review.
        in_review = review_id is not None and task.status == review_id
        if review_id and not in_review:
            try:
                with acting_agent(facts.agent_id):
                    await TaskOperations(session, storage, search_indexer, buffer).update(
                        user_id=facts.assigned_by,
                        organization_id=facts.organization_id,
                        task_id=facts.task_id,
                        status=review_id,
                    )
                in_review = True
            except Exception:
                await session.rollback()
                logger.opt(exception=True).warning(
                    "Task {} not moved to review after its agent run", facts.task_id
                )

    summary = ""
    if final_message_id is not None:
        message = await session.get(AgentMessage, final_message_id)
        if message is not None and message.session_id == facts.session_id:
            summary = (message.content or "").strip()
    if len(summary) > MAX_SUMMARY_CHARS:
        summary = summary[:MAX_SUMMARY_CHARS] + " ..."
    await post_agent_comment(session, facts, summary or _EMPTY_SUMMARY)

    title = f"{facts.agent_name} finished {facts.task_key}"
    body = "Ready for your review." if in_review else "Its summary is on the task."
    await notify_assigner(session, facts, title=title, body=body)
