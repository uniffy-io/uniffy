"""What an agent reads, and what a thread reply does to its counters."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from uniffy.core.models.chat.message import SenderType
from uniffy.core.models.chat.thread import ChatThreadParticipant, ChatThreadStats
from uniffy.core.models.chat.thread_follow import ChatThreadFollow
from uniffy.core.types import SubjectType
from uniffy.domains.agents.runtime.writers import ChatChannelMessageWriter
from uniffy.domains.chat.threads.replies import drop_thread_reply, record_thread_reply

pytestmark = pytest.mark.asyncio(loop_scope="session")

NOW = datetime(2026, 8, 4, 10, 0, tzinfo=UTC)
ASSISTANT_ROLE = "assistant"
USER_ROLE = "user"
AGENT_REPLY_CONTENT = "answer in A"


def _writer(session, threads, *, thread_root_id=None) -> ChatChannelMessageWriter:
    return ChatChannelMessageWriter(
        session=session,
        user_id=threads.user_id,
        organization_id=threads.org_id,
        channel_id=threads.channel_id,
        agent_id=threads.agent_id,
        trigger_message_id=threads.reply_a_user_id,
        thread_root_id=thread_root_id,
    )


async def _context_ids(session, threads, *, thread_root_id=None) -> list:
    writer = _writer(session, threads, thread_root_id=thread_root_id)
    envelopes, _ = await writer.load_context_messages(token_budget=100_000)
    return [e.id for e in envelopes]


class TestThreadScopedContext:
    async def test_thread_turn_reads_its_own_branch(self, session, threads) -> None:
        ids = await _context_ids(session, threads, thread_root_id=threads.root_a_id)

        assert ids == [
            threads.channel_first_id,
            threads.channel_second_id,
            threads.root_a_id,
            threads.reply_a_user_id,
            threads.reply_a_agent_id,
        ]

    async def test_thread_turn_excludes_the_sibling_thread(self, session, threads) -> None:
        ids = await _context_ids(session, threads, thread_root_id=threads.root_a_id)

        assert threads.root_b_id not in ids
        assert threads.reply_b_user_id not in ids

    async def test_thread_turn_stops_the_lead_in_at_the_root(self, session, threads) -> None:
        ids = await _context_ids(session, threads, thread_root_id=threads.root_a_id)

        # Channel talk that happened after the thread opened belongs to the channel.
        assert threads.channel_last_id not in ids

    async def test_channel_turn_reads_root_messages_only(self, session, threads) -> None:
        ids = await _context_ids(session, threads)

        assert ids == [
            threads.channel_first_id,
            threads.channel_second_id,
            threads.root_a_id,
            threads.root_b_id,
            threads.channel_last_id,
        ]

    async def test_own_rows_stay_assistant_and_others_are_named(self, session, threads) -> None:
        writer = _writer(session, threads, thread_root_id=threads.root_a_id)
        envelopes, _ = await writer.load_context_messages(token_budget=100_000)
        by_id = {e.id: e for e in envelopes}

        agent_reply = by_id[threads.reply_a_agent_id]
        assert agent_reply.role == ASSISTANT_ROLE
        assert agent_reply.content == AGENT_REPLY_CONTENT

        user_reply = by_id[threads.reply_a_user_id]
        assert user_reply.role == USER_ROLE
        assert user_reply.content.startswith("[Thread Tester]:")


class TestThreadReplyCounters:
    async def _stats(self, session, root_id) -> ChatThreadStats:
        return (
            await session.execute(
                select(ChatThreadStats).where(ChatThreadStats.root_message_id == root_id)
            )
        ).scalar_one()

    async def test_agent_reply_counts_and_joins_as_an_agent_subject(self, session, threads) -> None:
        await record_thread_reply(
            session,
            root_message_id=threads.root_a_id,
            channel_id=threads.channel_id,
            sender_type=SenderType.AGENT,
            sender_id=threads.agent_id,
            at=NOW,
        )
        await session.commit()

        stats = await self._stats(session, threads.root_a_id)
        assert stats.reply_count == 3
        assert stats.last_reply_at == NOW

        participant = (
            await session.execute(
                select(ChatThreadParticipant).where(
                    ChatThreadParticipant.root_message_id == threads.root_a_id,
                    ChatThreadParticipant.subject_id == threads.agent_id,
                )
            )
        ).scalar_one()
        assert participant.subject_type == SubjectType.AGENT
        assert participant.user_id is None

        # Follows drive a user's thread inbox; an agent has no inbox to fill.
        follows = (
            (
                await session.execute(
                    select(ChatThreadFollow).where(
                        ChatThreadFollow.root_message_id == threads.root_a_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert follows == []

    async def test_repeat_replies_count_once_per_reply_and_join_once(self, session, threads) -> None:
        for _ in range(2):
            await record_thread_reply(
                session,
                root_message_id=threads.root_a_id,
                channel_id=threads.channel_id,
                sender_type=SenderType.AGENT,
                sender_id=threads.agent_id,
                at=NOW,
            )
        await session.commit()

        stats = await self._stats(session, threads.root_a_id)
        assert stats.reply_count == 4

        participants = (
            (
                await session.execute(
                    select(ChatThreadParticipant.subject_id).where(
                        ChatThreadParticipant.root_message_id == threads.root_a_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert participants == [threads.agent_id]

    async def test_user_reply_also_follows_the_thread(self, session, threads) -> None:
        await record_thread_reply(
            session,
            root_message_id=threads.root_a_id,
            channel_id=threads.channel_id,
            sender_type=SenderType.USER,
            sender_id=threads.user_id,
            at=NOW,
        )
        await session.commit()

        follows = (
            (
                await session.execute(
                    select(ChatThreadFollow.user_id).where(
                        ChatThreadFollow.root_message_id == threads.root_a_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert follows == [threads.user_id]

    async def test_a_discarded_reply_gives_the_count_back(self, session, threads) -> None:
        await drop_thread_reply(session, threads.root_a_id)
        await session.commit()

        assert (await self._stats(session, threads.root_a_id)).reply_count == 1

    async def test_the_counter_never_goes_negative(self, session, threads) -> None:
        for _ in range(5):
            await drop_thread_reply(session, threads.root_a_id)
        await session.commit()

        assert (await self._stats(session, threads.root_a_id)).reply_count == 0
