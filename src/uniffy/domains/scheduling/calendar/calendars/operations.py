"""Creating, editing, hiding, and deleting calendars."""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import func, not_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.content.mentions import publish_mention_state
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.member_settings import CalendarMemberSettings
from uniffy.core.search import SearchIndexer
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import AccessMode, CalendarType, ContentRole, ContentType, SubjectType
from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.domains.scheduling.calendar.calendars.access import require_calendar_edit
from uniffy.domains.scheduling.calendar.calendars.reader import CalendarListing, CalendarReader
from uniffy.domains.scheduling.calendar.calendars.relocation import stage_ical_uid_release
from uniffy.domains.scheduling.calendar.calendars.search import (
    enqueue_calendar_search_acl_refresh,
    record_calendar_search_acl_refresh,
)
from uniffy.domains.scheduling.calendar.events.operations import CalendarEventOperations
from uniffy.domains.scheduling.calendar.policy import (
    TEAM_CALENDAR_TYPES,
    require_can_create_team_calendar,
    require_can_open_calendar_to_org,
)

logger = logger.bind(component="scheduling.calendar.calendars.operations")

NAME_LIMIT = 200
COLOR_LIMIT = 50
DESCRIPTION_LIMIT = 2000
# Deleting a calendar's events runs the ordinary per-series delete, mail and
# all, on the request; past this the caller moves them instead.
MAX_DELETED_SERIES = 200


@dataclass(frozen=True)
class CalendarDeletion:
    events_moved: int
    events_deleted: int


