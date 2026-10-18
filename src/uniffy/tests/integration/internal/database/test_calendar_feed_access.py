"""A subscription to a shared calendar lasts exactly as long as the share."""

from unittest.mock import MagicMock

import pytest
from sqlalchemy import delete, select
from uniffy_proto.cal.v1.calendar_pb import (
    GetCalendarFeedUrlRequest,
    RegenerateCalendarFeedRequest,
    RevokeCalendarFeedRequest,
)

from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.feed_token import CalendarFeedToken
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType, generate_id
from uniffy.domains.scheduling.calendar.events.registration import register_calendar_content
from uniffy.domains.scheduling.calendar.ical.feed import issue_feed, resolve_feed
from uniffy.domains.scheduling.calendar.rpc import interop
from uniffy.infrastructure.database import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_feed_rpc_changes_survive_separate_requests(session, env, monkeypatch) -> None:
    register_calendar_content()
    calendar = Calendar(
        organization_id=env.org_id,
        owner_id=env.member_id,
        name=f"feed-{generate_id().hex[:8]}",
        access_mode=AccessMode.OWNER_ONLY,
    )
    session.add(calendar)
    await session.commit()
    calendar_id = calendar.id
    monkeypatch.setattr(interop, "current_user_id", lambda: env.member_id)
    monkeypatch.setattr(interop, "resolve_organization_id", lambda _: env.org_id)
    handler = interop.InteropHandlers()
    args = {"organization_id": str(env.org_id), "calendar_id": str(calendar_id)}
    try:
        first = await handler.regenerate_calendar_feed(
            RegenerateCalendarFeedRequest(**args), MagicMock()
        )
        stored = await handler.get_calendar_feed_url(GetCalendarFeedUrlRequest(**args), MagicMock())
        assert stored.url == first.url
        token = first.url.rsplit("/", 1)[1].removesuffix(".ics")
        async with open_session() as reader:
            assert await resolve_feed(reader, token) is not None

        second = await handler.regenerate_calendar_feed(
            RegenerateCalendarFeedRequest(**args), MagicMock()
        )
        replacement = second.url.rsplit("/", 1)[1].removesuffix(".ics")
        assert replacement != token
        async with open_session() as reader:
            assert await resolve_feed(reader, token) is None
            assert await resolve_feed(reader, replacement) is not None

        stopped = await handler.revoke_calendar_feed(RevokeCalendarFeedRequest(**args), MagicMock())
        assert stopped.revoked
        async with open_session() as reader:
            assert await resolve_feed(reader, replacement) is None
        stored = await handler.get_calendar_feed_url(GetCalendarFeedUrlRequest(**args), MagicMock())
        assert not stored.url
    finally:
        await session.rollback()
        await session.execute(
            delete(CalendarFeedToken).where(CalendarFeedToken.calendar_id == calendar_id)
        )
        await session.execute(delete(Calendar).where(Calendar.id == calendar_id))
        await session.commit()


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
