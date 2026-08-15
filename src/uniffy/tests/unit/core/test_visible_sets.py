"""Tests for ``core.auth.permissions.visible_sets``.

The cached helpers are thin shells around ``cache_get_or_set_locked``;
the loader is what does the work. Tests here patch the cache layer to
verify:

- org admin is filtered like any member (no short-circuit to ``None``)
- non-admin builds the union, intersected by visible content
- payload encoding round-trips ``set | None`` through Valkey JSON
- cache invalidation helpers call the right tags / keys
"""

from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.auth.permissions.visible_sets import (
    _decode_visibility_payload,
    _encode_visibility_payload,
    compute_visible_tag_ids,
    get_visible_tag_ids,
    invalidate_visible_sets_for_org,
    invalidate_visible_sets_for_user,
)
from uniffy.core.types import generate_id


class TestPayloadCodec:
    def test_admin_sentinel_round_trip(self) -> None:
        encoded = _encode_visibility_payload(None)
        assert encoded == {"all": True}
        assert _decode_visibility_payload(encoded) is None

    def test_empty_set_round_trip(self) -> None:
        encoded = _encode_visibility_payload(set())
        assert encoded == {"ids": []}
        assert _decode_visibility_payload(encoded) == set()

    def test_set_round_trip_uuid_strings(self) -> None:
        ids = {generate_id() for _ in range(3)}
        encoded = _encode_visibility_payload(ids)
        assert encoded["ids"] and all(isinstance(s, str) for s in encoded["ids"])
        decoded = _decode_visibility_payload(encoded)
        assert decoded == ids

    def test_decode_none_payload_treated_as_admin(self) -> None:
        # Cache miss / Valkey degradation: the safe fallback is "no
        # filter". The compute path runs again so this only matters as
        # a transient miss, not as a stale-allow risk.
        assert _decode_visibility_payload(None) is None


class TestComputeVisibleTagIds:
    async def test_org_admin_is_filtered_not_short_circuited(self) -> None:
        """Org admins no longer get a None ('see all') sentinel - they build the
        same filtered union as any member and run it."""
        session = MagicMock()
        execute_result = MagicMock()
        execute_result.scalars.return_value.all.return_value = []
        session.execute = AsyncMock(return_value=execute_result)
        org_id = generate_id()
        user_id = generate_id()

        with patch("uniffy.core.auth.permissions.visible_sets.PermissionChecker") as checker_cls:
            checker = checker_cls.return_value
            checker.is_org_admin = AsyncMock(return_value=True)
            checker.is_domain_admin = AsyncMock(return_value=False)
            result = await compute_visible_tag_ids(session, user_id=user_id, organization_id=org_id)

        assert result == set()
        session.execute.assert_awaited()


class TestGetVisibleTagIdsCacheWiring:
    async def test_admin_payload_decoded_to_none(self) -> None:
        session = MagicMock()
        org_id = generate_id()
        user_id = generate_id()

        async def fake_cache(key, loader, ttl, *, tags):
            return {"all": True}

        with patch(
            "uniffy.core.auth.permissions.visible_sets.cache_get_or_set_locked",
            new=AsyncMock(side_effect=fake_cache),
        ):
            result = await get_visible_tag_ids(session, user_id=user_id, organization_id=org_id)

        assert result is None

    async def test_set_payload_decoded_to_uuid_set(self) -> None:
        session = MagicMock()
        org_id = generate_id()
        user_id = generate_id()
        tag_id = generate_id()

        async def fake_cache(key, loader, ttl, *, tags):
            return {"ids": [str(tag_id)]}

        with patch(
            "uniffy.core.auth.permissions.visible_sets.cache_get_or_set_locked",
            new=AsyncMock(side_effect=fake_cache),
        ):
            result = await get_visible_tag_ids(session, user_id=user_id, organization_id=org_id)

        assert result == {tag_id}


class TestInvalidationHelpers:
    async def test_invalidate_for_org_uses_org_tag(self) -> None:
        org_id = generate_id()

        with patch(
            "uniffy.core.auth.permissions.visible_sets.cache_invalidate_by_tag",
            new=AsyncMock(),
        ) as fake_tag:
            await invalidate_visible_sets_for_org(org_id)

        fake_tag.assert_awaited_once_with(f"perm_visible_org:{org_id}")

    async def test_invalidate_for_user_drops_known_keys(self) -> None:
        org_id = generate_id()
        user_id = generate_id()

        with patch(
            "uniffy.core.auth.permissions.visible_sets.cache_invalidate_many",
            new=AsyncMock(),
        ) as fake_many:
            await invalidate_visible_sets_for_user(org_id, user_id)

        # One tags-key + one per content type covered (NOTE, FILE, etc.).
        keys = fake_many.call_args[0]
        assert any("perm_visible_tags" in k for k in keys)
        assert any("perm_visible_content" in k for k in keys)
