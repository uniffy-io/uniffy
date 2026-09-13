"""PostgreSQL guarantees for event mail staged onto the shared outbox."""

import asyncio
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import delete, select

from uniffy.core.models.notifications.email_delivery import (
    EmailComposer,
    NotificationEmailDelivery,
    NotificationEmailStatus,
)
from uniffy.core.types import generate_id
from uniffy.domains.scheduling.calendar.mail.outbox import (
    CalendarMailKind,
    claim_event_mail,
    read_event_mail,
    retire_pending_event_mail,
    stage_event_mail,
    stage_event_mail_retry,
)
from uniffy.infrastructure.database import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")

NOW = datetime(2036, 3, 18, 9, 0, tzinfo=UTC)


async def _rows(session, event_id) -> list[NotificationEmailDelivery]:
    return list(
        (
            await session.execute(
                select(NotificationEmailDelivery)
                .where(NotificationEmailDelivery.content_id == event_id)
                .order_by(NotificationEmailDelivery.created_at)
            )
        )
        .scalars()
        .all()
    )


async def _clear(session, event_id) -> None:
    await session.execute(
        delete(NotificationEmailDelivery).where(NotificationEmailDelivery.content_id == event_id)
    )
    await session.commit()


async def _stage(session, env, event_id, kind, **overrides) -> int:
    return await stage_event_mail(
        session,
        organization_id=env.org_id,
        event_id=event_id,
        title="Standup",
        recipient_ids=overrides.pop("recipient_ids", [env.member_id]),
        kind=kind,
        actor_user_id=env.admin_id,
        now=NOW,
        **overrides,
    )


async def test_a_burst_of_edits_collapses_onto_one_pending_row(session, env) -> None:
    event_id = generate_id()
    try:
        await _stage(session, env, event_id, CalendarMailKind.CHANGE, changes=["schedule_changed"])
        await _stage(session, env, event_id, CalendarMailKind.CHANGE, changes=["location_changed"])
        await session.commit()

        rows = await _rows(session, event_id)
        assert len(rows) == 1
        request = read_event_mail(rows[0])
        assert request is not None
        assert request.changes == ("location_changed", "schedule_changed")
    finally:
        await _clear(session, event_id)


async def test_create_then_cancel_sends_only_the_cancellation(session, env) -> None:
    event_id = generate_id()
    try:
        await _stage(session, env, event_id, CalendarMailKind.INVITATION)
        await _stage(session, env, event_id, CalendarMailKind.CANCELLATION)
        await session.commit()

        rows = await _rows(session, event_id)
        assert len(rows) == 1
        request = read_event_mail(rows[0])
        assert request is not None
        assert request.kind is CalendarMailKind.CANCELLATION
    finally:
        await _clear(session, event_id)


async def test_withdrawing_one_occurrence_keeps_the_invitation_to_the_series(session, env) -> None:
    event_id = generate_id()
    try:
        await _stage(session, env, event_id, CalendarMailKind.INVITATION)
        await _stage(
            session,
            env,
            event_id,
            CalendarMailKind.CANCELLATION,
            occurrence_date=date(2026, 3, 25),
        )
        await session.commit()

        kinds = {read_event_mail(row).kind for row in await _rows(session, event_id)}
        assert kinds == {CalendarMailKind.INVITATION, CalendarMailKind.CANCELLATION}
    finally:
        await _clear(session, event_id)


async def test_a_message_already_sent_does_not_swallow_the_next_one(session, env) -> None:
    """The window closes when the row leaves PENDING; later edits owe a new
    message rather than folding into one nobody will read again."""
    event_id = generate_id()
    try:
        await _stage(session, env, event_id, CalendarMailKind.INVITATION)
        await session.commit()
        sent = (await _rows(session, event_id))[0]
        sent.status = NotificationEmailStatus.SENT
        await session.commit()

        await _stage(session, env, event_id, CalendarMailKind.CHANGE)
        await session.commit()

        rows = await _rows(session, event_id)
        assert len(rows) == 2
        assert {row.status for row in rows} == {
            NotificationEmailStatus.SENT,
            NotificationEmailStatus.PENDING,
        }
    finally:
        await _clear(session, event_id)


