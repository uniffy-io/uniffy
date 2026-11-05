"""Turn delivered notifications into collaborator signals for the two people involved."""

import asyncio
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import parse_urn
from uniffy.core.events.types import NotificationEvent
from uniffy.core.models.projects.task import Task
from uniffy.core.types import ContentType, NotificationType
from uniffy.domains.directory.collaborators.signals import (
    CollaboratorSignal,
    Interaction,
    stage_interactions,
)
from uniffy.domains.permissions.access import ResourceAudienceResolver, ResourceKey
from uniffy.infrastructure.valkey.ops import get_ops_client, ops_call

logger = logger.bind(component="directory.collaborators.recorder")

_NAMESPACE = "people"
# A message fan-out this wide is an announcement, not working with someone.
MAX_RECIPIENTS = 25
MAX_CO_ASSIGNEES = 10
# Per pair and signal, so chat bursts and add-remove cycles cannot inflate a ranking.
THROTTLE_SECONDS = 600

_SIGNALS: dict[NotificationType, CollaboratorSignal] = {
    NotificationType.CHAT_DM: CollaboratorSignal.DIRECT_MESSAGE,
    NotificationType.CHAT_MENTION: CollaboratorSignal.MENTION,
    NotificationType.CONTENT_MENTIONED: CollaboratorSignal.MENTION,
    NotificationType.COMMENT_MENTIONED: CollaboratorSignal.MENTION,
    NotificationType.CHAT_THREAD_REPLY: CollaboratorSignal.REPLY,
    NotificationType.COMMENT_REPLY: CollaboratorSignal.REPLY,
    NotificationType.TASK_ASSIGNED: CollaboratorSignal.ASSIGNMENT,
    NotificationType.PERMISSION_GRANTED: CollaboratorSignal.SHARE,
    NotificationType.CALENDAR_INVITE: CollaboratorSignal.INVITE,
    NotificationType.CHAT_CHANNEL_INVITE: CollaboratorSignal.INVITE,
}

# Fan-outs that reach people through a team, a group or a broadcast, not one by one.
_EXPANDED_METADATA_KEYS = ("broadcast", "team_id", "group_ids")


def _skip(event: NotificationEvent, recipient_ids: list[UUID]) -> bool:
    if event.acting_agent_id is not None:
        return True
    if not recipient_ids or len(recipient_ids) > MAX_RECIPIENTS:
        return True
    metadata = event.metadata or {}
    if any(key in metadata for key in _EXPANDED_METADATA_KEYS):
        return True
    # A grant to a group notifies every member; only a share to one person is a pick.
    return event.notification_type == NotificationType.PERMISSION_GRANTED and len(recipient_ids) > 1


async def _first_in_window(
    organization_id: UUID, signal: CollaboratorSignal, actor_id: UUID, peer_id: UUID
) -> bool:
    """Within the throttle window only the first signal of a kind between two people counts."""
    client = get_ops_client()
    if client is None:
        return True
    low, high = sorted((actor_id, peer_id))
    key = f"people:signal:{signal.value}:{organization_id}:{low}:{high}"
    try:
        async with ops_call(_NAMESPACE, "signal_throttle"):
            return bool(await client.set(key, "1", ex=THROTTLE_SECONDS, nx=True))
    except Exception:
        return True


async def _co_assignees(
    session: AsyncSession,
    event: NotificationEvent,
    actor_id: UUID,
    new_assignees: list[UUID],
) -> list[Interaction]:
    target = parse_urn(event.source_urn) if event.source_urn else None
    if target is None or target[0] != ContentType.TASK:
        return []
    assignee_values = await session.scalar(
        select(Task.assignee_ids).where(
            Task.id == target[1],
            Task.organization_id == event.organization_id,
            Task.is_deleted.is_(False),
        )
    )
    others: set[UUID] = set()
    for value in assignee_values or []:
        try:
            others.add(UUID(str(value)))
        except ValueError:
            continue
    others -= {actor_id, *new_assignees}
    if not others or len(others) > MAX_CO_ASSIGNEES:
        return []
    # Only colleagues who can open the task learn anything from sharing it.
    viewers = await ResourceAudienceResolver(session).filter_resource(
        organization_id=event.organization_id,
        key=ResourceKey(ContentType.TASK, target[1]),
        candidate_user_ids=list(others),
    )
    pairs: list[Interaction] = []
    for assignee in new_assignees:
        for other in viewers:
            pairs.append((assignee, other, CollaboratorSignal.CO_ASSIGNMENT))
            pairs.append((other, assignee, CollaboratorSignal.CO_ASSIGNMENT))
    return pairs


async def record_notification_interactions(
    session: AsyncSession,
    event: NotificationEvent,
    recipient_ids: list[UUID],
) -> int:
    """Credit the actor and each recipient who could see the item with having worked together."""
    signal = _SIGNALS.get(event.notification_type)
    actor_id = event.actor_id
    if signal is None or actor_id is None or _skip(event, recipient_ids):
        return 0
    # The worker passes only active members who can open the source, so nothing private counts.
    candidates = [uid for uid in dict.fromkeys(recipient_ids) if uid != actor_id]
    fresh = await asyncio.gather(
        *(_first_in_window(event.organization_id, signal, actor_id, uid) for uid in candidates)
    )
    recipients = [uid for uid, first in zip(candidates, fresh, strict=True) if first]

    pairs: list[Interaction] = []
    for uid in recipients:
        pairs.append((actor_id, uid, signal))
        pairs.append((uid, actor_id, signal))
    if signal is CollaboratorSignal.ASSIGNMENT and recipients:
        pairs.extend(await _co_assignees(session, event, actor_id, recipients))
    if not pairs:
        return 0

    written = await stage_interactions(session, event.organization_id, pairs)
    await session.commit()
    return written
