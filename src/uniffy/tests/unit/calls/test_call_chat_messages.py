"""Call lifecycle system messages posted into the channel's chat."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.models.calls import Call, CallEndReason, CallType
from uniffy.core.models.chat.message import ChatMessageMetadataKind
from uniffy.core.types import generate_id
from uniffy.domains.calls.operations import _format_call_duration


def _build_session(participant_rows: list | None = None) -> MagicMock:
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=object())
    result.all = MagicMock(return_value=participant_rows or [])
    session.execute = AsyncMock(return_value=result)
    return session


def _build_ops(session: MagicMock):
    from uniffy.domains.calls.config import LiveKitConfig
    from uniffy.domains.calls.operations import CallOperations

    with patch(
        "uniffy.domains.calls.operations.get_livekit_config",
        return_value=LiveKitConfig(
            host="http://livekit:7880", api_key="k", api_secret="s" * 32, ws_url="/livekit"
        ),
    ):
        return CallOperations(session)


def _call(host_id, started_minutes_ago: int = 10) -> Call:
    org_id = generate_id()
    return Call(
        id=generate_id(),
        organization_id=org_id,
        channel_id=generate_id(),
        call_type=CallType.CHANNEL,
        initiator_user_id=host_id,
        host_user_id=host_id,
        livekit_room_name=f"org_{org_id}:call_{generate_id()}",
        started_at=datetime.now(UTC) - timedelta(minutes=started_minutes_ago),
    )


async def _run_summary(ops, call, reason, actor_user_id, profiles):
    send = AsyncMock()
    with patch.object(type(ops), "resolve_profiles", AsyncMock(return_value=profiles)):
        ops.chat.post_system_message = send
        await ops._post_call_ended_summary(call, reason, actor_user_id, datetime.now(UTC))
    return send


def test_format_call_duration() -> None:
    cases = ((42, "42s"), (754, "12m 34s"), (3900, "1h 05m"))
    for seconds, expected in cases:
        assert _format_call_duration(seconds) == expected


async def test_all_left_summary_lists_participants() -> None:
    host_id, other_id = generate_id(), generate_id()
    call = _call(host_id)
    session = _build_session(participant_rows=[(host_id,), (other_id,)])
    ops = _build_ops(session)

    send = await _run_summary(
        ops,
        call,
        CallEndReason.ALL_LEFT,
        None,
        {
            host_id: MagicMock(display_name="Alice"),
            other_id: MagicMock(display_name="Bob"),
        },
    )

    kwargs = send.call_args.kwargs
    assert kwargs["channel_id"] == call.channel_id
    assert kwargs["user_id"] == host_id
    assert kwargs["kind"] is ChatMessageMetadataKind.CALL_ENDED
    content = kwargs["content"]
    expected_duration = "10m 00s"
    assert content.startswith("Call ended - ")
    assert expected_duration in content
    assert f"[[[Alice|urn:uniffy:content:USER:{host_id}]]]" in content
    assert f"[[[Bob|urn:uniffy:content:USER:{other_id}]]]" in content


async def test_host_ended_summary_names_the_actor() -> None:
    host_id = generate_id()
    call = _call(host_id)
    session = _build_session(participant_rows=[(host_id,)])
    ops = _build_ops(session)

    send = await _run_summary(
        ops,
        call,
        CallEndReason.HOST_ENDED,
        host_id,
        {host_id: MagicMock(display_name="Alice")},
    )

    content = send.call_args.kwargs["content"]
    assert content.startswith(
        f"[[[Alice|urn:uniffy:content:USER:{host_id}]]] ended the call for everyone"
    )


async def test_summary_caps_mentions_with_overflow() -> None:
    host_id = generate_id()
    call = _call(host_id)
    user_ids = [host_id] + [generate_id() for _ in range(7)]
    session = _build_session(participant_rows=[(uid,) for uid in user_ids])
    ops = _build_ops(session)

    send = await _run_summary(
        ops,
        call,
        CallEndReason.ALL_LEFT,
        None,
        {uid: MagicMock(display_name=f"U{i}") for i, uid in enumerate(user_ids)},
    )

    content = send.call_args.kwargs["content"]
    expected_overflow = "and 2 more"
    assert content.count("urn:uniffy:content:USER:") == 6
    assert expected_overflow in content


async def test_summary_failure_never_raises() -> None:
    call = _call(generate_id())
    session = _build_session()
    ops = _build_ops(session)

    send = AsyncMock()
    ops.chat.post_system_message = send
    with patch.object(
        type(ops), "resolve_profiles", AsyncMock(side_effect=RuntimeError("resolver down"))
    ):
        await ops._post_call_ended_summary(call, CallEndReason.ALL_LEFT, None, datetime.now(UTC))
        send.assert_not_called()


async def test_system_message_failure_is_swallowed() -> None:
    call = _call(generate_id())
    session = _build_session()
    ops = _build_ops(session)

    ops.chat.post_system_message = AsyncMock(side_effect=RuntimeError("chat down"))
    await ops._post_call_system_message(
        call, "Call ended", call.host_user_id, ChatMessageMetadataKind.CALL_ENDED
    )


async def test_start_message_carries_kind_metadata() -> None:
    call = _call(generate_id())
    session = _build_session()
    ops = _build_ops(session)

    ops.chat.post_system_message = AsyncMock()
    await ops._post_call_system_message(
        call, "Alice started a call", call.host_user_id, ChatMessageMetadataKind.CALL_STARTED
    )
    kwargs = ops.chat.post_system_message.call_args.kwargs
    assert kwargs["kind"] is ChatMessageMetadataKind.CALL_STARTED
