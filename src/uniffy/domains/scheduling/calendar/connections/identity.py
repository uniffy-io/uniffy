"""Canonical forms for the identifiers a provider and Uniffy must agree on."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.connection import CalendarConnection, ConnectionStatus
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User

# Exchange hands out UIDs as a hex GlobalObjectId; Outlook and Graph disagree on its case.
_EXCHANGE_UID_PREFIX = "040000008200E00074C5B7101A82E008"
_VCAL_UID_MARKER = b"vCal-Uid\x01\x00\x00\x00"
_EMAIL_LIMIT = 320


def normalize_uid(uid: str | None) -> str | None:
    if uid is None:
        return None
    value = uid.strip()
    if value.startswith("{") and value.endswith("}"):
        value = value[1:-1].strip()
    if not value:
        return None
    if value.upper().startswith(_EXCHANGE_UID_PREFIX):
        return _wrapped_uid(value) or value.upper()
    return value


def _wrapped_uid(goid: str) -> str | None:
    """Graph wraps an outside organizer's UID in the id; the other copies carry it bare."""
    try:
        raw = bytes.fromhex(goid)
    except ValueError:
        return None
    start = raw.find(_VCAL_UID_MARKER)
    if start < 0:
        return None
    wrapped = raw[start + len(_VCAL_UID_MARKER) :].split(b"\x00", 1)[0]
    try:
        uid = wrapped.decode("utf-8").strip()
    except UnicodeDecodeError:
        return None
    return uid or None


def normalize_email(value: str | None) -> str | None:
    if value is None:
        return None
    email = value.strip().lower()
    if not email or len(email) > _EMAIL_LIMIT or email.count("@") != 1:
        return None
    local, domain = email.split("@")
    if not local or not domain:
        return None
    return email


async def member_emails(session: AsyncSession, organization_id: UUID) -> dict[str, UUID]:
    """Addresses that prove a guest is a member: login emails and verified connected accounts."""
    logins = await session.execute(
        select(User.email, User.id)
        .join(OrganizationMember, OrganizationMember.user_id == User.id)
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.is_active.is_(True),
            User.is_active.is_(True),
        )
    )
    found: dict[str, UUID] = {}
    for email, user_id in logins.all():
        normalized = normalize_email(email)
        if normalized:
            found[normalized] = user_id
    accounts = await session.execute(
        select(CalendarConnection.account_email, CalendarConnection.owner_id)
        .join(
            OrganizationMember,
            (OrganizationMember.user_id == CalendarConnection.owner_id)
            & (OrganizationMember.organization_id == CalendarConnection.organization_id),
        )
        .where(
            CalendarConnection.organization_id == organization_id,
            CalendarConnection.email_verified.is_(True),
            CalendarConnection.status != ConnectionStatus.DISCONNECTED,
            OrganizationMember.is_active.is_(True),
        )
    )
    for email, user_id in accounts.all():
        normalized = normalize_email(email)
        # A login address is the stronger claim; a connected account never takes it over.
        if normalized and normalized not in found:
            found[normalized] = user_id
    return found
