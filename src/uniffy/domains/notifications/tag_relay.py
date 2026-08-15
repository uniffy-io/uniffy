"""Per-recipient projector for org-wide tag and restricted mention events."""

from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.auth.cache import get_or_load_effective_role
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.content.references import parse_urn
from uniffy.core.models.tags.tag import Tag
from uniffy.core.types import ContentRole, ContentType
from uniffy.core.valkey.tags import (
    EVENT_TAG_ASSIGNMENT_CHANGED,
    EVENT_TAG_CREATED,
    EVENT_TAG_DELETED,
    EVENT_TAG_UPDATED,
)
from uniffy.db import open_session
from uniffy.domains.tags.visibility import TagVisibilityFilter

logger = logger.bind(component="notifications.tag_relay")


class TagEventRelay:
    """Per-recipient filter / projector for tag events and restricted chip state."""

    def __init__(self, user_id: UUID, organization_id: UUID) -> None:
        self.user_id = user_id
        self.organization_id = organization_id
        self._tag_visibility_cache: dict[UUID, bool] = {}

    async def project(self, payload: dict[str, Any]) -> list[dict[str, str]]:
        """Return zero or more ``MENTION_STATE_CHANGED`` change-maps for this event."""
        event_type = payload.get("_type", "")
        body = payload.get("payload") or {}

        try:
            if event_type == EVENT_TAG_ASSIGNMENT_CHANGED:
                return await self._project_assignment_changed(body)
            if event_type == EVENT_TAG_CREATED:
                return await self._project_tag_lifecycle(body, urn_status=None)
            if event_type == EVENT_TAG_UPDATED:
                return await self._project_tag_lifecycle(body, urn_status=None)
            if event_type == EVENT_TAG_DELETED:
                return self._project_tag_deleted(body)
        except Exception:
            logger.warning("tag-event projection failed", component="notifications.tag_relay")
        return []

    async def _project_assignment_changed(self, body: dict[str, Any]) -> list[dict[str, str]]:
        content_urn = body.get("content_urn") or ""
        content_type_raw = body.get("content_type") or ""
        if not content_urn or not content_type_raw:
            return []
        try:
            content_type = ContentType(content_type_raw)
        except ValueError:
            return []
        content_id = _content_id_from_urn(content_urn)
        if content_id is None:
            return []

        if not await self._can_view_content(content_type, content_id):
            return []

        added = body.get("added") or []
        removed = body.get("removed") or []
        added_csv = ",".join(str(t) for t in added)
        removed_csv = ",".join(str(t) for t in removed)

        events: list[dict[str, str]] = []
        if added_csv or removed_csv:
            events.append({
                "urn": content_urn,
                "tag_assignments_added": added_csv,
                "tag_assignments_removed": removed_csv,
            })

        tag_counts: dict[str, Any] = body.get("tag_counts") or {}
        tag_urns: dict[str, Any] = body.get("tag_urns") or {}
        for tag_id_str, count in tag_counts.items():
            tag_urn = tag_urns.get(tag_id_str)
            if not tag_urn:
                continue
            events.append({
                "urn": str(tag_urn),
                "usage_count": str(count),
            })
        return events

    async def _project_tag_lifecycle(
        self, body: dict[str, Any], urn_status: str | None
    ) -> list[dict[str, str]]:
        tag = body.get("tag") or {}
        urn = tag.get("urn") or ""
        tag_id_raw = tag.get("id") or ""
        if not urn or not tag_id_raw:
            return []
        try:
            tag_id = UUID(tag_id_raw)
        except ValueError:
            return []

        if not await self._tag_visible(tag_id):
            return []

        changes = _normalize_tag_state(tag)
        if urn_status is not None:
            changes["urn_status"] = urn_status
        return [changes]

    async def allows_mention_state(self, payload: dict[str, Any]) -> bool:
        """Recipient gate for ``restricted`` mention-state events; fails closed."""
        parsed = parse_urn(payload.get("urn") or "")
        if parsed is None:
            return False
        content_type, content_id = parsed
        try:
            return await self._can_view_content(content_type, content_id)
        except Exception:
            logger.opt(exception=True).warning("mention-state recipient gate failed; dropping event")
            return False

    def _project_tag_deleted(self, body: dict[str, Any]) -> list[dict[str, str]]:
        tag_id_raw = body.get("tag_id") or ""
        try:
            tag_id = UUID(tag_id_raw)
        except TypeError, ValueError:
            return []
        urn = f"urn:uniffy:content:TAG:{tag_id}"
        self._tag_visibility_cache.pop(tag_id, None)
        return [{"urn": urn, "urn_status": "DELETED"}]

    async def _can_view_content(self, content_type: ContentType, content_id: UUID) -> bool:
        if content_type == ContentType.CHAT:
            return await self._can_view_channel(content_id)

        async def _load() -> ContentRole | None:
            async with open_session() as session:
                checker = PermissionChecker(session)
                policy = await _load_minimal_policy(
                    session, content_type, self.organization_id, content_id
                )
                if policy is None:
                    return None
                owner_id, access_mode, baseline_role = policy
                return await checker.effective_role(
                    user_id=self.user_id,
                    organization_id=self.organization_id,
                    content_type=content_type,
                    content_id=content_id,
                    owner_id=owner_id,
                    access_mode=access_mode,
                    baseline_role=baseline_role,
                )

        role = await get_or_load_effective_role(
            self.organization_id,
            self.user_id,
            content_type,
            content_id,
            _load,
        )
        return role is not None

    async def _can_view_channel(self, channel_id: UUID) -> bool:
        # Chat channels use membership rather than access-mode columns.
        from uniffy.core.models.chat.channel import ChannelType, ChatChannel
        from uniffy.core.models.chat.channel_member import ChatChannelMember

        async with open_session() as session:
            checker = PermissionChecker(session)
            if await checker.is_org_admin(self.user_id, self.organization_id):
                return True
            if await checker.is_domain_admin(self.user_id, self.organization_id, ContentType.CHAT):
                return True
            channel = (
                await session.execute(
                    select(ChatChannel.channel_type).where(
                        ChatChannel.id == channel_id,
                        ChatChannel.organization_id == self.organization_id,
                        ChatChannel.is_deleted == False,  # noqa: E712
                    )
                )
            ).scalar_one_or_none()
            if channel is None:
                return False
            if channel == ChannelType.PUBLIC:
                return True
            membership = (
                await session.execute(
                    select(ChatChannelMember.id).where(
                        ChatChannelMember.channel_id == channel_id,
                        ChatChannelMember.user_id == self.user_id,
                    )
                )
            ).scalar_one_or_none()
            return membership is not None

    async def _tag_visible(self, tag_id: UUID) -> bool:
        if tag_id in self._tag_visibility_cache:
            return self._tag_visibility_cache[tag_id]
        async with open_session() as session:
            tag_row = (
                await session.execute(
                    select(Tag).where(
                        Tag.id == tag_id,
                        Tag.organization_id == self.organization_id,
                    )
                )
            ).scalar_one_or_none()
            if tag_row is None:
                self._tag_visibility_cache[tag_id] = False
                return False
            visibility = TagVisibilityFilter(session, self.user_id, self.organization_id)
            visible = await visibility.is_visible(tag_row)
        self._tag_visibility_cache[tag_id] = visible
        return visible


