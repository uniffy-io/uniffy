"""A subscription secret has to move with the organization's key."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import delete, select

from uniffy.core.crypto import OrgCipher
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.feed_token import CalendarFeedToken
from uniffy.core.models.calendar.subscription import CalendarSubscription
from uniffy.core.types import CalendarType, generate_id
from uniffy.domains.scheduling.calendar.ical.feed import (
    issue_feed,
    read_feed,
    register_calendar_crypto,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_rotating_the_org_key_re_encrypts_the_feed_secret(session, env) -> None:
    """Rotation used to report success while these rows stayed sealed under the
    retired key, so removing it would have broken every subscription."""
    register_calendar_crypto()
    calendar = Calendar(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name=f"feed-{generate_id().hex[:8]}",
    )
    session.add(calendar)
    await session.commit()
    calendar_id = calendar.id

    try:
        raw_token, row = await issue_feed(
            session,
            user_id=env.admin_id,
            organization_id=env.org_id,
            calendar_id=calendar_id,
        )
        await session.commit()
        assert row.token_encrypted.startswith("v1:")

        version = await OrgCipher(session).rotate(env.org_id, env.admin_id)

        refreshed = await read_feed(
            session,
            user_id=env.admin_id,
            organization_id=env.org_id,
            calendar_id=calendar_id,
        )
        assert refreshed is not None
        recovered, stored = refreshed
        assert stored.token_encrypted.startswith(f"v{version}:")
        assert recovered == raw_token
    finally:
        await session.rollback()
        await session.execute(
            delete(CalendarFeedToken).where(CalendarFeedToken.calendar_id == calendar_id)
        )
        await session.execute(delete(Calendar).where(Calendar.id == calendar_id))
        await session.commit()


async def test_rotating_the_org_key_re_encrypts_a_followed_feed_address(session, env) -> None:
    register_calendar_crypto()
    calendar = Calendar(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name=f"followed-{generate_id().hex[:8]}",
        calendar_type=CalendarType.SUBSCRIBED,
    )
    session.add(calendar)
    await session.commit()
    calendar_id = calendar.id
    address = "https://calendar.example.com/private-rotation/basic.ics"

    try:
        cipher = OrgCipher(session)
        subscription = CalendarSubscription(
            organization_id=env.org_id,
            owner_id=env.admin_id,
            calendar_id=calendar_id,
            url_encrypted=await cipher.encrypt(env.org_id, address),
            url_digest=generate_id().hex,
            url_host="calendar.example.com",
            next_refresh_at=datetime.now(UTC),
        )
        session.add(subscription)
        await session.commit()

        version = await cipher.rotate(env.org_id, env.admin_id)

        stored = await session.scalar(
            select(CalendarSubscription.url_encrypted).where(
                CalendarSubscription.calendar_id == calendar_id
            )
        )
        assert stored.startswith(f"v{version}:")
        assert await OrgCipher(session).decrypt(env.org_id, stored) == address
    finally:
        await session.rollback()
        await session.execute(
            delete(CalendarSubscription).where(CalendarSubscription.calendar_id == calendar_id)
        )
        await session.execute(delete(Calendar).where(Calendar.id == calendar_id))
        await session.commit()
