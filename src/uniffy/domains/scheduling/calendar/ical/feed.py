"""Token-scoped calendar feeds recheck live access on every fetch."""

import hashlib
import os
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto import ReEncryptingConsumer, register_consumer
from uniffy.core.crypto.org_cipher import OrgCipher
from uniffy.core.errors import NotFoundError
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.feed_token import CalendarFeedToken
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.domains.scheduling.calendar.calendars.access import require_calendar_view
from uniffy.domains.scheduling.calendar.events.reader import CalendarEventReader
from uniffy.domains.scheduling.calendar.ical.assemble import build_exports
from uniffy.domains.scheduling.calendar.ical.emit import serialize_events

logger = logger.bind(component="scheduling.calendar.ical.feed")

_DEFAULT_BASE_URL = "http://localhost:5173"
FEED_PATH = "/api/calendar/feed"
FEED_SUFFIX = ".ics"

TOKEN_BYTES = 32

# A subscription is a window onto the calendar, not its whole history: a client
# that polls hourly should not re-download a decade every time. Anything outside
# the horizon stays reachable in the app and through an explicit export.
FEED_PAST_DAYS = 90
FEED_FUTURE_DAYS = 365
MAX_FEED_EVENTS = 2000

# How often a subscribed client should come back. Clients treat it as a hint.
FEED_REFRESH_INTERVAL = timedelta(hours=1)


def feed_url(raw_token: str) -> str:
    base = os.getenv("UNIFFY_BASE_URL", _DEFAULT_BASE_URL).rstrip("/")
    return f"{base}{FEED_PATH}/{raw_token}{FEED_SUFFIX}"


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


async def issue_feed(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    calendar_id: UUID,
) -> tuple[str, CalendarFeedToken]:
    await require_calendar_view(session, user_id, organization_id, calendar_id)

    raw_token = secrets.token_urlsafe(TOKEN_BYTES)
    envelope = await OrgCipher(session).encrypt(organization_id, raw_token)

    row = await _load_own(session, user_id, organization_id, calendar_id)
    if row is None:
        row = CalendarFeedToken(
            organization_id=organization_id,
            calendar_id=calendar_id,
            user_id=user_id,
            token_hash=hash_token(raw_token),
            token_encrypted=envelope,
        )
    else:
        row.token_hash = hash_token(raw_token)
        row.token_encrypted = envelope
        row.created_at = datetime.now(UTC)
        # A regenerated URL has never been fetched; carrying the old timestamp
        # would show the new subscription as already in use.
        row.last_used_at = None
    session.add(row)

    await session.flush()
    return raw_token, row


async def read_feed(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    calendar_id: UUID,
) -> tuple[str, CalendarFeedToken] | None:
    await require_calendar_view(session, user_id, organization_id, calendar_id)
    row = await _load_own(session, user_id, organization_id, calendar_id)
    if row is None:
        return None
    raw_token = await OrgCipher(session).decrypt(organization_id, row.token_encrypted)
    return raw_token, row


async def revoke_feed(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    calendar_id: UUID,
) -> bool:
    """Delete the subscription. Every URL handed out for it stops resolving.

    Only the caller's own token goes, so no calendar access is needed: someone
    who lost the calendar can still withdraw the URL they handed out.
    """
    result = await session.execute(
        delete(CalendarFeedToken).where(
            CalendarFeedToken.calendar_id == calendar_id,
            CalendarFeedToken.user_id == user_id,
            CalendarFeedToken.organization_id == organization_id,
        )
    )
    return bool(result.rowcount)


async def resolve_feed(session: AsyncSession, raw_token: str) -> CalendarFeedToken | None:
    """A feed token confers no access beyond its owner's live permissions."""
    row = await session.scalar(
        select(CalendarFeedToken).where(CalendarFeedToken.token_hash == hash_token(raw_token))
    )
    if row is None:
        return None
    if not await _subscriber_is_active(session, row):
        return None
    # A subscription outlives the share that allowed it; losing the calendar ends it.
    try:
        await require_calendar_view(session, row.user_id, row.organization_id, row.calendar_id)
    except NotFoundError:
        return None
    return row


async def render_feed(session: AsyncSession, row: CalendarFeedToken) -> bytes:
    """Build the document for one subscription, as its subscriber sees it."""
    now = datetime.now(UTC)
    reader = CalendarEventReader(session)
    events, _ = await reader.list_events_in_window(
        row.user_id,
        row.organization_id,
        calendar_id=row.calendar_id,
        start_date=now - timedelta(days=FEED_PAST_DAYS),
        end_date=now + timedelta(days=FEED_FUTURE_DAYS),
        limit=MAX_FEED_EVENTS,
    )
    name = await session.scalar(
        select(Calendar.name).where(
            Calendar.id == row.calendar_id,
            Calendar.organization_id == row.organization_id,
        )
    )
    exports = await build_exports(
        session,
        events,
        viewer_id=row.user_id,
        organization_id=row.organization_id,
    )
    return serialize_events(
        exports,
        calendar_name=name or None,
        refresh_interval=FEED_REFRESH_INTERVAL,
    )


async def record_fetch(session: AsyncSession, row: CalendarFeedToken) -> None:
    """Update only telemetry so a concurrent key rotation cannot be overwritten."""
    fetched_at = datetime.now(UTC)
    await session.execute(
        update(CalendarFeedToken)
        .where(CalendarFeedToken.id == row.id)
        .values(last_used_at=fetched_at)
    )
    await session.commit()
    row.last_used_at = fetched_at


async def _load_own(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    calendar_id: UUID,
) -> CalendarFeedToken | None:
    return await session.scalar(
        select(CalendarFeedToken).where(
            CalendarFeedToken.calendar_id == calendar_id,
            CalendarFeedToken.user_id == user_id,
            CalendarFeedToken.organization_id == organization_id,
        )
    )


async def _subscriber_is_active(session: AsyncSession, row: CalendarFeedToken) -> bool:
    active = await session.scalar(
        select(OrganizationMember.user_id)
        .join(User, User.id == OrganizationMember.user_id)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .where(
            OrganizationMember.user_id == row.user_id,
            OrganizationMember.organization_id == row.organization_id,
            OrganizationMember.is_active.is_(True),
            User.is_active.is_(True),
            Organization.deleted_at.is_(None),
            Organization.is_suspended.is_(False),
        )
    )
    return active is not None


async def _list_feed_tokens_for_org(session: AsyncSession, organization_id: UUID):
    """Yield every subscription secret an organization holds, for DEK rotation."""
    result = await session.execute(
        select(CalendarFeedToken).where(CalendarFeedToken.organization_id == organization_id)
    )
    for row in result.scalars():
        yield row


def _feed_token_set_ciphertext(row: CalendarFeedToken, ciphertext: str) -> None:
    row.token_encrypted = ciphertext


# Without this the rotation sweep reports success while these secrets stay
# sealed under the retired key, and every subscription breaks on its removal.
def register_calendar_crypto() -> None:
    register_consumer(
        ReEncryptingConsumer(
            name="calendar_feed_tokens",
            table_name="calendar_feed_tokens",
            list_rows=_list_feed_tokens_for_org,
            get_ciphertext=lambda row: row.token_encrypted,
            set_ciphertext=_feed_token_set_ciphertext,
        )
    )
