"""Provider tokens and sign-in verifiers join the per-organization key rotation sweep."""

from collections.abc import AsyncIterator, Callable
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto.consumers import ReEncryptingConsumer, register_consumer
from uniffy.core.models.calendar.connection import CalendarConnection, CalendarConnectionAttempt


def _rows_with(model: Any, column: str) -> Callable[[AsyncSession, UUID], AsyncIterator[Any]]:
    async def rows(session: AsyncSession, organization_id: UUID) -> AsyncIterator[Any]:
        result = await session.execute(
            select(model).where(
                model.organization_id == organization_id, getattr(model, column).is_not(None)
            )
        )
        for row in result.scalars():
            yield row

    return rows


def _consumer(name: str, model: Any, column: str) -> ReEncryptingConsumer:
    return ReEncryptingConsumer(
        name=name,
        table_name=model.__tablename__,
        list_rows=_rows_with(model, column),
        get_ciphertext=lambda row: getattr(row, column),
        set_ciphertext=lambda row, ciphertext: setattr(row, column, ciphertext),
    )


def register_connection_crypto() -> None:
    register_consumer(
        _consumer("calendar_connection_access_tokens", CalendarConnection, "access_token_encrypted")
    )
    register_consumer(
        _consumer(
            "calendar_connection_refresh_tokens", CalendarConnection, "refresh_token_encrypted"
        )
    )
    register_consumer(
        _consumer(
            "calendar_connection_verifiers", CalendarConnectionAttempt, "code_verifier_encrypted"
        )
    )
