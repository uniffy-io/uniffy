from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

from uniffy.core.models.agents.message import AgentMessageRole
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.types import generate_id
from uniffy.domains.agents.runtime.writers import ChatChannelMessageWriter


def _writer(session: MagicMock) -> tuple[ChatChannelMessageWriter, dict[str, UUID]]:
    ids = {
        "user": generate_id(),
        "organization": generate_id(),
        "channel": generate_id(),
        "agent": generate_id(),
        "trigger": generate_id(),
    }
    return (
        ChatChannelMessageWriter(
            session=session,
            user_id=ids["user"],
            organization_id=ids["organization"],
            channel_id=ids["channel"],
            agent_id=ids["agent"],
            trigger_message_id=ids["trigger"],
        ),
        ids,
    )


async def test_final_agent_message_tracks_channel_resources() -> None:
    session = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    writer, ids = _writer(session)
    urn = f"urn:uniffy:content:NOTE:{generate_id()}"
    content = f"Updated [[[Runbook|{urn}]]]"

    with (
        patch(
            "uniffy.domains.agents.runtime.writers.bump_channel_message_stats",
            AsyncMock(),
        ),
        patch(
            "uniffy.domains.agents.runtime.writers.track_agent_message_resources",
            AsyncMock(),
        ) as track,
    ):
        await writer.add_message(role=AgentMessageRole.ASSISTANT, content=content)

    track.assert_awaited_once_with(session, ids["channel"], content, ids["user"])


async def test_tool_message_does_not_track_channel_resources() -> None:
    session = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    writer, _ = _writer(session)
    urn = f"urn:uniffy:content:NOTE:{generate_id()}"

    with (
        patch(
            "uniffy.domains.agents.runtime.writers.bump_channel_message_stats",
            AsyncMock(),
        ),
        patch(
            "uniffy.domains.agents.runtime.writers.track_agent_message_resources",
            AsyncMock(),
        ) as track,
    ):
        await writer.add_message(
            role=AgentMessageRole.TOOL,
            content=f"Loaded [[[Runbook|{urn}]]]",
            tool_call_id="call-1",
        )

    track.assert_not_awaited()


async def test_finalized_placeholder_tracks_channel_resources() -> None:
    session = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    writer, ids = _writer(session)
    message_id = generate_id()
    row = ChatMessage(
        id=message_id,
        channel_id=ids["channel"],
        sender_id=ids["agent"],
        content="",
        message_metadata={"kind": "final", "streaming": True},
    )
    session.get = AsyncMock(return_value=row)
    urn = f"urn:uniffy:content:NOTE:{generate_id()}"
    content = f"Updated [[[Runbook|{urn}]]]"

    with patch(
        "uniffy.domains.agents.runtime.writers.track_agent_message_resources",
        AsyncMock(),
    ) as track:
        await writer.finalize_assistant_placeholder(message_id=message_id, content=content)

    track.assert_awaited_once_with(session, ids["channel"], content, ids["user"])
    assert row.mentioned_urns == [urn]
