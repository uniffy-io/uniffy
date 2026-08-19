"""Tag and mention-state recipient projection tests."""

from unittest.mock import AsyncMock

import pytest

from uniffy.core.types import ContentType, generate_id
from uniffy.domains.notifications.tag_relay import (
    TagEventRelay,
    _normalize_tag_state,
)


def _make_relay() -> TagEventRelay:
    relay = TagEventRelay(generate_id(), generate_id())
    relay._can_view_content = AsyncMock(return_value=True)
    relay._tag_visible = AsyncMock(return_value=True)
    relay._is_active_recipient = AsyncMock(return_value=True)
    return relay


class TestNormalizeTagState:
    def test_drops_none_values(self) -> None:
        out = _normalize_tag_state({"slug": "docs", "color": None})
        assert out == {"slug": "docs"}

    def test_coerces_numbers_to_string(self) -> None:
        out = _normalize_tag_state({"usage_count": 42})
        assert out == {"usage_count": "42"}


class TestProjection:
    async def test_assignment_changed_skips_when_content_not_viewable(self) -> None:
        relay = _make_relay()
        relay._can_view_content = AsyncMock(return_value=False)
        result = await relay.project({
            "_type": "tag.assignment.changed",
            "payload": {
                "content_urn": f"urn:uniffy:content:NOTE:{generate_id()}",
                "content_type": ContentType.NOTE.value,
                "added": [str(generate_id())],
                "removed": [],
            },
        })
        assert result == []
        relay._can_view_content.assert_awaited_once()

    async def test_assignment_changed_emits_content_urn_delta(self) -> None:
        relay = _make_relay()
        added = [str(generate_id()), str(generate_id())]
        removed = [str(generate_id())]
        content_urn = f"urn:uniffy:content:NOTE:{generate_id()}"
        result = await relay.project({
            "_type": "tag.assignment.changed",
            "payload": {
                "content_urn": content_urn,
                "content_type": ContentType.NOTE.value,
                "added": added,
                "removed": removed,
            },
        })
        assert len(result) == 1
        assert result[0]["urn"] == content_urn
        assert result[0]["tag_assignments_added"] == ",".join(added)
        assert result[0]["tag_assignments_removed"] == ",".join(removed)

    async def test_assignment_changed_skips_when_no_delta(self) -> None:
        relay = _make_relay()
        result = await relay.project({
            "_type": "tag.assignment.changed",
            "payload": {
                "content_urn": f"urn:uniffy:content:NOTE:{generate_id()}",
                "content_type": ContentType.NOTE.value,
                "added": [],
                "removed": [],
            },
        })
        assert result == []

    async def test_tag_deleted_emits_tombstone_for_all(self) -> None:
        relay = _make_relay()
        tag_id = generate_id()
        result = await relay.project({
            "_type": "tag.deleted",
            "payload": {"tag_id": str(tag_id)},
        })
        assert len(result) == 1
        assert result[0]["urn_status"] == "DELETED"
        assert result[0]["urn"] == f"urn:uniffy:content:TAG:{tag_id}"

    async def test_tag_updated_filters_invisible_tag(self) -> None:
        relay = _make_relay()
        relay._tag_visible = AsyncMock(return_value=False)
        tag_id = generate_id()
        result = await relay.project({
            "_type": "tag.updated",
            "payload": {
                "tag": {
                    "id": str(tag_id),
                    "urn": f"urn:uniffy:content:TAG:{tag_id}",
                    "name": "secret",
                }
            },
        })
        assert result == []


class TestMentionStateGate:
    async def test_forwards_when_recipient_can_view(self) -> None:
        relay = _make_relay()
        urn = f"urn:uniffy:content:FOLDER:{generate_id()}"
        assert await relay.allows_mention_state({"urn": urn}) is True
        relay._can_view_content.assert_awaited_once_with(
            ContentType.FOLDER, relay._can_view_content.await_args.args[1]
        )

    async def test_drops_when_recipient_cannot_view(self) -> None:
        relay = _make_relay()
        relay._can_view_content = AsyncMock(return_value=False)
        urn = f"urn:uniffy:content:FOLDER:{generate_id()}"
        assert await relay.allows_mention_state({"urn": urn}) is False

    async def test_drops_malformed_urn(self) -> None:
        relay = _make_relay()
        assert await relay.allows_mention_state({"urn": "urn:uniffy:content:FOLDER"}) is False
        assert await relay.allows_mention_state({"urn": ""}) is False
        assert await relay.allows_mention_state({}) is False
        relay._can_view_content.assert_not_awaited()

    async def test_fails_closed_when_permission_check_errors(self) -> None:
        relay = _make_relay()
        relay._can_view_content = AsyncMock(side_effect=RuntimeError("valkey down"))
        urn = f"urn:uniffy:content:ROOM:{generate_id()}"
        assert await relay.allows_mention_state({"urn": urn}) is False

    async def test_drops_directory_event_without_current_access(self) -> None:
        relay = _make_relay()
        relay._can_view_content = AsyncMock(return_value=False)
        urn = f"urn:uniffy:content:USER:{generate_id()}"

        assert await relay.allows_mention_state({"urn": urn}) is False
        relay._can_view_content.assert_awaited_once()

    async def test_user_and_team_state_is_visible_to_active_members(self) -> None:
        relay = _make_relay()

        for content_type in (ContentType.USER, ContentType.TEAM):
            urn = f"urn:uniffy:content:{content_type.value}:{generate_id()}"
            assert await relay.allows_mention_state({"urn": urn}) is True

        assert relay._can_view_content.await_count == 2

    async def test_type_only_tombstone_does_not_require_current_access(self) -> None:
        relay = _make_relay()
        relay._can_view_content = AsyncMock(return_value=False)
        urn = f"urn:uniffy:content:NOTE:{generate_id()}"

        assert (
            await relay.allows_mention_state(
                {"urn": urn, "changes": {"urn_status": "DELETED"}}
            )
            is True
        )
        relay._can_view_content.assert_not_awaited()
        relay._is_active_recipient.assert_awaited_once()

    async def test_tombstone_with_extra_metadata_still_requires_access(self) -> None:
        relay = _make_relay()
        relay._can_view_content = AsyncMock(return_value=False)
        urn = f"urn:uniffy:content:NOTE:{generate_id()}"

        assert (
            await relay.allows_mention_state(
                {
                    "urn": urn,
                    "changes": {"urn_status": "DELETED", "name": "private"},
                }
            )
            is False
        )
