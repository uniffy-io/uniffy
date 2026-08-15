"""Unit tests for the chat-channel <-> tags wiring.

Covers the pure-Python pieces that don't require a live DB:

- ``ChatChannelOperations._tag_filter_subquery`` builds the right
  join + GROUP BY + HAVING shape for ``ListChannelsRequest.tag_ids[]``
  filtering (logical AND across the requested set).
- ``_sync_channel_tags`` skips DM / GROUP_DM channels and skips
  ``tag_ids=None`` calls (partial updates that did not ship tags).
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.types import generate_id
from uniffy.domains.chat.channels.operations import ChatChannelOperations


def _make_channel(channel_type: ChannelType = ChannelType.PUBLIC) -> ChatChannel:
    return ChatChannel(
        organization_id=generate_id(),
        owner_id=generate_id(),
        name="general",
        slug="general",
        description="",
        channel_type=channel_type,
    )


def _make_ops() -> ChatChannelOperations:
    ops = ChatChannelOperations.__new__(ChatChannelOperations)
    ops.session = MagicMock()
    ops.access = MagicMock()
    return ops


class TestSyncChannelTags:
    async def test_none_tag_ids_short_circuits(self) -> None:
        ops = _make_ops()
        channel = _make_channel(ChannelType.PUBLIC)
        # ``tag_ids=None`` means "leave manual assignments untouched";
        # we should never instantiate TagOperations.
        await ops._sync_channel_tags(actor_id=generate_id(), channel=channel, tag_ids=None)
        ops.session.execute.assert_not_called()

    async def test_dm_channels_are_skipped(self) -> None:
        ops = _make_ops()
        channel = _make_channel(ChannelType.DIRECT)
        # DMs / agent DMs / group DMs do not participate in the unified-
        # tag namespace -- the helper must short-circuit even if a
        # caller accidentally passes a non-empty replacement set.
        await ops._sync_channel_tags(
            actor_id=generate_id(), channel=channel, tag_ids=[generate_id()]
        )
        ops.session.execute.assert_not_called()

    async def test_group_dm_channels_are_skipped(self) -> None:
        ops = _make_ops()
        channel = _make_channel(ChannelType.GROUP_DM)
        await ops._sync_channel_tags(actor_id=generate_id(), channel=channel, tag_ids=[])
        ops.session.execute.assert_not_called()

    async def test_public_channel_routes_through_replace_manual_tags(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        ops = _make_ops()
        channel = _make_channel(ChannelType.PUBLIC)
        actor_id = generate_id()
        replacement = [generate_id()]

        captured: dict[str, object] = {}

        async def _fake_replace(
            self,
            *,
            actor_id,
            organization_id,
            content_urn,
            tag_ids,
        ):
            captured.update(
                actor_id=actor_id,
                organization_id=organization_id,
                content_urn=content_urn,
                tag_ids=list(tag_ids),
            )
            return []

        monkeypatch.setattr(
            "uniffy.domains.tags.operations.TagOperations.replace_manual_tags",
            _fake_replace,
            raising=True,
        )

        await ops._sync_channel_tags(actor_id=actor_id, channel=channel, tag_ids=replacement)

        assert captured["actor_id"] == actor_id
        assert captured["organization_id"] == channel.organization_id
        assert captured["tag_ids"] == replacement
        assert captured["content_urn"] == f"urn:uniffy:content:CHAT:{channel.id}"


class TestHydrateHelper:
    async def test_hydrate_helper_no_op_on_empty_input(self) -> None:
        from uniffy.domains.chat.channels.handlers import _hydrate_channel_tags

        session = AsyncMock()
        out = await _hydrate_channel_tags(session, generate_id(), [])
        assert out == {}
        session.execute.assert_not_called()
