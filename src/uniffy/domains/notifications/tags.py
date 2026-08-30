"""Per-recipient projector for org-wide tag and mention-state events."""

from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.content.references import parse_urn
from uniffy.core.database import SessionFactory
from uniffy.core.types import ContentType
from uniffy.domains.permissions.access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
)
from uniffy.domains.tags.events import (
    EVENT_TAG_ASSIGNMENT_CHANGED,
    EVENT_TAG_CREATED,
    EVENT_TAG_DELETED,
    EVENT_TAG_UPDATED,
)

logger = logger.bind(component="notifications.tags")


class TagEventRelay:
    """Filter org-wide tag and mention-state events for one recipient."""

    def __init__(
        self,
        user_id: UUID,
        organization_id: UUID,
        session_factory: SessionFactory,
    ) -> None:
        self.user_id = user_id
        self.organization_id = organization_id
        self._session_factory = session_factory

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
            logger.warning("tag-event projection failed")
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
        """Fail-closed recipient gate for every org-wide mention-state event."""
        parsed = parse_urn(payload.get("urn") or "")
        if parsed is None:
            return False
        content_type, content_id = parsed
        try:
            changes = payload.get("changes") or {}
            if changes == {"urn_status": "DELETED"}:
                return await self._is_active_recipient()
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
        return [{"urn": urn, "urn_status": "DELETED"}]

    async def _can_view_content(self, content_type: ContentType, content_id: UUID) -> bool:
        key = ResourceKey(content_type, content_id)
        async with self._session_factory() as session:
            decisions = await ResourceAccessResolver(session).resolve(
                actor_id=self.user_id,
                organization_id=self.organization_id,
                keys=[key],
                purpose=ResourceAccessPurpose.REFERENCE,
            )
        return decisions[key].can_view

    async def _tag_visible(self, tag_id: UUID) -> bool:
        return await self._can_view_content(ContentType.TAG, tag_id)

    async def _is_active_recipient(self) -> bool:
        async with self._session_factory() as session:
            subject = await ResourceAccessResolver(session).subject(
                actor_id=self.user_id,
                organization_id=self.organization_id,
            )
        return subject.is_active_member


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
