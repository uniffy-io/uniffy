"""Unit tests for calendar events bound to chat channels (online meetings).

Covers the pure-Python pieces that don't require a live DB:

- ``event_to_proto`` passes ``channel_id`` / ``channel_auto_created`` through
  and never hydrates a channel name (the frontend resolves it).
- ``_validate_channel_binding`` rejects archived channels and propagates the
  access / not-found decisions from ``ChatAccessChecker``.
- ``create`` rejects an event that carries both a meeting URL and a channel
  binding, and validates the channel when only a binding is supplied.
- ``_apply_channel_binding_update`` binds, clears, preserves the auto-created
  flag on an idempotent re-bind, and enforces mutual exclusion with
  ``meeting_url``.

SET NULL cascade behaviour is a Postgres-level FK
guarantee exercised by the (separate) live-DB harness.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.scheduling.calendar.converters import event_to_proto
from uniffy.domains.scheduling.calendar.operations import CalendarEventOperations


def _make_event(
    *,
    channel_id: UUID | None = None,
    channel_auto_created: bool = False,
    meeting_url: str | None = None,
) -> CalendarEvent:
    now = datetime.now(UTC)
    return CalendarEvent(
        organization_id=generate_id(),
        organizer_id=generate_id(),
        calendar_id=generate_id(),
        title="Sprint Planning",
        start_time=now,
        end_time=now,
        access_mode=AccessMode.OWNER_ONLY,
        channel_id=channel_id,
        channel_auto_created=channel_auto_created,
        meeting_url=meeting_url,
    )


def _make_ops(calendar_owner: UUID | None = None) -> CalendarEventOperations:
    """`calendar_owner` answers the ownership check `create()` runs first;
    tests that never reach it can leave it unset."""
    ops = CalendarEventOperations.__new__(CalendarEventOperations)
    ops.session = MagicMock()
    ops.session.scalar = AsyncMock(return_value=calendar_owner)
    ops._call_lifecycle = MagicMock()
    ops._search_indexer = MagicMock()
    return ops


def _make_channel(*, is_archived: bool = False) -> ChatChannel:
    return ChatChannel(
        organization_id=generate_id(),
        owner_id=generate_id(),
        name="standup",
        slug="standup",
        description="",
        channel_type=ChannelType.PRIVATE,
        is_archived=is_archived,
    )


def _patch_checker(
    monkeypatch: pytest.MonkeyPatch,
    *,
    channel: ChatChannel | None = None,
    get_error: Exception | None = None,
    access_error: Exception | None = None,
) -> None:
    """Swap ``ChatAccessChecker`` for a fake with scripted behaviour.

    ``_validate_channel_binding`` imports the checker at call time, so patching
    the attribute on the source module is enough.
    """

    class _FakeChecker:
        def __init__(self, session, **_kwargs) -> None:
            self.session = session

        async def get_channel(self, channel_id, organization_id):
            if get_error is not None:
                raise get_error
            return channel

        async def check_access(self, user_id, organization_id, ch) -> None:
            if access_error is not None:
                raise access_error

    monkeypatch.setattr("uniffy.domains.chat.access.ChatAccessChecker", _FakeChecker, raising=True)


class TestChannelBindingConverter:
    def test_converter_passes_channel_binding(self) -> None:
        cid = generate_id()
        proto = event_to_proto(_make_event(channel_id=cid, channel_auto_created=True))
        assert proto.has_field("channel_id")
        assert proto.channel_id == str(cid)
        assert proto.channel_auto_created is True

    def test_converter_omits_unset_channel_id(self) -> None:
        proto = event_to_proto(_make_event())
        assert not proto.has_field("channel_id")
        assert proto.channel_auto_created is False


class TestValidateChannelBinding:
    async def test_happy_path_passes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _patch_checker(monkeypatch, channel=_make_channel())
        ops = _make_ops()
        # No raise means the organizer may bind to the channel.
        await ops._validate_channel_binding(generate_id(), generate_id(), generate_id())

    async def test_archived_channel_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _patch_checker(monkeypatch, channel=_make_channel(is_archived=True))
        ops = _make_ops()
        with pytest.raises(ValidationError):
            await ops._validate_channel_binding(generate_id(), generate_id(), generate_id())

    async def test_no_access_propagates(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _patch_checker(
            monkeypatch,
            channel=_make_channel(),
            access_error=PermissionDeniedError("access", "channel"),
        )
        ops = _make_ops()
        with pytest.raises(PermissionDeniedError):
            await ops._validate_channel_binding(generate_id(), generate_id(), generate_id())

    async def test_missing_or_cross_org_channel_propagates(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # get_channel already scopes by org and filters deleted rows, so a
        # cross-org or deleted channel surfaces as NotFound here.
        _patch_checker(monkeypatch, get_error=NotFoundError("channel", generate_id()))
        ops = _make_ops()
        with pytest.raises(NotFoundError):
            await ops._validate_channel_binding(generate_id(), generate_id(), generate_id())


class TestCreateMutualExclusion:
    async def test_create_rejects_meeting_url_and_channel_both_set(self) -> None:
        author = generate_id()
        ops = _make_ops(author)
        now = datetime.now(UTC)
        with pytest.raises(ValidationError):
            await ops.create(
                user_id=author,
                organization_id=generate_id(),
                title="Sync",
                start_time=now,
                end_time=now,
                calendar_id=generate_id(),
                meeting_url="https://zoom.test/x",
                channel_id=generate_id(),
            )

    async def test_create_validates_channel_when_no_meeting_url(self) -> None:
        author = generate_id()
        ops = _make_ops(author)
        ops._validate_channel_binding = AsyncMock(
            side_effect=ValidationError("channel_id", "denied")
        )
        now = datetime.now(UTC)
        with pytest.raises(ValidationError):
            await ops.create(
                user_id=author,
                organization_id=generate_id(),
                title="Sync",
                start_time=now,
                end_time=now,
                calendar_id=generate_id(),
                channel_id=generate_id(),
            )
        ops._validate_channel_binding.assert_awaited_once()


class TestApplyChannelBindingUpdate:
    async def test_clears_binding_on_empty_string(self) -> None:
        ops = _make_ops()
        event = _make_event(channel_id=generate_id(), channel_auto_created=True)
        await ops._apply_channel_binding_update(generate_id(), generate_id(), event, "", False)
        assert event.channel_id is None
        assert event.channel_auto_created is False

    async def test_binds_new_channel(self) -> None:
        ops = _make_ops()
        ops._validate_channel_binding = AsyncMock()
        event = _make_event()
        new_id = generate_id()
        await ops._apply_channel_binding_update(
            generate_id(), generate_id(), event, str(new_id), False
        )
        assert event.channel_id == new_id
        assert event.channel_auto_created is False
        ops._validate_channel_binding.assert_awaited_once()

    async def test_preserves_auto_created_on_idempotent_rebind(self) -> None:
        ops = _make_ops()
        ops._validate_channel_binding = AsyncMock()
        cid = generate_id()
        event = _make_event(channel_id=cid, channel_auto_created=True)
        await ops._apply_channel_binding_update(generate_id(), generate_id(), event, str(cid), False)
        assert event.channel_id == cid
        # Re-binding the same channel must not clear an auto-created flag.
        assert event.channel_auto_created is True

    async def test_untouched_leaves_binding(self) -> None:
        ops = _make_ops()
        ops._validate_channel_binding = AsyncMock()
        cid = generate_id()
        event = _make_event(channel_id=cid, channel_auto_created=True)
        await ops._apply_channel_binding_update(generate_id(), generate_id(), event, None, False)
        assert event.channel_id == cid
        assert event.channel_auto_created is True
        ops._validate_channel_binding.assert_not_awaited()

    async def test_rejects_binding_alongside_meeting_url(self) -> None:
        ops = _make_ops()
        ops._validate_channel_binding = AsyncMock()
        event = _make_event(meeting_url="https://zoom.test/x")
        with pytest.raises(ValidationError):
            await ops._apply_channel_binding_update(
                generate_id(), generate_id(), event, str(generate_id()), False
            )

    async def test_new_binding_carries_auto_created_flag(self) -> None:
        ops = _make_ops()
        ops._validate_channel_binding = AsyncMock()
        event = _make_event()
        new_id = generate_id()
        await ops._apply_channel_binding_update(
            generate_id(), generate_id(), event, str(new_id), False, channel_auto_created=True
        )
        assert event.channel_id == new_id
        assert event.channel_auto_created is True

    async def test_picked_channel_defaults_flag_false(self) -> None:
        ops = _make_ops()
        ops._validate_channel_binding = AsyncMock()
        event = _make_event()
        new_id = generate_id()
        await ops._apply_channel_binding_update(
            generate_id(), generate_id(), event, str(new_id), False
        )
        assert event.channel_id == new_id
        assert event.channel_auto_created is False


def _patch_room_membership(
    monkeypatch: pytest.MonkeyPatch,
    *,
    stage_error: Exception | None = None,
    finish_error: Exception | None = None,
) -> dict[str, list]:
    calls: dict[str, list] = {"add": [], "remove": [], "finish": []}

    class _FakeRoomMembership:
        def __init__(self, session, **_kwargs) -> None:
            self.session = session

        async def stage_sync(
            self,
            owner_id,
            organization_id,
            channel_id,
            *,
            added_user_ids,
            removed_user_ids,
        ) -> MagicMock:
            if stage_error is not None:
                raise stage_error
            if added_user_ids:
                calls["add"].append((owner_id, organization_id, channel_id, list(added_user_ids)))
            if removed_user_ids:
                calls["remove"].append((
                    owner_id,
                    organization_id,
                    channel_id,
                    list(removed_user_ids),
                ))
            return MagicMock()

        async def finish_sync_after_commit(self, staged) -> None:
            calls["finish"].append(staged)
            if finish_error is not None:
                raise finish_error

    monkeypatch.setattr(
        "uniffy.domains.scheduling.calendar.events.attendees.RoomMembership",
        _FakeRoomMembership,
        raising=True,
    )
    return calls


class TestAutoCreatedRoomMembership:
    async def test_skips_picked_channel(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _patch_room_membership(monkeypatch)
        ops = _make_ops()
        event = _make_event(channel_id=generate_id(), channel_auto_created=False)
        staged = await ops._stage_auto_created_room_members(
            event,
            added=[generate_id()],
            removed=[],
            call_lifecycle=MagicMock(),
        )
        assert staged is None
        assert calls["add"] == []
        assert calls["remove"] == []

    async def test_skips_when_no_channel(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _patch_room_membership(monkeypatch)
        ops = _make_ops()
        event = _make_event(channel_auto_created=True)
        staged = await ops._stage_auto_created_room_members(
            event,
            added=[generate_id()],
            removed=[],
            call_lifecycle=MagicMock(),
        )
        assert staged is None
        assert calls["add"] == []

    async def test_mirrors_add_and_remove(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _patch_room_membership(monkeypatch)
        ops = _make_ops()
        cid = generate_id()
        event = _make_event(channel_id=cid, channel_auto_created=True)
        u_add, u_rm = generate_id(), generate_id()
        staged = await ops._stage_auto_created_room_members(
            event,
            added=[u_add],
            removed=[u_rm],
            call_lifecycle=MagicMock(),
        )
        assert staged is not None
        assert calls["add"] == [(event.organizer_id, event.organization_id, cid, [u_add])]
        assert calls["remove"] == [(event.organizer_id, event.organization_id, cid, [u_rm])]

    async def test_excludes_organizer(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _patch_room_membership(monkeypatch)
        ops = _make_ops()
        event = _make_event(channel_id=generate_id(), channel_auto_created=True)
        # The organizer owns the room; never re-add or remove them.
        staged = await ops._stage_auto_created_room_members(
            event,
            added=[event.organizer_id],
            removed=[event.organizer_id],
            call_lifecycle=MagicMock(),
        )
        assert staged is None
        assert calls["add"] == []
        assert calls["remove"] == []

    async def test_stage_failure_prevents_calendar_commit(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _patch_room_membership(monkeypatch, stage_error=RuntimeError("chat down"))
        ops = _make_ops()
        event = _make_event(channel_id=generate_id(), channel_auto_created=True)
        with pytest.raises(RuntimeError, match="chat down"):
            await ops._stage_auto_created_room_members(
                event,
                added=[generate_id()],
                removed=[],
                call_lifecycle=MagicMock(),
            )

    async def test_missing_search_dependency_fails_during_staging(self) -> None:
        ops = _make_ops()
        ops._search_indexer = None
        event = _make_event(channel_id=generate_id(), channel_auto_created=True)

        with pytest.raises(RuntimeError, match="SearchIndexer"):
            await ops._stage_auto_created_room_members(
                event,
                added=[generate_id()],
                removed=[],
                call_lifecycle=MagicMock(),
            )

    async def test_post_commit_failure_is_degraded(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _patch_room_membership(
            monkeypatch,
            finish_error=RuntimeError("fanout down"),
        )
        ops = _make_ops()
        event = _make_event(channel_id=generate_id(), channel_auto_created=True)
        staged = await ops._stage_auto_created_room_members(
            event,
            added=[generate_id()],
            removed=[],
            call_lifecycle=MagicMock(),
        )

        await ops._finish_auto_created_room_members(event, staged)
        assert len(calls["finish"]) == 1
