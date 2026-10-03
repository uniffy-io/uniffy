"""A subscription to a shared calendar lasts exactly as long as the share."""

import pytest
from sqlalchemy import delete, select

from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.feed_token import CalendarFeedToken
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType, generate_id
from uniffy.domains.scheduling.calendar.events.registration import register_calendar_content
from uniffy.domains.scheduling.calendar.ical.feed import issue_feed, resolve_feed

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_a_viewer_subscribes_until_the_share_is_withdrawn(session, env) -> None:
    register_calendar_content()
    calendar = Calendar(
        organization_id=env.org_id,
        owner_id=env.member_id,
        name=f"team-{generate_id().hex[:8]}",
        access_mode=AccessMode.EXPLICIT_MEMBERS,
    )
    session.add(calendar)
    await session.flush()
    session.add(
        ContentMember(
            organization_id=env.org_id,
            content_type=ContentType.CALENDAR,
            content_id=calendar.id,
            subject_type=SubjectType.USER,
            subject_id=env.admin_id,
            role=ContentRole.VIEWER,
            added_by_user_id=env.member_id,
        )
    )
    await session.commit()
    calendar_id = calendar.id

    try:
        raw_token, _row = await issue_feed(
            session,
            user_id=env.admin_id,
            organization_id=env.org_id,
            calendar_id=calendar_id,
        )
        await session.commit()
        assert await resolve_feed(session, raw_token) is not None

        grant = await session.scalar(
            select(ContentMember).where(
                ContentMember.content_type == ContentType.CALENDAR,
                ContentMember.content_id == calendar_id,
            )
        )
        await session.delete(grant)
        await session.commit()

        # Being an org admin gives the subscriber no way back in.
        assert await resolve_feed(session, raw_token) is None
    finally:
        await session.rollback()
        await session.execute(
            delete(CalendarFeedToken).where(CalendarFeedToken.calendar_id == calendar_id)
        )
        await session.execute(delete(Calendar).where(Calendar.id == calendar_id))
        await session.commit()
