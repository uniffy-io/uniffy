"""Thread reply bookkeeping: which rows count, and who is recorded on them."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.chat.thread import ChatThread, ChatThreadStats
from uniffy.core.models.chat.thread_follow import ChatThreadFollow
from uniffy.core.types import generate_id
from uniffy.domains.chat.messages.operations import counts_as_thread_reply, record_thread_reply

CHANNEL = generate_id()
ROOT = generate_id()
NOW = datetime.now(UTC)


def _message(sender_type: SenderType, *, kind: str | None = None, root_id=ROOT) -> ChatMessage:
    return ChatMessage(
        channel_id=CHANNEL,
        sender_id=generate_id(),
        sender_type=sender_type,
        content="",
        root_id=root_id,
        message_metadata={"kind": kind} if kind else None,
    )


def _session(*, thread: ChatThread | None) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=thread)
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    session.flush = AsyncMock()
    session.add = MagicMock()
    return session


def _added(session: MagicMock, model_type: type) -> list:
    return [c.args[0] for c in session.add.call_args_list if isinstance(c.args[0], model_type)]


class TestCountsAsThreadReply:
    def test_channel_message_never_counts(self) -> None:
        assert not counts_as_thread_reply(_message(SenderType.USER, root_id=None))

    def test_user_reply_counts(self) -> None:
        assert counts_as_thread_reply(_message(SenderType.USER))

    def test_agent_answer_counts(self) -> None:
        assert counts_as_thread_reply(_message(SenderType.AGENT, kind="final"))

    def test_agent_error_and_skill_draft_count(self) -> None:
        assert counts_as_thread_reply(_message(SenderType.AGENT, kind="agent_error"))
        assert counts_as_thread_reply(_message(SenderType.AGENT, kind="skill_draft"))

    def test_agent_tool_steps_and_summaries_do_not_count(self) -> None:
        for kind in ("tool_call", "tool_result", "summary"):
            assert not counts_as_thread_reply(_message(SenderType.AGENT, kind=kind))

    def test_agent_row_without_a_kind_does_not_count(self) -> None:
        assert not counts_as_thread_reply(_message(SenderType.AGENT))


class TestRecordThreadReply:
    async def test_agent_reply_writes_no_follow(self) -> None:
        session = _session(thread=ChatThread(root_message_id=ROOT, channel_id=CHANNEL))

        await record_thread_reply(
            session,
            root_message_id=ROOT,
            channel_id=CHANNEL,
            sender_type=SenderType.AGENT,
            sender_id=generate_id(),
            at=NOW,
        )

        # Thread lookup, counter bump, participant upsert - and no follow.
        assert session.execute.await_count == 3

    async def test_user_reply_follows_the_thread(self) -> None:
        session = _session(thread=ChatThread(root_message_id=ROOT, channel_id=CHANNEL))

        await record_thread_reply(
            session,
            root_message_id=ROOT,
            channel_id=CHANNEL,
            sender_type=SenderType.USER,
            sender_id=generate_id(),
            at=NOW,
        )

        assert session.execute.await_count == 4

    async def test_first_reply_creates_the_thread_and_its_counter(self) -> None:
        session = _session(thread=None)

        await record_thread_reply(
            session,
            root_message_id=ROOT,
            channel_id=CHANNEL,
            sender_type=SenderType.AGENT,
            sender_id=generate_id(),
            at=NOW,
        )

        assert len(_added(session, ChatThread)) == 1
        stats = _added(session, ChatThreadStats)
        assert [(s.reply_count, s.last_reply_at) for s in stats] == [(1, NOW)]

    async def test_root_author_auto_follows_only_on_a_human_root(self) -> None:
        agent_root = ChatMessage(
            channel_id=CHANNEL,
            sender_id=generate_id(),
            sender_type=SenderType.AGENT,
            content="",
        )
        session = _session(thread=None)

        await record_thread_reply(
            session,
            root_message_id=ROOT,
            channel_id=CHANNEL,
            sender_type=SenderType.USER,
            sender_id=generate_id(),
            at=NOW,
            root_message=agent_root,
        )

        assert _added(session, ChatThreadFollow) == []

    async def test_human_root_author_is_auto_followed(self) -> None:
        author = generate_id()
        human_root = ChatMessage(
            channel_id=CHANNEL,
            sender_id=author,
            sender_type=SenderType.USER,
            content="",
        )
        session = _session(thread=None)

        await record_thread_reply(
            session,
            root_message_id=ROOT,
            channel_id=CHANNEL,
            sender_type=SenderType.USER,
            sender_id=generate_id(),
            at=NOW,
            root_message=human_root,
        )

        assert [f.user_id for f in _added(session, ChatThreadFollow)] == [author]
