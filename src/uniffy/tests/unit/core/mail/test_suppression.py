"""Suppression normalization + repo plumbing (DB layer mocked)."""

import asyncio
from unittest.mock import AsyncMock

from uniffy.core.mail.suppression import SuppressionRepository, _normalize


def _run(coro):
    return asyncio.run(coro)


class TestNormalize:
    def test_lowercases_and_strips(self) -> None:
        assert _normalize("  Foo@Bar.COM ") == "foo@bar.com"


class TestRepoIsSuppressed:
    def test_hit_returns_true(self) -> None:
        session = AsyncMock()
        result = AsyncMock()
        result.scalar_one_or_none = lambda: "row-id"
        session.execute = AsyncMock(return_value=result)

        repo = SuppressionRepository(session)
        assert _run(repo.is_suppressed("user@x.com")) is True

    def test_miss_returns_false(self) -> None:
        session = AsyncMock()
        result = AsyncMock()
        result.scalar_one_or_none = lambda: None
        session.execute = AsyncMock(return_value=result)

        repo = SuppressionRepository(session)
        assert _run(repo.is_suppressed("user@x.com")) is False

    def test_query_uses_lowercased_email(self) -> None:
        session = AsyncMock()
        result = AsyncMock()
        result.scalar_one_or_none = lambda: None
        session.execute = AsyncMock(return_value=result)

        repo = SuppressionRepository(session)
        _run(repo.is_suppressed("Mixed@Example.COM"))

        executed = session.execute.call_args.args[0]
        # Compile to text and check the bound parameter; SQLAlchemy core stmt.
        compiled = executed.compile(compile_kwargs={"literal_binds": True})
        assert "mixed@example.com" in str(compiled)
