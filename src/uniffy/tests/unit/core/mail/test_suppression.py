"""Suppression normalization + repo plumbing (DB layer mocked)."""

from unittest.mock import AsyncMock

from uniffy.core.mail.suppression import SuppressionRepository, _normalize


class TestNormalize:
    def test_lowercases_and_strips(self) -> None:
        assert _normalize("  Foo@Bar.COM ") == "foo@bar.com"


class TestRepoIsSuppressed:
    async def test_hit_returns_true(self) -> None:
        session = AsyncMock()
        result = AsyncMock()
        result.scalar_one_or_none = lambda: "row-id"
        session.execute = AsyncMock(return_value=result)

        repo = SuppressionRepository(session)
        assert await repo.is_suppressed("user@x.com") is True

    async def test_miss_returns_false(self) -> None:
        session = AsyncMock()
        result = AsyncMock()
        result.scalar_one_or_none = lambda: None
        session.execute = AsyncMock(return_value=result)

        repo = SuppressionRepository(session)
        assert await repo.is_suppressed("user@x.com") is False

