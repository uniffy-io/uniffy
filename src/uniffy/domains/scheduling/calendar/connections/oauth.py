"""The provider sign-in round trip: a one-time state and PKCE verifier out, a sealed grant back."""

import base64
import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.membership import get_active_membership
from uniffy.core.crypto.org_cipher import OrgCipher
from uniffy.core.errors import (
    MembershipRequiredError,
    NotFoundError,
    ValidationError,
)
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.calendar.connection import (
    CalendarConnection,
    CalendarConnectionAttempt,
    CalendarProvider,
    ConnectedCalendar,
    ConnectedCalendarState,
    ConnectionStatus,
)
from uniffy.core.models.calendar.provider_push import CalendarProviderPush, PushState
from uniffy.core.outbound import ApiError
from uniffy.core.rate_limit import check_rate_limit
from uniffy.domains.scheduling.calendar.connections.clients import (
    client_for,
    redirect_uri,
    require_credentials,
)
from uniffy.domains.scheduling.calendar.connections.providers.base import (
    ProviderError,
    ReauthRequired,
)
from uniffy.domains.scheduling.calendar.connections.reattach import reattach_calendar
from uniffy.domains.scheduling.calendar.connections.tokens import seal_grant
from uniffy.domains.scheduling.calendar.policy import require_can_connect

logger = logger.bind(component="scheduling.calendar.connections.oauth")

ATTEMPT_LIFETIME = timedelta(minutes=10)
MAX_CONNECTIONS_PER_MEMBER = 10
_START_LIMIT = 10
_START_WINDOW_SECONDS = 3600
_DEFAULT_RETURN = "/calendar"
_CALENDAR_SCOPES = {
    CalendarProvider.GOOGLE: "https://www.googleapis.com/auth/calendar.events",
    CalendarProvider.MICROSOFT: "calendars.readwrite",
}
# Tenants that limit user consent answer with one of these instead of a code.
_ADMIN_APPROVAL_MARKERS = ("AADSTS65001", "AADSTS90094", "consent_required", "interaction_required")
_EXPIRED = "This sign-in expired. Start connecting the account again."


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _challenge(verifier: str) -> str:
    raw = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def safe_return_path(value: str | None) -> str:
    """Only a path inside the app, so the callback can never become an open redirect."""
    path = (value or "").strip()
    if not path.startswith("/") or path.startswith("//") or "\\" in path or len(path) > 500:  # noqa: PLR2004 - path shape
        return _DEFAULT_RETURN
    if any(ord(ch) < 32 for ch in path):  # noqa: PLR2004 - control characters
        return _DEFAULT_RETURN
    return path


async def start_connection(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    provider: CalendarProvider,
    *,
    reconnect_connection_id: UUID | None,
    return_path: str | None,
) -> str:
    if await get_active_membership(session, user_id, organization_id) is None:
        raise MembershipRequiredError("Requires organization membership")
    await require_can_connect(session, user_id, organization_id)
    credentials = await require_credentials(session, organization_id, provider)
    login_hint = None
    if reconnect_connection_id is not None:
        existing = await session.scalar(
            select(CalendarConnection).where(
                CalendarConnection.id == reconnect_connection_id,
                CalendarConnection.organization_id == organization_id,
                CalendarConnection.owner_id == user_id,
                CalendarConnection.provider == provider,
            )
        )
        if existing is None:
            raise NotFoundError("Calendar connection", str(reconnect_connection_id))
        login_hint = existing.account_email
    await check_rate_limit(
        key=f"rl:calendar_connect:{organization_id}:{user_id}",
        limit=_START_LIMIT,
        window_seconds=_START_WINDOW_SECONDS,
        resource="calendar connection",
    )
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    now = datetime.now(UTC)
    session.add(
        CalendarConnectionAttempt(
            organization_id=organization_id,
            user_id=user_id,
            provider=provider,
            state_digest=_digest(state),
            code_verifier_encrypted=await OrgCipher(session).encrypt(organization_id, verifier),
            reconnect_connection_id=reconnect_connection_id,
            return_path=safe_return_path(return_path),
            expires_at=now + ATTEMPT_LIFETIME,
        )
    )
    await session.commit()
    return client_for(credentials).authorize_url(
        state=state,
        code_challenge=_challenge(verifier),
        redirect_uri=redirect_uri(),
        login_hint=login_hint,
    )


@dataclass(frozen=True)
class CompletedConnection:
    connection_id: UUID
    return_path: str
    reconnected: bool


def _refusal_message(error: str, description: str) -> str:
    text = f"{error} {description}"
    if any(marker in text for marker in _ADMIN_APPROVAL_MARKERS):
        return "Your organization's administrator must approve Uniffy before you can connect."
    if error == "access_denied":  # noqa: PLR2004 - OAuth error code
        return "The account was not connected because access was not granted."
    return "The calendar service refused the sign-in. Try again."