def _normalize_tag_state(state: dict[str, Any]) -> dict[str, str]:
    """Coerce a tag-state record into ``MentionStateChangedPayload.changes`` shape."""
    out: dict[str, str] = {}
    for key, value in state.items():
        if value is None:
            continue
        out[str(key)] = "" if value is False else str(value)
    return out


def _content_id_from_urn(content_urn: str) -> UUID | None:
    parts = content_urn.rsplit(":", 1)
    if len(parts) != 2:
        return None
    try:
        return UUID(parts[1])
    except ValueError:
        return None


async def _load_minimal_policy(
    session,
    content_type: ContentType,
    organization_id: UUID,
    content_id: UUID,
) -> tuple | None:
    # Chat channels are NOT routed here - they lack access-mode columns and use
    # membership instead (see ``TagEventRelay._can_view_channel``).
    if content_type == ContentType.NOTE:
        from uniffy.core.models.notes.note import Note

        result = await session.execute(
            select(Note.owner_id, Note.access_mode, Note.baseline_role).where(
                Note.id == content_id,
                Note.organization_id == organization_id,
            )
        )
    elif content_type == ContentType.FILE:
        from uniffy.core.models.files.file import File

        result = await session.execute(
            select(File.owner_id, File.access_mode, File.baseline_role).where(
                File.id == content_id,
                File.organization_id == organization_id,
            )
        )
    elif content_type == ContentType.CALENDAR_EVENT:
        from uniffy.core.models.calendar.event import CalendarEvent

        result = await session.execute(
            select(
                CalendarEvent.owner_id,
                CalendarEvent.access_mode,
                CalendarEvent.baseline_role,
            ).where(
                CalendarEvent.id == content_id,
                CalendarEvent.organization_id == organization_id,
            )
        )
    elif content_type == ContentType.PROJECT:
        from uniffy.core.models.projects.project import Project

        result = await session.execute(
            select(Project.owner_id, Project.access_mode, Project.baseline_role).where(
                Project.id == content_id,
                Project.organization_id == organization_id,
            )
        )
    elif content_type == ContentType.TASK:
        from uniffy.core.models.projects.project import Project
        from uniffy.core.models.projects.task import Task

        task = (
            await session.execute(
                select(Task.project_id).where(
                    Task.id == content_id,
                    Task.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if task is None:
            return None
        result = await session.execute(
            select(Project.owner_id, Project.access_mode, Project.baseline_role).where(
                Project.id == task,
                Project.organization_id == organization_id,
            )
        )
    elif content_type == ContentType.AGENT:
        from uniffy.core.models.agents.agent import Agent

        result = await session.execute(
            select(Agent.owner_id, Agent.access_mode, Agent.baseline_role).where(
                Agent.id == content_id,
                Agent.organization_id == organization_id,
            )
        )
    elif content_type == ContentType.FOLDER:
        from uniffy.core.models.files.folder import Folder

        result = await session.execute(
            select(Folder.owner_id, Folder.access_mode, Folder.baseline_role).where(
                Folder.id == content_id,
                Folder.organization_id == organization_id,
            )
        )
    elif content_type == ContentType.ROOM:
        from uniffy.core.models.rooms.room import Room

        result = await session.execute(
            select(Room.owner_id, Room.access_mode, Room.baseline_role).where(
                Room.id == content_id,
                Room.organization_id == organization_id,
            )
        )
    else:
        return None

    row = result.first()
    if row is None:
        return None
    return (row[0], row[1], row[2])
