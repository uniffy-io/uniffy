"""Which calendars a member reaches as someone's calendar delegate.

Lives in core because tag visibility mirrors the calendar domain's event filter and must not
drift from it; the calendar domain builds every delegation read on these clauses.
"""

from uuid import UUID

from sqlalchemy import ColumnElement, Select, and_, exists, select
from sqlalchemy.orm import aliased

from uniffy.core.auth.permissions.queries import not_blocked_clause
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.delegation import CalendarDelegation
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.types import AttendeeRole, CalendarType, ContentType

# Team calendars are shared through their own members and co-admins, never delegated.
DELEGABLE_CALENDAR_TYPES: tuple[CalendarType, ...] = (CalendarType.PERSONAL, CalendarType.WORK)


def active_member_clause(user_id_column, organization_id: UUID) -> ColumnElement[bool]:
    """Correlated EXISTS: the user in ``user_id_column`` is an active member of the org.

    Aliased so an outer query that also joins users or memberships cannot capture the
    correlation.
    """
    member = aliased(OrganizationMember)
    user = aliased(User)
    organization = aliased(Organization)
    return exists().where(
        member.user_id == user_id_column,
        member.organization_id == organization_id,
        member.is_active.is_(True),
        user.id == member.user_id,
        user.is_active.is_(True),
        organization.id == member.organization_id,
        organization.deleted_at.is_(None),
        organization.is_suspended.is_(False),
    )


def live_delegation_clause(organization_id: UUID) -> ColumnElement[bool]:
    """A delegation counts only while both of its parties are active members."""
    return and_(
        CalendarDelegation.organization_id == organization_id,
        active_member_clause(CalendarDelegation.grantor_id, organization_id),
        active_member_clause(CalendarDelegation.delegate_id, organization_id),
    )


def delegated_calendar_ids(delegate_id: UUID, organization_id: UUID) -> Select:
    """Live, delegable calendars whose owner has delegated them to ``delegate_id``.

    A BLOCKED grant on the calendar beats the delegation, as it beats every other grant.
    """
    return (
        select(Calendar.id)
        .join(CalendarDelegation, CalendarDelegation.grantor_id == Calendar.owner_id)
        .where(
            Calendar.organization_id == organization_id,
            Calendar.is_deleted == False,  # noqa: E712
            Calendar.calendar_type.in_(DELEGABLE_CALENDAR_TYPES),
            CalendarDelegation.delegate_id == delegate_id,
            live_delegation_clause(organization_id),
            not_blocked_clause(delegate_id, organization_id, ContentType.CALENDAR, Calendar.id),
        )
    )


def delegated_grantor_ids(delegate_id: UUID, organization_id: UUID) -> Select:
    """Members who have live delegations to ``delegate_id``; their invitations reach the delegate."""
    return select(CalendarDelegation.grantor_id).where(
        CalendarDelegation.delegate_id == delegate_id,
        live_delegation_clause(organization_id),
    )


def grantor_invitation_event_ids(delegate_id: UUID, organization_id: UUID) -> Select:
    """Events the delegate's grantors are invited to.

    The grantor's own organizer row is left out: what they organize on their personal calendars
    already reaches the delegate, and what they organize elsewhere is not delegated.
    """
    return select(EventAttendee.event_id).where(
        EventAttendee.user_id.in_(delegated_grantor_ids(delegate_id, organization_id)),
        EventAttendee.role != AttendeeRole.ORGANIZER,
    )
