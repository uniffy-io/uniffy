"""Session-row revocation shared by every "kill this user's sessions" path."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.user_session import UserSession


async def stage_revoke_user_sessions(
    session: AsyncSession,
    user_id: UUID,
    *,
    keep_session_id: UUID | None = None,
) -> list[UUID]:
    """Persist revocation so media authorization remains independent of JWT caches."""
    query = update(UserSession).where(
        UserSession.user_id == user_id,
        UserSession.is_revoked.is_(False),
    )
    if keep_session_id is not None:
        query = query.where(UserSession.id != keep_session_id)
    rows = await session.execute(
        query
        .values(is_revoked=True, revoked_at=datetime.now(UTC))
        .returning(UserSession.id)
        .execution_options(synchronize_session=False)
    )
    return [row[0] for row in rows.all()]
