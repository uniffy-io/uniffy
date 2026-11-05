"""Which delivered notifications count as working together, and for whom."""

from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.events.types import NotificationEvent
from uniffy.core.types import NotificationType, generate_id
from uniffy.domains.directory.collaborators import recorder
from uniffy.domains.directory.collaborators import signals
from uniffy.domains.directory.collaborators.signals import (
    HALF_LIFE,
    CollaboratorSignal,
    decay_factor,
    stage_interactions,
)

_RECORDER = "uniffy.domains.directory.collaborators.recorder"


def _event(notification_type: NotificationType, **kwargs) -> NotificationEvent:
    return NotificationEvent(
        notification_type=notification_type,
        organization_id=generate_id(),
        actor_id=kwargs.pop("actor_id", generate_id()),
        title="t",
        **kwargs,
    )


async def _record(event: NotificationEvent, recipients, *, fresh=True) -> list:
    staged: list = []

    async def fake_stage(session, organization_id, pairs, **_kwargs):
        staged.extend(pairs)
        return len(pairs)

    session = MagicMock()
    session.commit = AsyncMock()
    with (
        patch(f"{_RECORDER}.stage_interactions", side_effect=fake_stage),
        patch(f"{_RECORDER}._first_in_window", AsyncMock(return_value=fresh)),
    ):
        await recorder.record_notification_interactions(session, event, recipients)
    return staged


class TestSignals:
    def test_a_score_halves_every_half_life(self) -> None:
        assert decay_factor(HALF_LIFE) == pytest.approx(0.5)
        assert decay_factor(HALF_LIFE * 2) == pytest.approx(0.25)
        assert decay_factor(timedelta(seconds=-5)) == 1.0

    async def test_a_batch_past_the_bind_parameter_limit_is_written_in_chunks(self) -> None:
        viewer = generate_id()
        peers = [generate_id() for _ in range(2 * signals._UPSERT_CHUNK + 1)]
        session = MagicMock()
        session.execute = AsyncMock()
        with patch.object(
            signals, "filter_active_members", AsyncMock(return_value={viewer, *peers})
        ):
            written = await stage_interactions(
                session,
                generate_id(),
                [(viewer, peer, CollaboratorSignal.CO_ACTIVITY) for peer in peers],
            )
        assert written == len(peers)
        assert session.execute.await_count == 3


class TestRecorder:
    async def test_both_sides_are_credited(self) -> None:
        event = _event(NotificationType.CHAT_DM)
        peer = generate_id()
        staged = await _record(event, [peer])
        assert staged == [
            (event.actor_id, peer, CollaboratorSignal.DIRECT_MESSAGE),
            (peer, event.actor_id, CollaboratorSignal.DIRECT_MESSAGE),
        ]

    @pytest.mark.parametrize(
        "notification_type",
        [
            NotificationType.SYSTEM_ANNOUNCEMENT,
            NotificationType.TASK_DUE_SOON,
            NotificationType.TIMESHEET_SUBMITTED,
            NotificationType.ACCESS_REQUESTED,
            NotificationType.CONTENT_SHARED,
        ],
    )
    async def test_unrelated_notifications_record_nothing(self, notification_type) -> None:
        assert await _record(_event(notification_type), [generate_id()]) == []

    async def test_skips_agent_work_broadcasts_team_pings_and_wide_fan_outs(self) -> None:
        cases = [
            _event(NotificationType.CHAT_MENTION, acting_agent_id=generate_id()),
            _event(NotificationType.CHAT_MENTION, metadata={"broadcast": "here"}),
            _event(NotificationType.CHAT_MENTION, metadata={"team_id": str(generate_id())}),
            _event(NotificationType.TASK_ASSIGNED, metadata={"group_ids": [str(generate_id())]}),
            _event(NotificationType.CHAT_DM, actor_id=None),
        ]
        for event in cases:
            assert await _record(event, [generate_id()]) == []
        wide = [generate_id() for _ in range(recorder.MAX_RECIPIENTS + 1)]
        assert await _record(_event(NotificationType.CHAT_MENTION), wide) == []

    async def test_a_share_counts_only_when_it_reached_one_person(self) -> None:
        event = _event(NotificationType.PERMISSION_GRANTED)
        assert await _record(event, [generate_id(), generate_id()]) == []
        assert len(await _record(event, [generate_id()])) == 2

    async def test_the_actor_is_never_paired_with_themselves(self) -> None:
        event = _event(NotificationType.CHAT_MENTION)
        assert await _record(event, [event.actor_id]) == []

    @pytest.mark.parametrize(
        "notification_type",
        [
            NotificationType.CHAT_DM,
            NotificationType.CHAT_THREAD_REPLY,
            NotificationType.TASK_ASSIGNED,
        ],
    )
    async def test_a_repeat_within_the_throttle_window_records_nothing(
        self, notification_type
    ) -> None:
        assert await _record(_event(notification_type), [generate_id()], fresh=False) == []
