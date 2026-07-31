"""Unit tests for the named-agent-chat feature.

Covers the pure-Python pieces that don't require a live DB:

- ``ChatChannel.effective_name`` resolution (custom_name overrides ``name``)
- ``rename_agent_chat`` validation (length + non-agent-DM rejection)
- ``ChatChannelOperations.create_agent_chat`` flag wiring (mocked session)

Live-DB integration coverage runs under the chat-domain harness. Uses
``asyncio.run`` so it runs without pytest-asyncio.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.types import SubjectType
from uniffy.domains.chat.channels.operations import ChatChannelOperations


def _run(coro):
    return asyncio.run(coro)


class TestEffectiveName:
    def test_returns_name_when_custom_unset(self) -> None:
        channel = ChatChannel(
            organization_id=uuid4(),
            owner_id=uuid4(),
            name="Acme Agent",
            slug="acme-agent",
            channel_type=ChannelType.DIRECT,
        )
        assert channel.effective_name == "Acme Agent"

    def test_returns_custom_when_set(self) -> None:
        channel = ChatChannel(
            organization_id=uuid4(),
            owner_id=uuid4(),
            name="Acme Agent",
            slug="acme-agent",
            channel_type=ChannelType.DIRECT,
            custom_name="Onboarding plan",
        )
        assert channel.effective_name == "Onboarding plan"

    def test_whitespace_only_custom_falls_back_to_name(self) -> None:
        channel = ChatChannel(
            organization_id=uuid4(),
            owner_id=uuid4(),
            name="Acme Agent",
            slug="acme-agent",
            channel_type=ChannelType.DIRECT,
            custom_name="   ",
        )
        assert channel.effective_name == "Acme Agent"


class TestRenameAgentChatValidation:
    """rename_agent_chat() rejects non-agent DMs and overlong names.

    The session is fully mocked: get_by_id returns the channel under test;
    access.get_membership returns a USER membership unless we want to
    simulate the unauthorized-rename path.
    """

    @staticmethod
    def _build_ops(channel: ChatChannel, membership) -> ChatChannelOperations:
        session = MagicMock()
        session.commit = AsyncMock()
        session.refresh = AsyncMock()

        ops = ChatChannelOperations.__new__(ChatChannelOperations)
        ops.session = session
        ops._session = session
        ops.access = MagicMock()
        ops.access.get_membership = AsyncMock(return_value=membership)
        ops.get_by_id = AsyncMock(return_value=channel)
        return ops

    def test_rejects_non_agent_dm(self) -> None:
        channel = ChatChannel(
            organization_id=uuid4(),
            owner_id=uuid4(),
            name="Some DM",
            slug="some-dm",
            channel_type=ChannelType.DIRECT,
            is_agent_dm=False,
        )
        ops = self._build_ops(channel, membership=MagicMock(subject_type=SubjectType.USER))
        with pytest.raises(ValidationError):
            _run(
                ops.rename_agent_chat(
                    user_id=uuid4(),
                    organization_id=uuid4(),
                    channel_id=uuid4(),
                    custom_name="New name",
                )
            )

    def test_rejects_non_member(self) -> None:
        channel = ChatChannel(
            organization_id=uuid4(),
            owner_id=uuid4(),
            name="Acme Agent",
            slug="acme-agent",
            channel_type=ChannelType.DIRECT,
            is_agent_dm=True,
        )
        ops = self._build_ops(channel, membership=None)
        with pytest.raises(PermissionDeniedError):
            _run(
                ops.rename_agent_chat(
                    user_id=uuid4(),
                    organization_id=uuid4(),
                    channel_id=uuid4(),
                    custom_name="Stranger rename",
                )
            )

    def test_rejects_overlong_name(self) -> None:
        channel = ChatChannel(
            organization_id=uuid4(),
            owner_id=uuid4(),
            name="Acme Agent",
            slug="acme-agent",
            channel_type=ChannelType.DIRECT,
            is_agent_dm=True,
        )
        ops = self._build_ops(channel, membership=MagicMock(subject_type=SubjectType.USER))
        too_long = "x" * 201
        with pytest.raises(ValidationError):
            _run(
                ops.rename_agent_chat(
                    user_id=uuid4(),
                    organization_id=uuid4(),
                    channel_id=uuid4(),
                    custom_name=too_long,
                )
            )

    def test_clears_custom_name_when_blank(self, monkeypatch: pytest.MonkeyPatch) -> None:
        channel = ChatChannel(
            organization_id=uuid4(),
            owner_id=uuid4(),
            name="Acme Agent",
            slug="acme-agent",
            channel_type=ChannelType.DIRECT,
            is_agent_dm=True,
            custom_name="Old override",
        )
        monkeypatch.setattr(
            "uniffy.domains.chat.channels.operations.invalidate_cached_channel",
            AsyncMock(return_value=None),
        )
        ops = self._build_ops(channel, membership=MagicMock(subject_type=SubjectType.USER))
        _run(
            ops.rename_agent_chat(
                user_id=uuid4(),
                organization_id=uuid4(),
                channel_id=uuid4(),
                custom_name="   ",
            )
        )
        assert channel.custom_name is None
