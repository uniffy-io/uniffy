"""Authentication transaction boundaries against PostgreSQL."""

from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, text

from uniffy.core.audit.actions import Action
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.login.password_reset_token import PasswordResetToken
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.core.types import generate_id
from uniffy.infrastructure.database import open_session
from uniffy.domains.auth.operations import AuthOperations
from uniffy.domains.auth.passwords.reset import PasswordResetOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(loop_scope="session")
async def auth_transaction_env(session):
    suffix = generate_id().hex[:12]
    reset_user = User(
        email=f"reset-transaction-{suffix}@test.local",
        username=f"reset-transaction-{suffix}",
        hashed_password="x",
    )
    session.add(reset_user)
    await session.commit()
    env = NS(
        reset_user_id=reset_user.id,
        reset_email=reset_user.email,
        register_email=f"register-transaction-{suffix}@test.local",
        register_username=f"register-transaction-{suffix}",
    )

    try:
        yield env
    finally:
        await session.rollback()
        user_ids = list(
            (
                await session.execute(
                    select(User.id).where(User.email.in_([env.reset_email, env.register_email]))
                )
            ).scalars()
        )
        if user_ids:
            await session.execute(delete(UserSession).where(UserSession.user_id.in_(user_ids)))
            await session.execute(
                delete(PasswordResetToken).where(PasswordResetToken.user_id.in_(user_ids))
            )
            await session.execute(text("SET LOCAL uniffy.audit_maintenance = 'on'"))
            await session.execute(delete(AuditEvent).where(AuditEvent.resource_id.in_(user_ids)))
            await session.execute(delete(User).where(User.id.in_(user_ids)))
        await session.commit()


async def test_registration_rolls_back_user_and_session_when_audit_fails(
    session,
    auth_transaction_env,
) -> None:
    with (
        patch(
            "uniffy.domains.auth.operations.public_registration_enabled",
            new=AsyncMock(return_value=True),
        ),
        patch("uniffy.domains.auth.operations.hash_password", return_value="hashed"),
        patch(
            "uniffy.domains.auth.operations.write_audit_event",
            new=AsyncMock(side_effect=RuntimeError("audit unavailable")),
        ),
        pytest.raises(RuntimeError, match="audit unavailable"),
    ):
        await AuthOperations(session).register(
            email=auth_transaction_env.register_email,
            username=auth_transaction_env.register_username,
            password="valid-password-1",
        )

    async with open_session() as isolated:
        user = (
            await isolated.execute(
                select(User).where(User.email == auth_transaction_env.register_email)
            )
        ).scalar_one_or_none()
        session_count = (
            await isolated.execute(
                select(UserSession)
                .join(User)
                .where(User.email == auth_transaction_env.register_email)
            )
        ).scalar_one_or_none()

    assert user is None
    assert session_count is None


async def test_registration_commits_user_session_and_audit_together(
    session,
    auth_transaction_env,
) -> None:
    with (
        patch(
            "uniffy.domains.auth.operations.public_registration_enabled",
            new=AsyncMock(return_value=True),
        ),
        patch("uniffy.domains.auth.operations.hash_password", return_value="hashed"),
        patch("uniffy.domains.auth.operations.create_access_token", return_value="access"),
        patch("uniffy.domains.auth.operations.create_refresh_token", return_value="refresh"),
    ):
        result = await AuthOperations(session).register(
            email=auth_transaction_env.register_email,
            username=auth_transaction_env.register_username,
            password="valid-password-1",
        )

    async with open_session() as isolated:
        user = await isolated.get(User, result.user_id)
        user_session = await isolated.get(UserSession, result.session_id)
        audit = (
            await isolated.execute(
                select(AuditEvent).where(
                    AuditEvent.action == Action.AUTH_REGISTER_SUCCESS,
                    AuditEvent.resource_id == result.user_id,
                )
            )
        ).scalar_one_or_none()

    assert user is not None
    assert user_session is not None
    assert user_session.user_id == result.user_id
    assert audit is not None


async def test_password_reset_request_rolls_back_token_when_audit_fails(
    session,
    auth_transaction_env,
) -> None:
    operations = PasswordResetOperations(session)
    with (
        patch(
            "uniffy.domains.auth.passwords.reset.check_rate_limit",
            new=AsyncMock(),
        ),
        patch(
            "uniffy.domains.auth.passwords.reset.write_audit_event",
            new=AsyncMock(side_effect=RuntimeError("audit unavailable")),
        ),
        patch.object(operations, "_enqueue_email", new=AsyncMock()) as enqueue,
        pytest.raises(RuntimeError, match="audit unavailable"),
    ):
        await operations.request(auth_transaction_env.reset_email)

    async with open_session() as isolated:
        token = (
            await isolated.execute(
                select(PasswordResetToken).where(
                    PasswordResetToken.user_id == auth_transaction_env.reset_user_id
                )
            )
        ).scalar_one_or_none()

    assert token is None
    enqueue.assert_not_awaited()