async def test_each_recipient_owns_their_own_row(session, env) -> None:
    event_id = generate_id()
    try:
        staged = await _stage(
            session,
            env,
            event_id,
            CalendarMailKind.INVITATION,
            recipient_ids=[env.member_id, env.admin_id],
        )
        await session.commit()

        assert staged == 2
        rows = await _rows(session, event_id)
        assert {row.user_id for row in rows} == {env.member_id, env.admin_id}
        assert all(row.composer == EmailComposer.CALENDAR for row in rows)
    finally:
        await _clear(session, event_id)


async def test_somebody_uninvited_loses_the_message_still_waiting(session, env) -> None:
    event_id = generate_id()
    try:
        await _stage(
            session,
            env,
            event_id,
            CalendarMailKind.INVITATION,
            recipient_ids=[env.member_id, env.admin_id],
        )
        await session.commit()

        await retire_pending_event_mail(session, event_id, [env.member_id], NOW)
        await session.commit()

        settled = {row.user_id: row.status for row in await _rows(session, event_id)}
        assert settled[env.member_id] == NotificationEmailStatus.SKIPPED
        assert settled[env.admin_id] == NotificationEmailStatus.PENDING
    finally:
        await _clear(session, event_id)


async def test_failed_send_merges_into_cancellation_staged_during_send(session, env) -> None:
    event_id = generate_id()
    try:
        await _stage(session, env, event_id, CalendarMailKind.INVITATION)
        await session.commit()
        first = (await _rows(session, event_id))[0]
        held = await claim_event_mail(session, first.id, NOW + timedelta(minutes=2))
        assert held is not None
        await _stage(session, env, event_id, CalendarMailKind.CANCELLATION)
        await session.commit()

        delay = await stage_event_mail_retry(session, held, attempt=1, now=NOW)
        await session.commit()

        rows = await _rows(session, event_id)
        pending = [row for row in rows if row.status == NotificationEmailStatus.PENDING]
        assert delay is None
        assert held.status == NotificationEmailStatus.SKIPPED
        assert held.terminal_reason == "superseded"
        assert len(pending) == 1
        assert read_event_mail(pending[0]).kind is CalendarMailKind.CANCELLATION
    finally:
        await _clear(session, event_id)


async def test_failed_send_without_successor_remains_retryable(session, env) -> None:
    event_id = generate_id()
    try:
        await _stage(session, env, event_id, CalendarMailKind.INVITATION)
        await session.commit()
        first = (await _rows(session, event_id))[0]
        held = await claim_event_mail(session, first.id, NOW + timedelta(minutes=2))
        assert held is not None
        delay = await stage_event_mail_retry(session, held, attempt=1, now=NOW)
        await session.commit()

        assert delay == 60
        assert held.status == NotificationEmailStatus.PENDING
        assert held.attempt_count == 1
        assert held.lease_expires_at is None
    finally:
        await _clear(session, event_id)


async def test_retry_racing_new_edit_keeps_one_pending_cancellation(session, env) -> None:
    event_id = generate_id()
    try:
        await _stage(session, env, event_id, CalendarMailKind.INVITATION)
        await session.commit()
        first = (await _rows(session, event_id))[0]
        held = await claim_event_mail(session, first.id, NOW + timedelta(minutes=2))
        assert held is not None

        async def retry() -> None:
            async with open_session() as retry_session:
                delivery = await retry_session.get(NotificationEmailDelivery, first.id)
                await stage_event_mail_retry(retry_session, delivery, attempt=1, now=NOW)
                await retry_session.commit()

        async def edit() -> None:
            async with open_session() as edit_session:
                await _stage(edit_session, env, event_id, CalendarMailKind.CANCELLATION)
                await edit_session.commit()

        await asyncio.wait_for(asyncio.gather(retry(), edit()), timeout=10)
        session.expire_all()
        pending = [
            row
            for row in await _rows(session, event_id)
            if row.status == NotificationEmailStatus.PENDING
        ]
        assert len(pending) == 1
        assert read_event_mail(pending[0]).kind is CalendarMailKind.CANCELLATION
    finally:
        await _clear(session, event_id)
