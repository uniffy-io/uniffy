"""Read / write access to the global ``mail_suppressions`` table."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.mail.suppression import EmailSuppression, EmailSuppressionReason


def _normalize(email: str) -> str:
    return email.strip().lower()


class SuppressionRepository:
    """CRUD around ``mail_suppressions``."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def is_suppressed(self, email: str) -> bool:
        normalized = _normalize(email)
        result = await self._session.execute(
            select(EmailSuppression.id).where(EmailSuppression.email == normalized)
        )
        return result.scalar_one_or_none() is not None

    async def add(
        self,
        email: str,
        *,
        reason: EmailSuppressionReason,
        source: str,
        provider_event_id: str | None = None,
    ) -> bool:
        """Idempotent insert. Returns True only when a new row was created;
        existing reason/source are preserved.
        """
        stmt = (
            pg_insert(EmailSuppression)
            .values(
                email=_normalize(email),
                reason=reason,
                source=source,
                provider_event_id=provider_event_id,
            )
            .on_conflict_do_nothing(index_elements=["email"])
            .returning(EmailSuppression.id)
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def remove(self, email: str) -> bool:
        normalized = _normalize(email)
        row = await self._session.execute(
            select(EmailSuppression).where(EmailSuppression.email == normalized)
        )
        obj = row.scalar_one_or_none()
        if obj is None:
            return False
        await self._session.delete(obj)
        return True

    async def list(
        self,
        *,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[EmailSuppression], int]:
        """Page of suppressions plus total count."""
        from sqlalchemy import func

        total = (
            await self._session.execute(select(func.count()).select_from(EmailSuppression))
        ).scalar_one()
        rows = (
            (
                await self._session.execute(
                    select(EmailSuppression)
                    .order_by(EmailSuppression.created_at.desc())
                    .limit(limit)
                    .offset(offset)
                )
            )
            .scalars()
            .all()
        )
        return list(rows), int(total)


__all__ = ["SuppressionRepository", "_normalize"]


async def list_for_recipients(
    session: AsyncSession,
    emails: list[str],
) -> set[str]:
    """Subset of ``emails`` (lowercased) that are suppressed."""
    if not emails:
        return set()
    normalized = [_normalize(e) for e in emails]
    rows = (
        (
            await session.execute(
                select(EmailSuppression.email).where(EmailSuppression.email.in_(normalized))
            )
        )
        .scalars()
        .all()
    )
    return set(rows)


async def is_suppressed(session: AsyncSession, email: str) -> bool:
    return await SuppressionRepository(session).is_suppressed(email)


ADMIN_SOURCE = "admin"
SMTP_BOUNCE_SOURCE = "smtp_bounce"


def admin_source_for(user_id: UUID | None) -> str:
    """``source`` tag for admin-added suppressions."""
    return f"{ADMIN_SOURCE}:{user_id}" if user_id else ADMIN_SOURCE
