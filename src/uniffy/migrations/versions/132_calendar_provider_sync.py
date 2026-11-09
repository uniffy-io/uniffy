"""Add Google and Microsoft calendar connections, event links, participants and the push outbox."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "132"
down_revision: str | None = "131"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UUID = postgresql.UUID(as_uuid=True)


def _ts(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def _org() -> sa.Column:
    return sa.Column(
        "organization_id", _UUID, sa.ForeignKey("login_organizations.id"), nullable=False
    )


def upgrade() -> None:
    # Legal inside the migration transaction because nothing here reads the new label.
    op.execute("ALTER TYPE calendartype ADD VALUE IF NOT EXISTS 'CONNECTED'")

    op.add_column(
        "calendar_events",
        sa.Column("is_mirrored_occurrence", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index(
        "ix_calendar_events_org_ical_uid",
        "calendar_events",
        ["organization_id", "ical_uid"],
        postgresql_where=sa.text("ical_uid IS NOT NULL AND recurrence_id IS NULL"),
    )

    op.create_table(
        "calendar_connections",
        sa.Column("id", _UUID, primary_key=True, nullable=False),
        _org(),
        sa.Column("owner_id", _UUID, sa.ForeignKey("login_users.id"), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("provider_account_id", sa.String(255), nullable=False),
        sa.Column("account_email", sa.String(320), nullable=False),
        sa.Column("email_verified", sa.Boolean(), nullable=False),
        sa.Column("scopes", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("refresh_token_encrypted", sa.Text(), nullable=True),
        sa.Column("access_token_encrypted", sa.Text(), nullable=True),
        _ts("access_token_expires_at"),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("client_fingerprint", sa.String(64), nullable=False),
        sa.Column("last_error_code", sa.String(40), nullable=True),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False),
        _ts("reauth_notified_at"),
        _ts("next_discovery_at"),
        _ts("last_synced_at"),
        _ts("created_at", nullable=False),
        _ts("updated_at", nullable=False),
    )
    op.create_index(
        "ix_calendar_connections_organization_id", "calendar_connections", ["organization_id"]
    )
    op.create_index("ix_calendar_connections_owner_id", "calendar_connections", ["owner_id"])
    op.create_index(
        "uq_calendar_connections_account",
        "calendar_connections",
        ["organization_id", "owner_id", "provider", "provider_account_id"],
        unique=True,
    )
    op.create_index(
        "ix_calendar_connections_discovery",
        "calendar_connections",
        ["status", "next_discovery_at"],
    )

    op.create_table(
        "calendar_connection_attempts",
        sa.Column("id", _UUID, primary_key=True, nullable=False),
        _org(),
        sa.Column("user_id", _UUID, sa.ForeignKey("login_users.id"), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("state_digest", sa.String(64), nullable=False, unique=True),
        sa.Column("code_verifier_encrypted", sa.Text(), nullable=False),
        sa.Column(
            "reconnect_connection_id",
            _UUID,
            sa.ForeignKey("calendar_connections.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("return_path", sa.String(500), nullable=False),
        _ts("expires_at", nullable=False),
        _ts("consumed_at"),
        _ts("created_at", nullable=False),
    )
    op.create_index(
        "ix_calendar_connection_attempts_organization_id",
        "calendar_connection_attempts",
        ["organization_id"],
    )
    op.create_index(
        "ix_calendar_connection_attempts_user_id", "calendar_connection_attempts", ["user_id"]
    )

    op.create_table(
        "calendar_connected_calendars",
        sa.Column("id", _UUID, primary_key=True, nullable=False),
        sa.Column(
            "connection_id",
            _UUID,
            sa.ForeignKey("calendar_connections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        _org(),
        sa.Column("provider_calendar_id", sa.String(500), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("provider_color", sa.String(20), nullable=True),
        sa.Column("access_role", sa.String(20), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False),
        sa.Column("is_system", sa.Boolean(), nullable=False),
        sa.Column("sync_enabled", sa.Boolean(), nullable=False),
        sa.Column("direction", sa.String(20), nullable=False),
        sa.Column("counts_as_busy", sa.Boolean(), nullable=False),
        sa.Column(
            "calendar_id",
            _UUID,
            sa.ForeignKey("calendar_calendars.id", ondelete="SET NULL"),
            nullable=True,
            unique=True,
        ),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("cursor", sa.Text(), nullable=True),
        _ts("window_start"),
        _ts("window_end"),
        sa.Column("scan_id", _UUID, nullable=True),
        _ts("next_sync_at"),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False),
        sa.Column("last_error_code", sa.String(40), nullable=True),
        sa.Column("last_error_status", sa.Integer(), nullable=True),
        _ts("last_success_at"),
        _ts("last_attempt_at"),
        sa.Column("event_count", sa.Integer(), nullable=False),
        sa.Column("skipped_count", sa.Integer(), nullable=False),
        sa.Column("search_stale", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("push_channel_id", sa.String(255), nullable=True),
        sa.Column("push_resource_id", sa.String(500), nullable=True),
        sa.Column("push_secret_digest", sa.String(64), nullable=True),
        _ts("push_expires_at"),
        _ts("push_unsupported_until"),
        _ts("created_at", nullable=False),
        _ts("updated_at", nullable=False),
    )
    op.create_index(
        "ix_calendar_connected_calendars_connection_id",
        "calendar_connected_calendars",
        ["connection_id"],
    )
    op.create_index(
        "ix_calendar_connected_calendars_organization_id",
        "calendar_connected_calendars",
        ["organization_id"],
    )
    op.create_index(
        "uq_calendar_connected_calendars_provider_id",
        "calendar_connected_calendars",
        ["connection_id", "provider_calendar_id"],
        unique=True,
    )
    op.create_index(
        "ix_calendar_connected_calendars_due",
        "calendar_connected_calendars",
        ["state", "next_sync_at"],
    )
    op.create_index(
        "ix_calendar_connected_calendars_channel",
        "calendar_connected_calendars",
        ["push_channel_id"],
        postgresql_where=sa.text("push_channel_id IS NOT NULL"),
    )

    op.create_table(
        "calendar_event_links",
        sa.Column("id", _UUID, primary_key=True, nullable=False),
        _org(),
        sa.Column(
            "connected_calendar_id",
            _UUID,
            sa.ForeignKey("calendar_connected_calendars.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "event_id",
            _UUID,
            sa.ForeignKey("calendar_events.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider_event_id", sa.String(500), nullable=False),
        sa.Column("provider_series_id", sa.String(500), nullable=True),
        sa.Column("occurrence_key", sa.String(100), nullable=True),
        sa.Column("ical_uid", sa.String(500), nullable=True),
        sa.Column("etag", sa.String(500), nullable=True),
        _ts("provider_updated_at"),
        sa.Column("provider_sequence", sa.Integer(), nullable=True),
        sa.Column("content_fingerprint", sa.String(64), nullable=True),
        sa.Column("is_owner_link", sa.Boolean(), nullable=False),
        sa.Column("is_organizer_copy", sa.Boolean(), nullable=False),
        sa.Column("last_scan_id", _UUID, nullable=True),
        _ts("created_at", nullable=False),
        _ts("updated_at", nullable=False),
    )
    op.create_index(
        "ix_calendar_event_links_organization_id", "calendar_event_links", ["organization_id"]
    )
    op.create_index("ix_calendar_event_links_event_id", "calendar_event_links", ["event_id"])
    op.create_index(
        "uq_calendar_event_links_provider_event",
        "calendar_event_links",
        ["connected_calendar_id", "provider_event_id"],
        unique=True,
    )

    op.create_table(
        "calendar_event_participants",
        sa.Column("id", _UUID, primary_key=True, nullable=False),
        _org(),
        sa.Column(
            "event_id",
            _UUID,
            sa.ForeignKey("calendar_events.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("response", sa.String(20), nullable=False),
        sa.Column("is_organizer", sa.Boolean(), nullable=False),
        sa.Column("is_optional", sa.Boolean(), nullable=False),
        sa.Column(
            "user_id", _UUID, sa.ForeignKey("login_users.id", ondelete="SET NULL"), nullable=True
        ),
    )
    op.create_index(
        "ix_calendar_event_participants_organization_id",
        "calendar_event_participants",
        ["organization_id"],
    )
    op.create_index(
        "uq_calendar_event_participants_email",
        "calendar_event_participants",
        ["event_id", "email"],
        unique=True,
    )
    op.create_index(
        "ix_calendar_event_participants_user_id", "calendar_event_participants", ["user_id"]
    )

    op.create_table(
        "calendar_provider_pushes",
        sa.Column("id", _UUID, primary_key=True, nullable=False),
        _org(),
        sa.Column("event_id", _UUID, nullable=False),
        sa.Column(
            "connected_calendar_id",
            _UUID,
            sa.ForeignKey("calendar_connected_calendars.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("actor_id", _UUID, nullable=True),
        sa.Column("operation", sa.String(30), nullable=False),
        sa.Column("occurrence_date", sa.Date(), nullable=True),
        sa.Column("provider_event_id", sa.String(500), nullable=True),
        sa.Column("idempotency_key", _UUID, nullable=False),
        sa.Column("state", sa.String(30), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        _ts("next_attempt_at", nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("last_error_code", sa.String(40), nullable=True),
        _ts("created_at", nullable=False),
        _ts("updated_at", nullable=False),
    )
    op.create_index(
        "ix_calendar_provider_pushes_organization_id",
        "calendar_provider_pushes",
        ["organization_id"],
    )
    op.create_index("ix_calendar_provider_pushes_event_id", "calendar_provider_pushes", ["event_id"])
    op.create_index(
        "ix_calendar_provider_pushes_connected_calendar_id",
        "calendar_provider_pushes",
        ["connected_calendar_id"],
    )
    op.create_index(
        "ix_calendar_provider_pushes_due", "calendar_provider_pushes", ["state", "next_attempt_at"]
    )
    op.create_index(
        "uq_calendar_provider_pushes_pending",
        "calendar_provider_pushes",
        [
            "event_id",
            "connected_calendar_id",
            "operation",
            sa.text("coalesce(occurrence_date, '1970-01-01'::date)"),
        ],
        unique=True,
        postgresql_where=sa.text("state = 'PENDING'"),
    )


def downgrade() -> None:
    # PostgreSQL cannot drop an enum label, so 'CONNECTED' stays on calendartype;
    # connected calendars become ordinary personal calendars and keep their events.
    for notification_type in ("CALENDAR_CONNECTION_NEEDS_RECONNECT", "CALENDAR_SYNC_CONFLICT"):
        op.execute(
            sa.text(
                "DELETE FROM notification_email_deliveries WHERE notification_type = :kind"
            ).bindparams(kind=notification_type)
        )
        op.execute(
            sa.text("DELETE FROM notifications WHERE notification_type = :kind").bindparams(
                kind=notification_type
            )
        )
    op.execute(
        "UPDATE calendar_calendars SET calendar_type = 'PERSONAL' WHERE calendar_type = 'CONNECTED'"
    )
    op.drop_table("calendar_provider_pushes")
    op.drop_table("calendar_event_participants")
    op.drop_table("calendar_event_links")
    op.drop_table("calendar_connected_calendars")
    op.drop_table("calendar_connection_attempts")
    op.drop_table("calendar_connections")
    op.drop_index("ix_calendar_events_org_ical_uid", table_name="calendar_events")
    op.drop_column("calendar_events", "is_mirrored_occurrence")
