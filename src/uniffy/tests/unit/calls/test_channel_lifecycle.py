from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.models.calls import CallEndReason
from uniffy.core.types import generate_id
from uniffy.domains.calls.channels import CallsChannelLifecycle
from uniffy.domains.calls.config import LiveKitConfigError


def _session(call=None) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = call
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    return session


async def test_archive_without_active_call_is_a_no_op() -> None:
    session = _session()
    with patch("uniffy.domains.calls.channels.CallOperations") as operations:
        await CallsChannelLifecycle().end_for_channel_archive(session, generate_id())
    operations.assert_not_called()


async def test_archive_ends_active_call_with_channel_reason() -> None:
    call = SimpleNamespace(id=generate_id())
    session = _session(call)
    operations = MagicMock()
    operations.end_call_internal = AsyncMock()
    with patch("uniffy.domains.calls.channels.CallOperations", return_value=operations):
        await CallsChannelLifecycle().end_for_channel_archive(session, generate_id())
    operations.end_call_internal.assert_awaited_once_with(
        call,
        CallEndReason.CHANNEL_ARCHIVED,
    )


async def test_archive_degrades_when_livekit_is_not_configured() -> None:
    call = SimpleNamespace(id=generate_id())
    session = _session(call)
    with patch(
        "uniffy.domains.calls.channels.CallOperations",
        side_effect=LiveKitConfigError("missing"),
    ):
        await CallsChannelLifecycle().end_for_channel_archive(session, generate_id())


async def test_member_removal_delegates_to_call_owner() -> None:
    call = SimpleNamespace(id=generate_id())
    session = _session(call)
    operations = MagicMock()
    operations.remove_channel_member = AsyncMock()
    user_id = generate_id()
    with patch("uniffy.domains.calls.channels.CallOperations", return_value=operations):
        await CallsChannelLifecycle().remove_member(session, generate_id(), user_id)
    operations.remove_channel_member.assert_awaited_once_with(call, user_id)


async def test_member_removal_degrades_when_livekit_is_not_configured() -> None:
    call = SimpleNamespace(id=generate_id())
    session = _session(call)
    with patch(
        "uniffy.domains.calls.channels.CallOperations",
        side_effect=LiveKitConfigError("missing"),
    ):
        await CallsChannelLifecycle().remove_member(session, generate_id(), generate_id())
