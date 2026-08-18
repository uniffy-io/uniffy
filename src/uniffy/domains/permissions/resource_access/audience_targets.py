from __future__ import annotations

from collections.abc import Collection
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import select

from uniffy.core.models.agents.cron_task import AgentCronTask
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.files.attachment import Attachment
from uniffy.core.models.projects.task import Task
from uniffy.core.types import ContentType
from uniffy.domains.permissions.resource_access.registry import DIRECT_CONTENT_TYPES
from uniffy.domains.permissions.resource_access.standard import load_direct_policy_rows
from uniffy.domains.permissions.resource_access.types import ResourceKey

if TYPE_CHECKING:
    from uniffy.domains.permissions.resource_access.audience import ResourceAudienceResolver

AUDIENCE_CONTENT_TYPES = DIRECT_CONTENT_TYPES | frozenset({
    ContentType.TASK,
    ContentType.CALENDAR_EVENT,
    ContentType.CHAT,
    ContentType.AGENT_CHAT,
    ContentType.CHAT_MESSAGE,
    ContentType.AGENT_CRON_TASK,
})


async def filter_resource_audience(
    resolver: ResourceAudienceResolver,
    *,
    organization_id: UUID,
    key: ResourceKey,
    candidate_user_ids: Collection[UUID],
) -> list[UUID]:
    candidates = tuple(dict.fromkeys(candidate_user_ids))
    return await _filter_resource_audience(
        resolver,
        organization_id=organization_id,
        key=key,
        candidate_user_ids=candidates,
        visited=frozenset(),
    )


async def _filter_resource_audience(
    resolver: ResourceAudienceResolver,
    *,
    organization_id: UUID,
    key: ResourceKey,
    candidate_user_ids: tuple[UUID, ...],
    visited: frozenset[ResourceKey],
) -> list[UUID]:
    if not candidate_user_ids or key in visited:
        return []
    visited = visited | {key}

    if key.content_type in DIRECT_CONTENT_TYPES:
        row = (
            await load_direct_policy_rows(
                resolver.session,
                organization_id,
                {key.content_type: [key.content_id]},
            )
        ).get(key)
        if row is None or row.is_deleted:
            return []
        allowed = set(
            await resolver.filter_standard(
                organization_id=organization_id,
                content_type=key.content_type,
                content_id=key.content_id,
                owner_id=row.owner_id,
                access_mode=row.access_mode,
                baseline_role=row.baseline_role,
                candidate_user_ids=candidate_user_ids,
            )
        )
        if key.content_type == ContentType.FILE:
            parents = (
                await resolver.session.execute(
                    select(Attachment.content_type, Attachment.content_id).where(
                        Attachment.organization_id == organization_id,
                        Attachment.file_id == key.content_id,
                    )
                )
            ).all()
            for parent_type, parent_id in parents:
                parent_allowed = await _filter_resource_audience(
                    resolver,
                    organization_id=organization_id,
                    key=ResourceKey(parent_type, parent_id),
                    candidate_user_ids=candidate_user_ids,
                    visited=visited,
                )
                allowed.update(parent_allowed)
        return [user_id for user_id in candidate_user_ids if user_id in allowed]

    if key.content_type == ContentType.TASK:
        task = (
            await resolver.session.execute(
                select(Task.project_id, Task.is_deleted).where(
                    Task.id == key.content_id,
                    Task.organization_id == organization_id,
                )
            )
        ).one_or_none()
        if task is None or task.is_deleted:
            return []
        return await _filter_resource_audience(
            resolver,
            organization_id=organization_id,
            key=ResourceKey(ContentType.PROJECT, task.project_id),
            candidate_user_ids=candidate_user_ids,
            visited=visited,
        )

    if key.content_type == ContentType.CALENDAR_EVENT:
        event = (
            await resolver.session.execute(
                select(CalendarEvent).where(
                    CalendarEvent.id == key.content_id,
                    CalendarEvent.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if event is None or event.is_deleted:
            return []
        master = event
        if event.recurrence_id is not None:
            master = (
                await resolver.session.execute(
                    select(CalendarEvent).where(
                        CalendarEvent.id == event.recurrence_id,
                        CalendarEvent.organization_id == organization_id,
                    )
                )
            ).scalar_one_or_none()
        if master is None or master.is_deleted:
            return []
        allowed = set(
            await resolver.filter_standard(
                organization_id=organization_id,
                content_type=ContentType.CALENDAR_EVENT,
                content_id=master.id,
                owner_id=master.organizer_id,
                access_mode=master.access_mode,
                baseline_role=master.baseline_role,
                candidate_user_ids=candidate_user_ids,
            )
        )
        active = set(await resolver.active_roles(organization_id, candidate_user_ids))
        attendees = set(
            (
                await resolver.session.execute(
                    select(EventAttendee.user_id).where(
                        EventAttendee.event_id == master.id,
                        EventAttendee.user_id.in_(active),
                    )
                )
            ).scalars()
        )
        blocked = await resolver.blocked_users(
            organization_id,
            ContentType.CALENDAR_EVENT,
            master.id,
            attendees,
        )
        allowed.update(attendees - blocked)
        return [user_id for user_id in candidate_user_ids if user_id in allowed]

    if key.content_type in (
        ContentType.CHAT,
        ContentType.AGENT_CHAT,
        ContentType.CHAT_MESSAGE,
    ):
        channel_id = key.content_id
        if key.content_type == ContentType.CHAT_MESSAGE:
            message = (
                await resolver.session.execute(
                    select(ChatMessage.channel_id, ChatMessage.is_deleted).where(
                        ChatMessage.id == key.content_id,
                    )
                )
            ).one_or_none()
            if message is None or message.is_deleted:
                return []
            channel_id = message.channel_id
        channel = (
            await resolver.session.execute(
                select(ChatChannel).where(
                    ChatChannel.id == channel_id,
                    ChatChannel.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if channel is None or channel.is_deleted:
            return []
        if key.content_type == ContentType.CHAT and channel.is_agent_dm:
            return []
        if key.content_type == ContentType.AGENT_CHAT and not channel.is_agent_dm:
            return []
        return await resolver.filter_chat(
            organization_id=organization_id,
            channel=channel,
            candidate_user_ids=candidate_user_ids,
        )

    if key.content_type == ContentType.AGENT_CRON_TASK:
        task = (
            await resolver.session.execute(
                select(AgentCronTask).where(
                    AgentCronTask.id == key.content_id,
                    AgentCronTask.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if task is None or task.is_deleted:
            return []
        return await resolver.filter_standard(
            organization_id=organization_id,
            content_type=ContentType.AGENT_CRON_TASK,
            content_id=task.id,
            owner_id=task.owner_id,
            access_mode=task.access_mode,
            baseline_role=task.baseline_role,
            candidate_user_ids=candidate_user_ids,
        )

    return []
