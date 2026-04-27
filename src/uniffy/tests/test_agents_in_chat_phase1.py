"""Phase 1 unit tests for agents-in-chat integration.

Covers the pure-logic pieces: ChatSubject dedup + sort, SenderResolver
branching + cache, mention_detector rule matrix, feature flag parsing.
No live DB -- AsyncMock for session wherever a query is issued. The test
file uses `asyncio.run` directly because the repo's test harness doesn't
carry a pytest-asyncio plugin.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from uniffy.core.models.chat.channel import ChannelType
from uniffy.core.models.chat.message import SenderType
from uniffy.core.types import SubjectType
from uniffy.core.types import generate_id as uuid7
from uniffy.domains.agents.chat_integration.mention_detector import (
    detect_agent_mentions,
)
from uniffy.domains.chat.feature_flags import is_chat_agents_enabled_on
from uniffy.domains.chat.sender_resolver import SenderInfo, SenderResolver
from uniffy.domains.chat.subjects import ChatSubject


def _run(coro):
    """Run an awaitable in a fresh event loop (no pytest-asyncio dep)."""
    return asyncio.run(coro)


def _fake_user_row(
    uid: UUID, name: str, avatar: str | None = None, username: str = ""
):
    return (uid, name, avatar, username)


def _fake_agent_row(aid: UUID, name: str, avatar_key: str | None, emoji: str | None):
    return (aid, name, avatar_key, emoji)


class _FakeResult:
    """Minimal async-result shim supporting .all() and .one_or_none()."""

    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def one_or_none(self):
        return self._rows[0] if self._rows else None


class TestChatSubject:
    def test_user_and_agent_constructors(self) -> None:
        uid = uuid7()
        aid = uuid7()
        assert ChatSubject.user(uid) == ChatSubject(SubjectType.USER, uid)
        assert ChatSubject.agent(aid) == ChatSubject(SubjectType.AGENT, aid)

    def test_as_key_matches_pk_order(self) -> None:
        uid = uuid7()
        s = ChatSubject.user(uid)
        assert s.as_key == ("USER", uid)

    def test_set_dedup_by_identity(self) -> None:
        uid = uuid7()
        subjects = {ChatSubject.user(uid), ChatSubject.user(uid)}
        assert len(subjects) == 1

    def test_sort_stable(self) -> None:
        a = ChatSubject(SubjectType.AGENT, UUID(int=1))
        b = ChatSubject(SubjectType.USER, UUID(int=2))
        ordered = sorted([b, a], key=lambda s: s.as_key)
        # "AGENT" < "USER" lexicographically
        assert ordered[0] == a
        assert ordered[1] == b


class TestFeatureFlag:
    def test_missing_settings_returns_false(self) -> None:
        org = MagicMock()
        org.settings = None
        assert is_chat_agents_enabled_on(org) is False

    def test_missing_chat_key_returns_false(self) -> None:
        org = MagicMock()
        org.settings = {"notes": {"x": True}}
        assert is_chat_agents_enabled_on(org) is False

    def test_flag_on(self) -> None:
        org = MagicMock()
        org.settings = {"chat": {"agents_enabled": True}}
        assert is_chat_agents_enabled_on(org) is True

    def test_flag_explicit_false(self) -> None:
        org = MagicMock()
        org.settings = {"chat": {"agents_enabled": False}}
        assert is_chat_agents_enabled_on(org) is False


class TestSenderResolver:
    def test_resolve_many_splits_user_and_agent(self) -> None:
        session = MagicMock()
        uid = uuid7()
        aid = uuid7()

        async def fake_execute(stmt):
            txt = str(stmt)
            if "login_users" in txt:
                return _FakeResult([_fake_user_row(uid, "Alice", "avatar/a")])
            return _FakeResult([_fake_agent_row(aid, "Writer", None, ":robot:")])

        session.execute = AsyncMock(side_effect=fake_execute)
        resolver = SenderResolver(session)

        async def go():
            return await resolver.resolve_many([(SenderType.USER, uid), (SenderType.AGENT, aid)])

        out = _run(go())
        assert out[uid].display_name == "Alice"
        assert out[aid].display_name == "Writer"
        assert out[aid].avatar_emoji == ":robot:"
        # One query per type, not per sender.
        assert session.execute.await_count == 2

    def test_cache_hit_skips_second_query(self) -> None:
        session = MagicMock()
        uid = uuid7()
        session.execute = AsyncMock(return_value=_FakeResult([_fake_user_row(uid, "Alice")]))
        resolver = SenderResolver(session)

        async def go():
            await resolver.resolve_many([(SenderType.USER, uid)])
            await resolver.resolve_many([(SenderType.USER, uid)])

        _run(go())
        assert session.execute.await_count == 1

    def test_missing_sender_returns_fallback(self) -> None:
        session = MagicMock()
        session.execute = AsyncMock(return_value=_FakeResult([]))
        resolver = SenderResolver(session)

        info = _run(resolver.resolve_one(SenderType.USER, uuid7()))
        assert isinstance(info, SenderInfo)
        assert info.display_name == "Unknown"

    def test_empty_refs_no_queries(self) -> None:
        session = MagicMock()
        session.execute = AsyncMock()
        resolver = SenderResolver(session)

        out = _run(resolver.resolve_many([]))
        assert out == {}
        assert session.execute.await_count == 0


class TestMentionDetector:
    def test_non_user_trigger_returns_empty(self) -> None:
        message = MagicMock()
        message.sender_type = SenderType.AGENT
        channel = MagicMock()
        session = MagicMock()

        out = _run(detect_agent_mentions(session, message, channel))
        assert out == []

    def test_no_agent_members_returns_empty(self) -> None:
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = None
        channel = MagicMock()
        channel.id = uuid7()
        session = MagicMock()
        session.execute = AsyncMock(return_value=_FakeResult([]))

        out = _run(detect_agent_mentions(session, message, channel))
        assert out == []

    def test_dm_rule_when_solo_agent_member(self) -> None:
        aid = uuid7()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = None
        message.reply_to_id = None
        message.root_id = None
        channel = MagicMock()
        channel.id = uuid7()
        channel.channel_type = ChannelType.DIRECT
        session = MagicMock()
        session.execute = AsyncMock(return_value=_FakeResult([(aid,)]))

        out = _run(detect_agent_mentions(session, message, channel))
        assert [(m.agent_id, m.rule) for m in out] == [(aid, "dm")]

    def test_mention_rule_matches_channel_member(self) -> None:
        member_aid = uuid7()
        other_aid = uuid7()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = [member_aid, other_aid]
        message.reply_to_id = None
        message.root_id = None
        channel = MagicMock()
        channel.id = uuid7()
        channel.channel_type = ChannelType.PUBLIC
        session = MagicMock()
        session.execute = AsyncMock(return_value=_FakeResult([(member_aid,)]))

        out = _run(detect_agent_mentions(session, message, channel))
        assert len(out) == 1
        assert out[0].agent_id == member_aid
        assert out[0].rule == "mention"

    def test_reply_rule_fires_without_re_mention(self) -> None:
        agent_id = uuid7()
        parent_id = uuid7()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = None
        message.reply_to_id = parent_id
        message.root_id = None
        channel = MagicMock()
        channel.id = uuid7()
        channel.channel_type = ChannelType.PRIVATE

        async def fake_execute(stmt):
            txt = str(stmt)
            if "chat_channel_members" in txt:
                return _FakeResult([(agent_id,)])
            return _FakeResult([(SenderType.AGENT, agent_id)])

        session = MagicMock()
        session.execute = AsyncMock(side_effect=fake_execute)

        out = _run(detect_agent_mentions(session, message, channel))
        assert [(m.agent_id, m.rule) for m in out] == [(agent_id, "reply")]

    def test_reply_rule_not_fired_for_non_member_parent(self) -> None:
        non_member = uuid7()
        member = uuid7()
        parent_id = uuid7()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = None
        message.reply_to_id = parent_id
        message.root_id = None
        channel = MagicMock()
        channel.id = uuid7()
        channel.channel_type = ChannelType.PRIVATE

        async def fake_execute(stmt):
            txt = str(stmt)
            if "chat_channel_members" in txt:
                return _FakeResult([(member,)])
            return _FakeResult([(SenderType.AGENT, non_member)])

        session = MagicMock()
        session.execute = AsyncMock(side_effect=fake_execute)

        out = _run(detect_agent_mentions(session, message, channel))
        assert out == []

    def test_mention_and_dm_do_not_duplicate(self) -> None:
        aid = uuid7()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = [aid]
        message.reply_to_id = None
        message.root_id = None
        channel = MagicMock()
        channel.id = uuid7()
        channel.channel_type = ChannelType.DIRECT
        session = MagicMock()
        session.execute = AsyncMock(return_value=_FakeResult([(aid,)]))

        out = _run(detect_agent_mentions(session, message, channel))
        # DM rule wins the first pass; mention rule skips because the
        # agent is already matched.
        assert len(out) == 1
        assert out[0].rule == "dm"

    def test_thread_rule_fires_when_root_is_agent(self) -> None:
        agent_id = uuid7()
        root_id = uuid7()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = None
        message.reply_to_id = None
        message.root_id = root_id
        channel = MagicMock()
        channel.id = uuid7()
        channel.channel_type = ChannelType.PRIVATE

        async def fake_execute(stmt):
            txt = str(stmt)
            if "chat_channel_members" in txt:
                return _FakeResult([(agent_id,)])
            return _FakeResult([(SenderType.AGENT, agent_id)])

        session = MagicMock()
        session.execute = AsyncMock(side_effect=fake_execute)

        out = _run(detect_agent_mentions(session, message, channel))
        assert [(m.agent_id, m.rule) for m in out] == [(agent_id, "thread")]


# Silence a `pytest` unused-import warning from test discovery tooling.
_ = pytest
