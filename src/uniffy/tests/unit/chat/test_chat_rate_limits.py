from unittest.mock import AsyncMock

from uniffy.core.types import generate_id
from uniffy.domains.chat import limits as rate_limits


async def test_chat_rate_limit_uses_org_and_user_scoped_bucket(monkeypatch) -> None:
    check = AsyncMock()
    monkeypatch.setattr(rate_limits, "check_rate_limit", check)
    monkeypatch.setenv("CHAT_RATE_LIMIT_WINDOW_SECONDS", "90")
    monkeypatch.setenv("CHAT_SEND_RATE_LIMIT", "75")
    user_id = generate_id()
    organization_id = generate_id()

    await rate_limits.check_chat_mutation_limit(
        rate_limits.SEND,
        user_id=user_id,
        organization_id=organization_id,
    )

    check.assert_awaited_once_with(
        key=f"rl:chat:chat_messages:{organization_id}:{user_id}",
        limit=75,
        window_seconds=90,
        resource="chat messages",
    )


async def test_chat_rate_limit_rejects_non_positive_env_values(monkeypatch) -> None:
    check = AsyncMock()
    monkeypatch.setattr(rate_limits, "check_rate_limit", check)
    monkeypatch.setenv("CHAT_RATE_LIMIT_WINDOW_SECONDS", "0")
    monkeypatch.setenv("CHAT_REACTION_ADD_RATE_LIMIT", "-5")

    await rate_limits.check_chat_mutation_limit(
        rate_limits.REACTION_ADD,
        user_id=generate_id(),
        organization_id=generate_id(),
    )

    assert check.await_args.kwargs["limit"] == 1
    assert check.await_args.kwargs["window_seconds"] == 1
