from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.models.calls import CallEndReason
from uniffy.core.types import generate_id
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.calls.config import LiveKitConfigError
from uniffy.domains.calls.lifecycle import CallEvictionReason


def _session(call=None) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = call
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    session.rollback = AsyncMock()
    return session


async def test_archive_without_active_call_is_a_no_op() -> None:
    session = _session()
    with patch("uniffy.domains.calls.channels.CallOperations") as operations:
        await CallsLifecycle().end_for_channel_archive(session, generate_id())
    operations.assert_not_called()


async def test_archive_ends_active_call_with_channel_reason() -> None:
    call = SimpleNamespace(id=generate_id())
    session = _session(call)
    operations = MagicMock()
    operations.end_call_internal = AsyncMock()
    with patch("uniffy.domains.calls.channels.CallOperations", return_value=operations):
        await CallsLifecycle().end_for_channel_archive(session, generate_id())
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
        await CallsLifecycle().end_for_channel_archive(session, generate_id())


async def test_member_removal_delegates_to_call_owner() -> None:
    call = SimpleNamespace(id=generate_id())
    session = _session(call)
    operations = MagicMock()
    operations.remove_channel_member = AsyncMock()
    user_id = generate_id()
    with patch("uniffy.domains.calls.channels.CallOperations", return_value=operations):
        await CallsLifecycle().remove_member(session, generate_id(), user_id)
    operations.remove_channel_member.assert_awaited_once_with(call, user_id)


async def test_member_removal_degrades_when_livekit_is_not_configured() -> None:
    call = SimpleNamespace(id=generate_id())
    session = _session(call)
    with patch(
        "uniffy.domains.calls.channels.CallOperations",
        side_effect=LiveKitConfigError("missing"),
    ):
        await CallsLifecycle().remove_member(session, generate_id(), generate_id())


async def test_eviction_delegates_to_call_owner() -> None:
    session = _session()
    operations = MagicMock()
    operations.evict_user = AsyncMock(return_value=1)
    user_id = generate_id()
    org_id = generate_id()
    actor_id = generate_id()
    with patch("uniffy.domains.calls.channels.CallOperations", return_value=operations):
        await CallsLifecycle().evict_user(
            session,
            user_id,
            reason=CallEvictionReason.MEMBERSHIP_REVOKED,
            organization_id=org_id,
            actor_user_id=actor_id,
        )
    operations.evict_user.assert_awaited_once_with(
        user_id,
        reason=CallEvictionReason.MEMBERSHIP_REVOKED,
        organization_id=org_id,
        session_ids=None,
        actor_user_id=actor_id,
    )


async def test_eviction_degrades_when_livekit_is_not_configured() -> None:
    session = _session()
    with patch(
        "uniffy.domains.calls.channels.CallOperations",
        side_effect=LiveKitConfigError("missing"),
    ):
        await CallsLifecycle().evict_user(
            session, generate_id(), reason=CallEvictionReason.SESSION_REVOKED
        )


async def test_eviction_failure_rolls_back_so_the_caller_session_stays_usable() -> None:
    """The caller already committed and keeps using the session, e.g. the directory sync loop."""
    session = _session()
    operations = MagicMock()
    operations.evict_user = AsyncMock(side_effect=RuntimeError("deadlock"))
    with patch("uniffy.domains.calls.channels.CallOperations", return_value=operations):
        await CallsLifecycle().evict_user(
            session, generate_id(), reason=CallEvictionReason.SESSION_REVOKED
        )
    session.rollback.assert_awaited_once()


async def test_session_transfer_restamps_without_livekit_or_commit() -> None:
    session = _session()
    session.commit = AsyncMock()
    with patch(
        "uniffy.domains.calls.channels.CallOperations",
        side_effect=LiveKitConfigError("missing"),
    ):
        await CallsLifecycle().transfer_session(session, generate_id(), generate_id())
    session.execute.assert_awaited_once()
    session.commit.assert_not_awaited()


async def test_org_teardown_delegates_to_call_owner() -> None:
    session = _session()
    operations = MagicMock()
    operations.end_calls_for_organization = AsyncMock(return_value=2)
    org_id = generate_id()
    actor_id = generate_id()
    with patch("uniffy.domains.calls.channels.CallOperations", return_value=operations):
        await CallsLifecycle().end_for_organization(
            session, org_id, CallEndReason.ORG_DELETED, actor_user_id=actor_id
        )
    operations.end_calls_for_organization.assert_awaited_once_with(
        org_id, CallEndReason.ORG_DELETED, actor_user_id=actor_id
    )


async def test_org_teardown_failure_rolls_back() -> None:
    session = _session()
    operations = MagicMock()
    operations.end_calls_for_organization = AsyncMock(side_effect=RuntimeError("timeout"))
    with patch("uniffy.domains.calls.channels.CallOperations", return_value=operations):
        await CallsLifecycle().end_for_organization(
            session, generate_id(), CallEndReason.ORG_SUSPENDED
        )
    session.rollback.assert_awaited_once()


async def test_org_teardown_degrades_when_livekit_is_not_configured() -> None:
    session = _session()
    with patch(
        "uniffy.domains.calls.channels.CallOperations",
        side_effect=LiveKitConfigError("missing"),
    ):
        await CallsLifecycle().end_for_organization(
            session, generate_id(), CallEndReason.ORG_SUSPENDED
        )
