"""A member's Google or Microsoft account linked for calendar sync, and the calendars it holds."""

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlmodel import Field, SQLModel

from uniffy.core.models.calendar.columns import text_enum, utc_now
from uniffy.core.types import generate_id


class CalendarProvider(StrEnum):
    GOOGLE = "GOOGLE"
    MICROSOFT = "MICROSOFT"


class ConnectionStatus(StrEnum):
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    REAUTH_REQUIRED = "REAUTH_REQUIRED"
    DISCONNECTED = "DISCONNECTED"


class SyncDirection(StrEnum):
    INBOUND = "INBOUND"
    TWO_WAY = "TWO_WAY"


class ProviderAccessRole(StrEnum):
    OWNER = "OWNER"
    WRITER = "WRITER"
    READER = "READER"
    FREE_BUSY = "FREE_BUSY"


WRITABLE_ROLES = frozenset({ProviderAccessRole.OWNER, ProviderAccessRole.WRITER})


class ConnectedCalendarState(StrEnum):
    ACTIVE = "ACTIVE"
    # The account was disconnected; the row waits so a reconnect re-attaches its events.
    DETACHED = "DETACHED"
    # The provider no longer lists the calendar.
    REMOVED = "REMOVED"


class SyncFailure(StrEnum):
    """Why the last sync or push failed; stored as text so a new reason needs no migration."""

    UNREACHABLE = "UNREACHABLE"
    RATE_LIMITED = "RATE_LIMITED"
    PROVIDER_ERROR = "PROVIDER_ERROR"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    NOT_FOUND = "NOT_FOUND"
    REAUTH_REQUIRED = "REAUTH_REQUIRED"
    UNPROCESSABLE = "UNPROCESSABLE"


def _ts(nullable: bool = True) -> Column:
    return Column(DateTime(timezone=True), nullable=nullable)


class CalendarConnection(SQLModel, table=True):
    """One provider account; its tokens are sealed with the organization's key."""

    __tablename__ = "calendar_connections"
    __table_args__ = (
        Index(
            "uq_calendar_connections_account",
            "organization_id",
            "owner_id",
            "provider",
            "provider_account_id",
            unique=True,
        ),
        Index("ix_calendar_connections_discovery", "status", "next_discovery_at"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    owner_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    provider: CalendarProvider = Field(
        sa_column=Column(text_enum(CalendarProvider, 20), nullable=False)
    )
    provider_account_id: str = Field(max_length=255, nullable=False)
    account_email: str = Field(max_length=320, nullable=False)
    email_verified: bool = Field(default=False, nullable=False)
    scopes: list[str] = Field(default_factory=list, sa_column=Column(ARRAY(Text), nullable=False))
    refresh_token_encrypted: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    access_token_encrypted: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    access_token_expires_at: datetime | None = Field(default=None, sa_column=_ts())
    status: ConnectionStatus = Field(
        default=ConnectionStatus.ACTIVE,
        sa_column=Column(text_enum(ConnectionStatus, 20), nullable=False),
    )
    # Bumped by reconnect, disconnect and credential change; a job carrying an older one stops.
    generation: int = Field(default=1, nullable=False)
    client_fingerprint: str = Field(max_length=64, nullable=False)
    last_error_code: SyncFailure | None = Field(
        default=None, sa_column=Column(text_enum(SyncFailure, 40), nullable=True)
    )
    consecutive_failures: int = Field(default=0, nullable=False)
    reauth_notified_at: datetime | None = Field(default=None, sa_column=_ts())
    next_discovery_at: datetime | None = Field(default=None, sa_column=_ts())
    last_synced_at: datetime | None = Field(default=None, sa_column=_ts())
    created_at: datetime = Field(default_factory=utc_now, sa_column=_ts(nullable=False))
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, onupdate=utc_now),
    )