async def complete_connection(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    *,
    code: str,
    state: str,
    error: str,
    error_description: str,
) -> CompletedConnection:
    attempt = await session.scalar(
        select(CalendarConnectionAttempt)
        .where(CalendarConnectionAttempt.state_digest == _digest(state or ""))
        .with_for_update()
    )
    now = datetime.now(UTC)
    if (
        attempt is None
        or attempt.user_id != user_id
        or attempt.organization_id != organization_id
        or attempt.consumed_at is not None
        or attempt.expires_at <= now
    ):
        await session.rollback()
        raise ValidationError("state", _EXPIRED)
    # Spent before any network call, so a replayed callback can never run twice.
    attempt.consumed_at = now
    provider = attempt.provider
    reconnect_id = attempt.reconnect_connection_id
    return_path = attempt.return_path
    verifier = await OrgCipher(session).decrypt(organization_id, attempt.code_verifier_encrypted)
    await session.commit()

    if error:
        logger.info(
            "Calendar sign-in refused by the provider", provider=provider.value, error=error[:80]
        )
        raise ValidationError("code", _refusal_message(error, error_description))
    if not code:
        raise ValidationError("code", _EXPIRED)
    # Membership can end while the person is away signing in.
    if await get_active_membership(session, user_id, organization_id) is None:
        raise MembershipRequiredError("Requires organization membership")
    await require_can_connect(session, user_id, organization_id)
    credentials = await require_credentials(session, organization_id, provider)
    client = client_for(credentials)
    try:
        grant = await client.exchange_code(code, verifier, redirect_uri())
        identity = await client.identity(grant)
    except ReauthRequired as exc:
        raise ValidationError("code", _EXPIRED) from exc
    except ProviderError as exc:
        logger.warning(
            "Calendar sign-in exchange failed",
            provider=provider.value,
            failure=exc.failure.value,
            status=exc.status,
        )
        raise ValidationError("code", "The calendar service did not answer. Try again.") from exc
    except ApiError as exc:
        logger.warning(
            "Calendar sign-in exchange unreachable", provider=provider.value, reason=exc.reason
        )
        raise ValidationError("code", "The calendar service did not answer. Try again.") from exc
    await session.rollback()
    if not grant.refresh_token:
        raise ValidationError("code", "The account did not allow offline access. Try again.")
    granted = grant.scope.lower().split()
    # Microsoft may answer with the resource prefix (https://graph.microsoft.com/...).
    if granted and not any(scope.endswith(_CALENDAR_SCOPES[provider]) for scope in granted):
        raise ValidationError(
            "code", "Allow Uniffy to see and edit your calendar events, then try again."
        )

    connection = await session.scalar(
        select(CalendarConnection)
        .where(
            CalendarConnection.organization_id == organization_id,
            CalendarConnection.owner_id == user_id,
            CalendarConnection.provider == provider,
            CalendarConnection.provider_account_id == identity.account_id,
        )
        .with_for_update()
    )
    if reconnect_id is not None and (connection is None or connection.id != reconnect_id):
        raise ValidationError("code", "Sign in with the same account you connected before.")
    reconnected = connection is not None
    if connection is None:
        held = await session.scalar(
            select(CalendarConnection.id)
            .where(
                CalendarConnection.organization_id == organization_id,
                CalendarConnection.owner_id == user_id,
                CalendarConnection.status != ConnectionStatus.DISCONNECTED,
            )
            .offset(MAX_CONNECTIONS_PER_MEMBER - 1)
            .limit(1)
        )
        if held is not None:
            raise ValidationError(
                "provider", f"You can connect at most {MAX_CONNECTIONS_PER_MEMBER} accounts."
            )
        connection = CalendarConnection(
            organization_id=organization_id,
            owner_id=user_id,
            provider=provider,
            provider_account_id=identity.account_id,
            account_email=identity.email,
            client_fingerprint=credentials.fingerprint,
        )
        session.add(connection)
    else:
        connection.generation += 1
        await _reattach_calendars(session, connection)
        # Edits made while the account needed a new sign-in still go out under the new grant.
        await session.execute(
            update(CalendarProviderPush)
            .where(
                CalendarProviderPush.state == PushState.PENDING,
                CalendarProviderPush.connected_calendar_id.in_(
                    select(ConnectedCalendar.id).where(
                        ConnectedCalendar.connection_id == connection.id
                    )
                ),
            )
            .values(generation=connection.generation, next_attempt_at=now)
        )
    connection.account_email = identity.email
    connection.email_verified = identity.email_verified
    connection.scopes = sorted(set(grant.scope.split()))
    connection.status = ConnectionStatus.ACTIVE
    connection.client_fingerprint = credentials.fingerprint
    connection.last_error_code = None
    connection.consecutive_failures = 0
    connection.reauth_notified_at = None
    connection.next_discovery_at = now
    await seal_grant(session, connection, grant)
    await session.flush()
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=user_id,
        action=Action.CALENDAR_CONNECTION_CREATED,
        resource_type=AuditResourceType.CALENDAR,
        resource_id=connection.id,
        details={
            "provider": provider.value,
            "reconnected": reconnected,
            "generation": connection.generation,
        },
    )
    connection_id = connection.id
    await session.commit()
    return CompletedConnection(connection_id, return_path, reconnected)


async def _reattach_calendars(session: AsyncSession, connection: CalendarConnection) -> None:
    """A disconnect left the calendars as personal ones; a reconnect makes them synced again."""
    detached = list(
        (
            await session.execute(
                select(ConnectedCalendar)
                .where(
                    ConnectedCalendar.connection_id == connection.id,
                    ConnectedCalendar.state == ConnectedCalendarState.DETACHED,
                )
                .with_for_update()
            )
        ).scalars()
    )
    now = datetime.now(UTC)
    for row in detached:
        row.state = ConnectedCalendarState.ACTIVE
        # A fresh snapshot matches every event by its link, so nothing is duplicated.
        row.cursor = None
        row.scan_id = None
        row.consecutive_failures = 0
        row.last_error_code = None
        row.next_sync_at = now if row.sync_enabled else None
        if row.sync_enabled:
            await reattach_calendar(session, row, connection.owner_id, connection.organization_id)