class CalendarOperations(CalendarReader):
    def __init__(self, session: AsyncSession, search_indexer: SearchIndexer) -> None:
        super().__init__(session, _search_indexer=search_indexer)

    async def create_calendar(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        color: str,
        description: str = "",
        calendar_type: CalendarType = CalendarType.PERSONAL,
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
        admin_user_ids: list[UUID] | None = None,
        admin_group_ids: list[UUID] | None = None,
    ) -> Calendar:
        name = _validated_name(name)
        admin_user_ids = [uid for uid in admin_user_ids or [] if uid != user_id]
        admin_group_ids = list(admin_group_ids or [])
        # Co-admins need a mode that admits members; asking for them is that choice.
        if access_mode is None and (admin_user_ids or admin_group_ids):
            access_mode = AccessMode.EXPLICIT_MEMBERS
        access_mode, baseline_role = await self._resolve_access_policy(
            organization_id, access_mode, baseline_role
        )
        if calendar_type in TEAM_CALENDAR_TYPES:
            await require_can_create_team_calendar(self.session, user_id, organization_id)
        if access_mode == AccessMode.OPEN_TO_ORG:
            await require_can_open_calendar_to_org(self.session, user_id, organization_id)

        calendar = Calendar(
            organization_id=organization_id,
            owner_id=user_id,
            name=name,
            description=_validated_description(description),
            color=_validated_color(color),
            calendar_type=calendar_type,
            is_default=False,
            access_mode=access_mode,
            baseline_role=baseline_role,
        )
        self.session.add(calendar)
        members_ops = ContentMembersOperations(self.session, self.search_indexer)
        staged_members = []
        try:
            await self.session.flush()
            await write_audit_event(
                self.session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.CALENDAR_CREATED,
                resource_type=AuditResourceType.CALENDAR,
                resource_id=calendar.id,
                details={"name": calendar.name, "calendar_type": calendar_type.value},
            )
            subjects = [(SubjectType.USER, uid) for uid in admin_user_ids] + [
                (SubjectType.GROUP, gid) for gid in admin_group_ids
            ]
            for subject_type, subject_id in subjects:
                staged_members.append(
                    await members_ops.stage_member(
                        actor_user_id=user_id,
                        organization_id=organization_id,
                        content_type=self.content_type,
                        content_id=calendar.id,
                        subject_type=subject_type,
                        subject_id=subject_id,
                        role=ContentRole.ADMIN,
                    )
                )
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(calendar)

        for staged in staged_members:
            try:
                await members_ops.finish_member_add_after_commit(staged)
            except Exception:
                logger.opt(exception=True).warning(
                    f"Failed to publish initial calendar access for {calendar.id}"
                )
        if access_mode == AccessMode.OPEN_TO_ORG:
            await self._broadcast_open_to_org_create(organization_id, calendar.id, access_mode)
        try:
            await self._index_for_search(calendar, skip_member_lookup=not staged_members)
        except Exception:
            logger.opt(exception=True).warning(f"Failed to index calendar {calendar.id}")
        return calendar

    async def update_calendar(
        self,
        user_id: UUID,
        organization_id: UUID,
        calendar_id: UUID,
        name: str | None = None,
        description: str | None = None,
        color: str | None = None,
    ) -> Calendar:
        # Access-policy changes go through permissions.v1.MembersService, not this method.
        calendar = await self.get_for_edit(user_id, organization_id, calendar_id)
        changed: list[str] = []
        if name is not None and _validated_name(name) != calendar.name:
            calendar.name = _validated_name(name)
            changed.append("name")
        if description is not None and _validated_description(description) != calendar.description:
            calendar.description = _validated_description(description)
            changed.append("description")
        if color is not None and _validated_color(color) != calendar.color:
            calendar.color = _validated_color(color)
            changed.append("color")
        if not changed:
            return calendar

        calendar.updated_at = datetime.now(UTC)
        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.CALENDAR_UPDATED,
            resource_type=AuditResourceType.CALENDAR,
            resource_id=calendar_id,
            details={"changed_keys": changed},
        )
        await self.session.commit()
        await self.session.refresh(calendar)

        try:
            await self._index_for_search(calendar)
        except Exception:
            logger.opt(exception=True).warning(f"Failed to index calendar {calendar_id}")
        try:
            await publish_mention_state(
                organization_id=organization_id,
                urn=build_content_urn(self.content_type, calendar.id),
                changes={
                    "title": calendar.name,
                    "description": calendar.description[:200],
                    "color": calendar.color,
                },
            )
        except Exception:
            logger.opt(exception=True).warning(
                f"Failed to publish calendar mention state for {calendar_id}"
            )
        return calendar

    async def set_visibility(
        self,
        user_id: UUID,
        organization_id: UUID,
        calendar_id: UUID,
        hidden: bool,
    ) -> CalendarListing:
        await self.get_by_id(user_id, organization_id, calendar_id)
        now = datetime.now(UTC)
        await self.session.execute(
            pg_insert(CalendarMemberSettings)
            .values(
                calendar_id=calendar_id,
                user_id=user_id,
                organization_id=organization_id,
                is_hidden=hidden,
                updated_at=now,
            )
            .on_conflict_do_update(
                index_elements=[CalendarMemberSettings.calendar_id, CalendarMemberSettings.user_id],
                set_={"is_hidden": hidden, "updated_at": now},
            )
        )
        await self.session.commit()
        return await self.get_listing(user_id, organization_id, calendar_id)

    async def delete_calendar(
        self,
        user_id: UUID,
        organization_id: UUID,
        calendar_id: UUID,
        *,
        target_calendar_id: UUID | None,
    ) -> CalendarDeletion:
        """Move every event to ``target_calendar_id``, or delete them all when it is None."""
        await self._hold_calendars(organization_id, calendar_id, target_calendar_id)
        calendar = await self.get_for_delete(user_id, organization_id, calendar_id)
        if calendar.is_default:
            raise ValidationError("calendar_id", "A default calendar cannot be deleted.")
        await self._require_no_blocked_series(user_id, organization_id, calendar_id)

        if target_calendar_id is not None:
            moved = await self._move_all_events(
                user_id, organization_id, calendar_id, target_calendar_id
            )
            deleted = 0
        else:
            moved = 0
            deleted = await self._delete_all_events(user_id, organization_id, calendar_id)
            # Each series delete commits and lets go of the calendar, so take it
            # back and make sure nothing was filed on it meanwhile.
            await self._hold_calendars(organization_id, calendar_id, None)
            calendar = await self.get_for_delete(user_id, organization_id, calendar_id)
            if await self._live_series_count(organization_id, calendar_id):
                raise ValidationError(
                    "calendar_id",
                    "Events were added to this calendar while it was being deleted. Try again.",
                )

        calendar.is_deleted = True
        calendar.deleted_at = datetime.now(UTC)
        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.CALENDAR_DELETED,
            resource_type=AuditResourceType.CALENDAR,
            resource_id=calendar_id,
            details={
                "name": calendar.name,
                "target_calendar_id": str(target_calendar_id) if target_calendar_id else None,
                "events_moved": moved,
                "events_deleted": deleted,
            },
        )
        await self.session.commit()
        if target_calendar_id is not None:
            await enqueue_calendar_search_acl_refresh(target_calendar_id)

        urn = build_content_urn(self.content_type, calendar_id)
        try:
            await self.search_indexer.remove(urn, organization_id)
        except Exception:
            logger.opt(exception=True).warning(
                f"Failed to remove calendar {calendar_id} from search"
            )
        try:
            await publish_mention_state(
                organization_id=organization_id,
                urn=urn,
                changes={"urn_status": "DELETED"},
            )
        except Exception:
            logger.opt(exception=True).warning(f"Failed to publish calendar tombstone {calendar_id}")
        return CalendarDeletion(events_moved=moved, events_deleted=deleted)

    async def _hold_calendars(
        self, organization_id: UUID, calendar_id: UUID, target_calendar_id: UUID | None
    ) -> None:
        # Locked in id order so two deletes moving into each other cannot deadlock;
        # the reload also refreshes a copy an earlier read left in the session.
        ids = sorted(i for i in (calendar_id, target_calendar_id) if i is not None)
        await self.session.execute(
            select(Calendar)
            .where(Calendar.organization_id == organization_id, Calendar.id.in_(ids))
            .order_by(Calendar.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    async def _require_no_blocked_series(
        self, user_id: UUID, organization_id: UUID, calendar_id: UUID
    ) -> None:
        """Keeping a calendar is no licence over a series its organizer shut you out of.

        Checked before anything changes, so a refusal never leaves the calendar
        half emptied.
        """
        blocked = await self.session.scalar(
            select(func.count())
            .select_from(CalendarEvent)
            .where(
                CalendarEvent.organization_id == organization_id,
                CalendarEvent.calendar_id == calendar_id,
                CalendarEvent.recurrence_id.is_(None),
                CalendarEvent.is_deleted == False,  # noqa: E712
                not_(
                    self.access_query.build_not_blocked_filter(
                        user_id=user_id,
                        organization_id=organization_id,
                        content_type=ContentType.CALENDAR_EVENT,
                        content_id_column=CalendarEvent.id,
                    )
                ),
            )
        )
        if blocked:
            raise PermissionDeniedError(
                "delete",
                ContentType.CALENDAR.value,
            )

    async def _live_series_count(self, organization_id: UUID, calendar_id: UUID) -> int:
        return (
            await self.session.scalar(
                select(func.count()).where(
                    CalendarEvent.organization_id == organization_id,
                    CalendarEvent.calendar_id == calendar_id,
                    CalendarEvent.recurrence_id.is_(None),
                    CalendarEvent.is_deleted == False,  # noqa: E712
                )
            )
        ) or 0

    async def _move_all_events(
        self,
        user_id: UUID,
        organization_id: UUID,
        calendar_id: UUID,
        target_calendar_id: UUID,
    ) -> int:
        if target_calendar_id == calendar_id:
            raise ValidationError("target_calendar_id", "Choose a different calendar.")
        await require_calendar_edit(self.session, user_id, organization_id, target_calendar_id)
        # Override rows move with their series, and deleted rows too, so a
        # restore never lands an event on a calendar that no longer exists.
        await stage_ical_uid_release(
            self.session,
            organization_id,
            select(CalendarEvent.id).where(
                CalendarEvent.organization_id == organization_id,
                CalendarEvent.calendar_id == calendar_id,
            ),
            target_calendar_id,
        )
        result = await self.session.execute(
            update(CalendarEvent)
            .where(
                CalendarEvent.organization_id == organization_id,
                CalendarEvent.calendar_id == calendar_id,
            )
            .values(calendar_id=target_calendar_id)
        )
        # The moved events' search documents still name the old calendar's
        # members; the target's refresh commits with the move.
        await record_calendar_search_acl_refresh(self.session, organization_id, target_calendar_id)
        return result.rowcount or 0

    async def _delete_all_events(
        self,
        user_id: UUID,
        organization_id: UUID,
        calendar_id: UUID,
    ) -> int:
        live_series = (
            select(CalendarEvent.id)
            .where(
                CalendarEvent.organization_id == organization_id,
                CalendarEvent.calendar_id == calendar_id,
                CalendarEvent.recurrence_id.is_(None),
                CalendarEvent.is_deleted == False,  # noqa: E712
            )
            .order_by(CalendarEvent.start_time)
        )
        count = await self.session.scalar(select(func.count()).select_from(live_series.subquery()))
        if (count or 0) > MAX_DELETED_SERIES:
            raise ValidationError(
                "disposition",
                f"This calendar holds {count} events, more than can be deleted at once "
                f"({MAX_DELETED_SERIES}). Move them to another calendar instead.",
            )
        event_ids = list((await self.session.execute(live_series)).scalars())
        events = CalendarEventOperations(self.session, self.search_indexer)
        for event_id in event_ids:
            await events.delete(user_id, organization_id, event_id)
        return len(event_ids)


def _validated_name(name: str) -> str:
    cleaned = name.strip()
    if not cleaned:
        raise ValidationError("name", "A calendar needs a name.")
    if len(cleaned) > NAME_LIMIT:
        raise ValidationError("name", f"Calendar names are limited to {NAME_LIMIT} characters.")
    return cleaned


def _validated_color(color: str) -> str:
    cleaned = color.strip()
    if not cleaned or len(cleaned) > COLOR_LIMIT:
        raise ValidationError("color", "Choose a calendar colour.")
    return cleaned


def _validated_description(description: str) -> str:
    if len(description) > DESCRIPTION_LIMIT:
        raise ValidationError(
            "description", f"Descriptions are limited to {DESCRIPTION_LIMIT} characters."
        )
    return description
