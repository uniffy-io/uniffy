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
from uniffy.domains.calendar.converters import event_to_proto
from uniffy.domains.calendar.operations import CalendarEventOperations


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


def _make_ops() -> CalendarEventOperations:
    ops = CalendarEventOperations.__new__(CalendarEventOperations)
    ops.session = MagicMock()
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
        def __init__(self, session) -> None:
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
        assert proto.HasField("channel_id")
        assert proto.channel_id == str(cid)
        assert proto.channel_auto_created is True

    def test_converter_omits_unset_channel_id(self) -> None:
        proto = event_to_proto(_make_event())
        assert not proto.HasField("channel_id")
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
        ops = _make_ops()
        now = datetime.now(UTC)
        with pytest.raises(ValidationError):
            await ops.create(
                user_id=generate_id(),
                organization_id=generate_id(),
                title="Sync",
                start_time=now,
                end_time=now,
                calendar_id=generate_id(),
                meeting_url="https://zoom.test/x",
                channel_id=generate_id(),
            )

    async def test_create_validates_channel_when_no_meeting_url(self) -> None:
        ops = _make_ops()
        ops._validate_channel_binding = AsyncMock(
            side_effect=ValidationError("channel_id", "denied")
        )
        now = datetime.now(UTC)
        with pytest.raises(ValidationError):
            await ops.create(
                user_id=generate_id(),
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


def _patch_chat_ops(
    monkeypatch: pytest.MonkeyPatch,
    *,
    add_error: Exception | None = None,
) -> dict[str, list]:
    """Swap ``ChatChannelOperations`` for a recorder; imported at call time."""
    calls: dict[str, list] = {"add": [], "remove": []}

    class _FakeChatOps:
        def __init__(self, session) -> None:
            self.session = session

        async def add_members(self, user_id, organization_id, channel_id, member_user_ids):
            if add_error is not None:
                raise add_error
            calls["add"].append((user_id, organization_id, channel_id, list(member_user_ids)))
            return []

        async def remove_members(
            self, user_id, organization_id, channel_id, member_user_ids
        ) -> None:
            calls["remove"].append((user_id, organization_id, channel_id, list(member_user_ids)))

    monkeypatch.setattr(
        "uniffy.domains.chat.channels.operations.ChatChannelOperations",
        _FakeChatOps,
        raising=True,
    )
    return calls


class TestAutoCreatedRoomSync:
    async def test_skips_picked_channel(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _patch_chat_ops(monkeypatch)
        ops = _make_ops()
        event = _make_event(channel_id=generate_id(), channel_auto_created=False)
        await ops._sync_auto_created_room_members(event, added=[generate_id()], removed=[])
        assert calls["add"] == []
        assert calls["remove"] == []

    async def test_skips_when_no_channel(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _patch_chat_ops(monkeypatch)
        ops = _make_ops()
        event = _make_event(channel_auto_created=True)
        await ops._sync_auto_created_room_members(event, added=[generate_id()], removed=[])
        assert calls["add"] == []

    async def test_mirrors_add_and_remove(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _patch_chat_ops(monkeypatch)
        ops = _make_ops()
        cid = generate_id()
        event = _make_event(channel_id=cid, channel_auto_created=True)
        u_add, u_rm = generate_id(), generate_id()
        await ops._sync_auto_created_room_members(event, added=[u_add], removed=[u_rm])
        assert calls["add"] == [(event.organizer_id, event.organization_id, cid, [u_add])]
        assert calls["remove"] == [(event.organizer_id, event.organization_id, cid, [u_rm])]

    async def test_excludes_organizer(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = _patch_chat_ops(monkeypatch)
        ops = _make_ops()
        event = _make_event(channel_id=generate_id(), channel_auto_created=True)
        # The organizer owns the room; never re-add or remove them.
        await ops._sync_auto_created_room_members(
            event, added=[event.organizer_id], removed=[event.organizer_id]
        )
        assert calls["add"] == []
        assert calls["remove"] == []

    async def test_best_effort_swallows_chat_failure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _patch_chat_ops(monkeypatch, add_error=RuntimeError("chat down"))
        ops = _make_ops()
        event = _make_event(channel_id=generate_id(), channel_auto_created=True)
        # A chat-side failure must not fail the calendar operation.
        await ops._sync_auto_created_room_members(event, added=[generate_id()], removed=[])
