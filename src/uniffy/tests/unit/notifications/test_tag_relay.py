"""Unit tests for ``TagEventRelay``.

The relay sits between the org-wide ``tags:{org_id}`` Valkey channel
and the per-recipient ``MENTION_STATE_CHANGED`` stream. It is the only
place the privacy filter for tag-assignment events lives.

Tests cover the projection contract: which events become how many
relay outputs, with what visibility decision. Database / Valkey
interactions are stubbed via ``AsyncMock``.
"""

from unittest.mock import AsyncMock

from uniffy.core.types import ContentType, generate_id
from uniffy.domains.notifications.tag_relay import (
    TagEventRelay,
    _normalize_tag_state,
)


def _make_relay() -> TagEventRelay:
    relay = TagEventRelay(generate_id(), generate_id())
    relay._can_view_content = AsyncMock(return_value=True)
    relay._tag_visible = AsyncMock(return_value=True)
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
        result = await relay.project(
            {
                "_type": "tag.assignment.changed",
                "payload": {
                    "content_urn": f"urn:uniffy:content:NOTE:{generate_id()}",
                    "content_type": ContentType.NOTE.value,
                    "added": [str(generate_id())],
                    "removed": [],
                },
            }
        )
        assert result == []
        relay._can_view_content.assert_awaited_once()

    async def test_assignment_changed_emits_content_urn_delta(self) -> None:
        relay = _make_relay()
        added = [str(generate_id()), str(generate_id())]
        removed = [str(generate_id())]
        content_urn = f"urn:uniffy:content:NOTE:{generate_id()}"
        result = await relay.project(
            {
                "_type": "tag.assignment.changed",
                "payload": {
                    "content_urn": content_urn,
                    "content_type": ContentType.NOTE.value,
                    "added": added,
                    "removed": removed,
                },
            }
        )
        assert len(result) == 1
        assert result[0]["urn"] == content_urn
        assert result[0]["tag_assignments_added"] == ",".join(added)
        assert result[0]["tag_assignments_removed"] == ",".join(removed)

    async def test_assignment_changed_skips_when_no_delta(self) -> None:
        relay = _make_relay()
        result = await relay.project(
            {
                "_type": "tag.assignment.changed",
                "payload": {
                    "content_urn": f"urn:uniffy:content:NOTE:{generate_id()}",
                    "content_type": ContentType.NOTE.value,
                    "added": [],
                    "removed": [],
                },
            }
        )
        assert result == []

    async def test_tag_deleted_emits_tombstone_for_all(self) -> None:
        relay = _make_relay()
        tag_id = generate_id()
        result = await relay.project(
            {
                "_type": "tag.deleted",
                "payload": {"tag_id": str(tag_id)},
            }
        )
        assert len(result) == 1
        assert result[0]["urn_status"] == "DELETED"
        assert result[0]["urn"] == f"urn:uniffy:content:TAG:{tag_id}"

    async def test_tag_updated_filters_invisible_tag(self) -> None:
        relay = _make_relay()
        relay._tag_visible = AsyncMock(return_value=False)
        tag_id = generate_id()
        result = await relay.project(
            {
                "_type": "tag.updated",
                "payload": {
                    "tag": {
                        "id": str(tag_id),
                        "urn": f"urn:uniffy:content:TAG:{tag_id}",
                        "name": "secret",
                    }
                },
            }
        )
        assert result == []
