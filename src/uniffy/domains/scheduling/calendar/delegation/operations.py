"""Granting, changing and ending calendar delegations, by members and by org admins."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from loguru import logger
from sqlalchemy import Select, func, or_, select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.membership import get_active_membership
from uniffy.core.auth.permissions.calendar_delegation import (
    DELEGABLE_CALENDAR_TYPES,
    active_member_clause,
)
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.converters.common_proto import content_type_to_proto
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.events.realtime import ContentAccessAction, publish_content_access_changed
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.delegation import CalendarDelegation, CalendarDelegationLevel
from uniffy.core.models.login.user import User
from uniffy.core.pagination import decode_time_cursor, encode_time_cursor
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType, NotificationType, generate_id
from uniffy.domains.scheduling.calendar.calendars.search import (
    enqueue_calendar_search_acl_refresh,
    record_calendar_search_acl_refresh,
)
from uniffy.domains.scheduling.calendar.policy import require_can_delegate

logger = logger.bind(component="scheduling.calendar.delegation.operations")

# An assistant per person is the norm; past this a grant is a mistake or an abuse.
MAX_DELEGATES_PER_GRANTOR = 50
# How many people one member manages calendars for is not capped; the list shows the first ones.
MAX_GRANTORS_LISTED = 200
DEFAULT_PAGE_SIZE = 200
MAX_PAGE_SIZE = 500


class RevokedBy(StrEnum):
    GRANTOR = "grantor"
    DELEGATE = "delegate"
    ADMIN = "admin"


@dataclass(frozen=True)
class DelegationView:
    delegation: CalendarDelegation
    grantor_name: str
    delegate_name: str
    inactive: bool


@dataclass(frozen=True)
class _Effects:
    organization_id: UUID
    actor_id: UUID
    grantor_id: UUID
    delegate_id: UUID
    calendar_ids: tuple[UUID, ...]
    action: ContentAccessAction | None
    notify: NotificationType | None


def _raises(previous: CalendarDelegationLevel, level: CalendarDelegationLevel) -> bool:
    return (
        previous == CalendarDelegationLevel.EVENTS
        and level == CalendarDelegationLevel.EVENTS_AND_PRIVATE
    )


class CalendarDelegationOperations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def grant(
        self,
        actor_id: UUID,
        organization_id: UUID,
        delegate_id: UUID,
        level: CalendarDelegationLevel,
    ) -> DelegationView:
        """Make ``delegate_id`` the actor's delegate, or change the level of an existing grant."""
        if await get_active_membership(self.session, actor_id, organization_id) is None:
            raise PermissionDeniedError("delegate", "calendar")
        if delegate_id == actor_id:
            raise ValidationError("delegate_id", "You cannot delegate your calendar to yourself")
        if await get_active_membership(self.session, delegate_id, organization_id) is None:
            raise ValidationError("delegate_id", "The delegate must be an active member")

        existing = await self._pair(organization_id, actor_id, delegate_id, lock=True)
        if existing is not None and existing.level == level:
            return await self._view(existing)
        # The policy gates new reach; narrowing a grant the member already holds stays theirs.
        if existing is None or _raises(existing.level, level):
            await require_can_delegate(self.session, actor_id, organization_id)

        now = datetime.now(UTC)
        if existing is None:
            await self._require_room(organization_id, actor_id)
            inserted = await self.session.scalar(
                pg_insert(CalendarDelegation)
                .values(
                    id=generate_id(),
                    organization_id=organization_id,
                    grantor_id=actor_id,
                    delegate_id=delegate_id,
                    level=level,
                    created_by_id=actor_id,
                    created_at=now,
                    updated_at=now,
                )
                .on_conflict_do_nothing(constraint="uq_calendar_delegations_pair")
                .returning(CalendarDelegation.id)
            )
            if inserted is None:
                # A concurrent grant for the same pair won; treat this one as a level change.
                existing = await self._pair(organization_id, actor_id, delegate_id, lock=True)
                if existing is not None and existing.level == level:
                    await self.session.commit()
                    return await self._view(existing)
        action = ContentAccessAction.GRANTED
        if existing is not None:
            previous = existing.level
            if not _raises(previous, level):
                action = ContentAccessAction.REVOKED
            existing.level = level
            existing.updated_at = now
            delegation = existing
            await self._audit(
                actor_id,
                Action.CALENDAR_DELEGATION_UPDATED,
                delegation,
                {"level": level.value, "previous_level": previous.value},
            )
            notify = None
        else:
            delegation = await self._pair(organization_id, actor_id, delegate_id)
            if delegation is None:
                raise NotFoundError("CalendarDelegation", delegate_id)
            await self._audit(
                actor_id, Action.CALENDAR_DELEGATION_GRANTED, delegation, {"level": level.value}
            )
            notify = NotificationType.PERMISSION_GRANTED

        effects = await self._stage_refresh(actor_id, delegation, action, notify)
        await self.session.commit()
        await self._finish(effects)
        return await self._view(delegation)

    async def revoke(self, actor_id: UUID, organization_id: UUID, delegation_id: UUID) -> None:
        """The grantor withdraws a delegation, or the delegate steps down."""
        delegation = await self._load(organization_id, delegation_id)
        if delegation is None or actor_id not in (delegation.grantor_id, delegation.delegate_id):
            raise NotFoundError("CalendarDelegation", delegation_id)
        by = RevokedBy.GRANTOR if actor_id == delegation.grantor_id else RevokedBy.DELEGATE
        await self._revoke(actor_id, delegation, by)

    async def admin_revoke(self, actor_id: UUID, organization_id: UUID, delegation_id: UUID) -> None:
        await self._require_org_admin(actor_id, organization_id)
        delegation = await self._load(organization_id, delegation_id)
        if delegation is None:
            raise NotFoundError("CalendarDelegation", delegation_id)
        await self._revoke(actor_id, delegation, RevokedBy.ADMIN)

    async def list_mine(
        self, actor_id: UUID, organization_id: UUID
    ) -> tuple[list[DelegationView], list[DelegationView]]:
        if await get_active_membership(self.session, actor_id, organization_id) is None:
            raise PermissionDeniedError("view", "calendar delegations")
        order = (CalendarDelegation.created_at, CalendarDelegation.id)
        granted_by_me = await self._run_views(
            self
            ._views_query(organization_id)
            .where(CalendarDelegation.grantor_id == actor_id)
            .order_by(*order)
            .limit(MAX_DELEGATES_PER_GRANTOR)
        )
        granted_to_me = await self._run_views(
            self
            ._views_query(organization_id)
            .where(CalendarDelegation.delegate_id == actor_id)
            .order_by(*order)
            .limit(MAX_GRANTORS_LISTED)
        )
        return granted_by_me, granted_to_me

    async def list_for_org(
        self,
        actor_id: UUID,
        organization_id: UUID,
        *,
        user_id: UUID | None = None,
        page_size: int = DEFAULT_PAGE_SIZE,
        page_token: str = "",
    ) -> tuple[list[DelegationView], str]:
        """Every delegation in the org, newest first, for org admins."""
        await self._require_org_admin(actor_id, organization_id)
        size = min(max(page_size or DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
        query = self._views_query(organization_id)
        if user_id is not None:
            query = query.where(
                or_(
                    CalendarDelegation.grantor_id == user_id,
                    CalendarDelegation.delegate_id == user_id,
                )
            )
        if page_token:
            moment, last_id = decode_time_cursor(page_token)
            query = query.where(
                tuple_(CalendarDelegation.created_at, CalendarDelegation.id)
                < tuple_(moment, last_id)
            )
        views = await self._run_views(
            query.order_by(CalendarDelegation.created_at.desc(), CalendarDelegation.id.desc()).limit(
                size + 1
            )
        )
        if len(views) <= size:
            return views, ""
        last = views[size - 1].delegation
        return views[:size], encode_time_cursor(last.created_at, last.id)

    async def _revoke(self, actor_id: UUID, delegation: CalendarDelegation, by: RevokedBy) -> None:
        await self._audit(
            actor_id,
            Action.CALENDAR_DELEGATION_REVOKED,
            delegation,
            {"level": delegation.level.value, "by": by.value},
        )
        effects = await self._stage_refresh(
            actor_id, delegation, ContentAccessAction.REVOKED, NotificationType.PERMISSION_REVOKED
        )
        await self.session.delete(delegation)
        await self.session.commit()
        await self._finish(effects)

    async def _require_org_admin(self, actor_id: UUID, organization_id: UUID) -> None:
        if not await PermissionChecker(self.session).is_org_admin(actor_id, organization_id):
            raise PermissionDeniedError("manage", "calendar delegations")

    async def _require_room(self, organization_id: UUID, grantor_id: UUID) -> None:
        # Serialises a grantor's concurrent grants so the count below cannot be raced past.
        await self.session.execute(
            select(
                func.pg_advisory_xact_lock(
                    func.hashtextextended(f"calendar-delegation:{organization_id}:{grantor_id}", 0)
                )
            )
        )
        count = await self.session.scalar(
            select(func.count())
            .select_from(CalendarDelegation)
            .where(
                CalendarDelegation.organization_id == organization_id,
                CalendarDelegation.grantor_id == grantor_id,
            )
        )
        if (count or 0) >= MAX_DELEGATES_PER_GRANTOR:
            raise ValidationError(
                "delegate_id", f"A calendar can have at most {MAX_DELEGATES_PER_GRANTOR} delegates"
            )

    async def _pair(
        self, organization_id: UUID, grantor_id: UUID, delegate_id: UUID, *, lock: bool = False
    ) -> CalendarDelegation | None:
        query = select(CalendarDelegation).where(
            CalendarDelegation.organization_id == organization_id,
            CalendarDelegation.grantor_id == grantor_id,
            CalendarDelegation.delegate_id == delegate_id,
        )
        if lock:
            query = query.with_for_update()
        return (await self.session.execute(query)).scalar_one_or_none()

    async def _load(self, organization_id: UUID, delegation_id: UUID) -> CalendarDelegation | None:
        return (
            await self.session.execute(
                select(CalendarDelegation)
                .where(
                    CalendarDelegation.id == delegation_id,
                    CalendarDelegation.organization_id == organization_id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()

    async def _audit(
        self,
        actor_id: UUID,
        action: Action,
        delegation: CalendarDelegation,
        details: dict,
    ) -> None:
        await write_audit_event(
            self.session,
            organization_id=delegation.organization_id,
            actor_user_id=actor_id,
            action=action,
            resource_type=AuditResourceType.CALENDAR_DELEGATION,
            resource_id=delegation.id,
            details={
                "grantor_id": str(delegation.grantor_id),
                "delegate_id": str(delegation.delegate_id),
                **details,
            },
        )

    async def _stage_refresh(
        self,
        actor_id: UUID,
        delegation: CalendarDelegation,
        action: ContentAccessAction,
        notify: NotificationType | None,
    ) -> _Effects:
        """Queue the grantor's calendars for a search ACL refresh in this transaction."""
        calendar_ids = tuple(
            (
                await self.session.execute(
                    select(Calendar.id)
                    .where(
                        Calendar.organization_id == delegation.organization_id,
                        Calendar.owner_id == delegation.grantor_id,
                        Calendar.is_deleted == False,  # noqa: E712
                        Calendar.calendar_type.in_(DELEGABLE_CALENDAR_TYPES),
                    )
                    # The default calendar first: notifications point at it.
                    .order_by(Calendar.is_default.desc(), Calendar.created_at)
                )
            ).scalars()
        )
        for calendar_id in calendar_ids:
            await record_calendar_search_acl_refresh(
                self.session, delegation.organization_id, calendar_id
            )
        return _Effects(
            organization_id=delegation.organization_id,
            actor_id=actor_id,
            grantor_id=delegation.grantor_id,
            delegate_id=delegation.delegate_id,
            calendar_ids=calendar_ids,
            action=action,
            notify=notify,
        )

    async def _finish(self, effects: _Effects) -> None:
        for calendar_id in effects.calendar_ids:
            await enqueue_calendar_search_acl_refresh(calendar_id)
            if effects.action is None:
                continue
            try:
                await publish_content_access_changed(
                    content_type=content_type_to_proto(ContentType.CALENDAR),
                    content_id=calendar_id,
                    action=effects.action,
                    organization_id=effects.organization_id,
                    target_user_ids=[effects.delegate_id],
                )
            except Exception:
                logger.opt(exception=True).warning("Failed to publish delegation access change")
        await self._notify(effects)

    async def _notify(self, effects: _Effects) -> None:
        if effects.notify is None or not effects.calendar_ids:
            return
        # Whoever did not act hears about it: the delegate on a grant, the other
        # party (or both, for an admin) on a revocation.
        targets = [
            user_id
            for user_id in (effects.grantor_id, effects.delegate_id)
            if user_id != effects.actor_id
        ]
        if effects.notify == NotificationType.PERMISSION_GRANTED:
            targets = [effects.delegate_id]
            title = "You can now manage this calendar as a delegate"
        else:
            title = "A calendar delegation ended"
        try:
            await emit_notification(
                NotificationEvent(
                    notification_type=effects.notify,
                    organization_id=effects.organization_id,
                    actor_id=effects.actor_id,
                    title=title,
                    source_urn=build_content_urn(ContentType.CALENDAR, effects.calendar_ids[0]),
                    target_user_ids=targets,
                )
            )
        except Exception:
            logger.opt(exception=True).warning("Failed to emit delegation notification")

    def _views_query(self, organization_id: UUID) -> Select:
        grantor = aliased(User)
        delegate = aliased(User)
        both_active = active_member_clause(
            CalendarDelegation.grantor_id, organization_id
        ) & active_member_clause(CalendarDelegation.delegate_id, organization_id)
        return (
            select(
                CalendarDelegation,
                func.coalesce(grantor.full_name, grantor.email),
                func.coalesce(delegate.full_name, delegate.email),
                both_active,
            )
            .join(grantor, grantor.id == CalendarDelegation.grantor_id)
            .join(delegate, delegate.id == CalendarDelegation.delegate_id)
            .where(CalendarDelegation.organization_id == organization_id)
        )

    async def _run_views(self, query: Select) -> list[DelegationView]:
        rows: Sequence = (await self.session.execute(query)).all()
        return [
            DelegationView(
                delegation=delegation,
                grantor_name=grantor_name or "",
                delegate_name=delegate_name or "",
                inactive=not active,
            )
            for delegation, grantor_name, delegate_name, active in rows
        ]

    async def _view(self, delegation: CalendarDelegation) -> DelegationView:
        views = await self._run_views(
            self._views_query(delegation.organization_id).where(
                CalendarDelegation.id == delegation.id
            )
        )
        return views[0]