class CalendarConnectionAttempt(SQLModel, table=True):
    """An OAuth round trip in progress; only the state's digest is kept."""

    __tablename__ = "calendar_connection_attempts"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    provider: CalendarProvider = Field(
        sa_column=Column(text_enum(CalendarProvider, 20), nullable=False)
    )
    state_digest: str = Field(sa_column=Column(String(64), nullable=False, unique=True))
    code_verifier_encrypted: str = Field(sa_column=Column(Text, nullable=False))
    reconnect_connection_id: UUID | None = Field(
        default=None,
        sa_column=Column(ForeignKey("calendar_connections.id", ondelete="CASCADE"), nullable=True),
    )
    return_path: str = Field(default="/calendar", max_length=500, nullable=False)
    expires_at: datetime = Field(sa_column=_ts(nullable=False))
    consumed_at: datetime | None = Field(default=None, sa_column=_ts())
    created_at: datetime = Field(default_factory=utc_now, sa_column=_ts(nullable=False))


class ConnectedCalendar(SQLModel, table=True):
    """One provider calendar of a connection, mirrored into one Uniffy calendar once enabled."""

    __tablename__ = "calendar_connected_calendars"
    __table_args__ = (
        Index(
            "uq_calendar_connected_calendars_provider_id",
            "connection_id",
            "provider_calendar_id",
            unique=True,
        ),
        Index("ix_calendar_connected_calendars_due", "state", "next_sync_at"),
        Index(
            "ix_calendar_connected_calendars_channel",
            "push_channel_id",
            postgresql_where=text("push_channel_id IS NOT NULL"),
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    connection_id: UUID = Field(
        sa_column=Column(
            ForeignKey("calendar_connections.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    provider_calendar_id: str = Field(max_length=500, nullable=False)
    name: str = Field(max_length=255, nullable=False)
    provider_color: str | None = Field(default=None, max_length=20)
    access_role: ProviderAccessRole = Field(
        sa_column=Column(text_enum(ProviderAccessRole, 20), nullable=False)
    )
    is_primary: bool = Field(default=False, nullable=False)
    # Holidays and other calendars the provider generates; polled daily.
    is_system: bool = Field(default=False, nullable=False)
    sync_enabled: bool = Field(default=False, nullable=False)
    direction: SyncDirection = Field(
        default=SyncDirection.INBOUND, sa_column=Column(text_enum(SyncDirection, 20), nullable=False)
    )
    counts_as_busy: bool = Field(default=False, nullable=False)
    calendar_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            ForeignKey("calendar_calendars.id", ondelete="SET NULL"),
            nullable=True,
            unique=True,
        ),
    )
    state: ConnectedCalendarState = Field(
        default=ConnectedCalendarState.ACTIVE,
        sa_column=Column(text_enum(ConnectedCalendarState, 20), nullable=False),
    )
    # Google sync token or Graph delta link; never shown, never logged.
    cursor: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    window_start: datetime | None = Field(default=None, sa_column=_ts())
    window_end: datetime | None = Field(default=None, sa_column=_ts())
    scan_id: UUID | None = Field(default=None)
    next_sync_at: datetime | None = Field(default=None, sa_column=_ts())
    consecutive_failures: int = Field(default=0, nullable=False)
    last_error_code: SyncFailure | None = Field(
        default=None, sa_column=Column(text_enum(SyncFailure, 40), nullable=True)
    )
    last_error_status: int | None = Field(default=None)
    last_success_at: datetime | None = Field(default=None, sa_column=_ts())
    last_attempt_at: datetime | None = Field(default=None, sa_column=_ts())
    event_count: int = Field(default=0, nullable=False)
    skipped_count: int = Field(default=0, nullable=False)
    search_stale: bool = Field(default=False, nullable=False)
    push_channel_id: str | None = Field(default=None, max_length=255)
    push_resource_id: str | None = Field(default=None, max_length=500)
    push_secret_digest: str | None = Field(default=None, max_length=64)
    push_expires_at: datetime | None = Field(default=None, sa_column=_ts())
    push_unsupported_until: datetime | None = Field(default=None, sa_column=_ts())
    created_at: datetime = Field(default_factory=utc_now, sa_column=_ts(nullable=False))
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, onupdate=utc_now),
    )
