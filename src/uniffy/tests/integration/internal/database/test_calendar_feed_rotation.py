"""A subscription secret has to move with the organization's key."""

import pytest
from sqlalchemy import delete

from uniffy.core.crypto import OrgCipher
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.feed_token import CalendarFeedToken
from uniffy.core.types import generate_id
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
