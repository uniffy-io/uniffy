"""The only place connection tokens are opened; a refresh runs one caller at a time."""

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto.org_cipher import OrgCipher
from uniffy.core.models.calendar.connection import (
    CalendarConnection,
    ConnectionStatus,
    SyncFailure,
)
from uniffy.domains.scheduling.calendar.connections.clients import client_for
from uniffy.domains.scheduling.calendar.connections.credentials import (
    resolve_provider_credentials,
)
from uniffy.domains.scheduling.calendar.connections.notices import (
    stage_reconnect_notice,
    wake_outbox,
)
from uniffy.domains.scheduling.calendar.connections.providers.base import (
    ReauthRequired,
    TokenGrant,
)

logger = logger.bind(component="scheduling.calendar.connections.tokens")

# Refreshed this long before expiry so a token never dies mid-round.
_EARLY_REFRESH = timedelta(seconds=120)


class ConnectionGone(Exception):
    """The connection changed under the job (paused, disconnected, reconnected); it stops quietly."""


@dataclass(frozen=True)
class AccessToken:
    token: str = field(repr=False)
    account_email: str


async def seal_grant(
    session: AsyncSession, connection: CalendarConnection, grant: TokenGrant
) -> None:
    cipher = OrgCipher(session)
    connection.access_token_encrypted = await cipher.encrypt(
        connection.organization_id, grant.access_token
    )
    connection.access_token_expires_at = datetime.now(UTC) + timedelta(seconds=grant.expires_in)
    if grant.refresh_token:
        # Microsoft rotates the refresh token; the old one may already be spent.
        connection.refresh_token_encrypted = await cipher.encrypt(
            connection.organization_id, grant.refresh_token
        )


async def access_token_for(
    session: AsyncSession, connection_id: UUID, generation: int
) -> AccessToken:
    """Commits before returning, so the caller never holds the row lock across its own calls."""
    connection = await session.scalar(
        select(CalendarConnection)
        .where(CalendarConnection.id == connection_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if (
        connection is None
        or connection.generation != generation
        or connection.status != ConnectionStatus.ACTIVE
    ):
        await session.rollback()
        raise ConnectionGone
    cipher = OrgCipher(session)
    now = datetime.now(UTC)
    if (
        connection.access_token_encrypted
        and connection.access_token_expires_at
        and connection.access_token_expires_at - _EARLY_REFRESH > now
    ):
        token = await cipher.decrypt(connection.organization_id, connection.access_token_encrypted)
        email = connection.account_email
        await session.commit()
        return AccessToken(token, email)

    credentials = await resolve_provider_credentials(
        session, connection.organization_id, connection.provider
    )
    if (
        credentials is None
        or credentials.fingerprint != connection.client_fingerprint
        or not connection.refresh_token_encrypted
    ):
        await _require_reauth(session, connection, "app_changed")
        raise ReauthRequired("app_changed")
    refresh_token = await cipher.decrypt(
        connection.organization_id, connection.refresh_token_encrypted
    )
    # The row lock is held across this one call on purpose: concurrent jobs wait for it
    # instead of spending the same refresh token twice, which rotation would punish.
    try:
        grant = await client_for(credentials).refresh(refresh_token)
    except ReauthRequired as exc:
        await _require_reauth(session, connection, exc.reason)
        raise
    except Exception:
        await session.rollback()
        raise
    await seal_grant(session, connection, grant)
    email = connection.account_email
    await session.commit()
    return AccessToken(grant.access_token, email)


async def _require_reauth(
    session: AsyncSession, connection: CalendarConnection, reason: str | None
) -> None:
    connection.status = ConnectionStatus.REAUTH_REQUIRED
    connection.last_error_code = SyncFailure.REAUTH_REQUIRED
    connection.access_token_encrypted = None
    connection.access_token_expires_at = None
    staged: list[UUID] = []
    if connection.reauth_notified_at is None:
        connection.reauth_notified_at = datetime.now(UTC)
        staged = await stage_reconnect_notice(session, connection)
    connection_id = connection.id
    await session.commit()
    logger.info(
        "Calendar connection needs a new sign-in",
        connection_id=str(connection_id),
        reason=reason,
    )
    await wake_outbox(staged)


async def require_reauth(
    session: AsyncSession, connection_id: UUID, generation: int, reason: str | None
) -> None:
    """A provider refused a token it had just issued: access was revoked on its side."""
    connection = await session.scalar(
        select(CalendarConnection)
        .where(
            CalendarConnection.id == connection_id,
            CalendarConnection.generation == generation,
            CalendarConnection.status == ConnectionStatus.ACTIVE,
        )
        .with_for_update()
    )
    if connection is None:
        await session.rollback()
        return
    await _require_reauth(session, connection, reason)
