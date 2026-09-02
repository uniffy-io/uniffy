"""Generic org settings, email suppressions, password reset tokens.

Revision ID: 042
Revises: 041
Create Date: 2026-05-21

Three tables introduced together because they all unblock the email
infrastructure rollout, but two of them are domain-agnostic:

* ``org_settings`` -- generic per-(org, namespace, key) key-value store.
  Email config lives here under ``namespace='mail'``. Future per-org
  settings (branding, feature flags, billing prefs, ingest webhook
  secrets, ...) drop in as new keys without further migrations. The
  CHECK constraint enforces exactly one of ``value`` (plaintext JSON)
  or ``value_encrypted`` (``OrgCipher`` ciphertext framed ``v{n}:...``)
  is populated per row, gated by ``is_secret``.
* ``mail_suppressions`` -- global do-not-contact list keyed by email.
* ``login_password_reset_tokens`` -- single-use auth reset tokens, hashed.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "042"
down_revision: str | None = "041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_suppression_reason_enum = postgresql.ENUM(
    "BOUNCED",
    "COMPLAINED",
    "MANUAL",
    name="emailsuppressionreason",
    create_type=False,
)


def upgrade() -> None:
    """Create the three tables backing org settings, suppressions, reset tokens."""
    postgresql.ENUM(
        "BOUNCED",
        "COMPLAINED",
        "MANUAL",
        name="emailsuppressionreason",
    ).create(op.get_bind(), checkfirst=True)

    op.create_table(
        "mail_suppressions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("reason", _suppression_reason_enum, nullable=False),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("provider_event_id", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_mail_suppressions_email"),
    )
    op.create_index(
        "ix_mail_suppressions_email",
        "mail_suppressions",
        ["email"],
    )

    op.create_table(
        "org_settings",
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("namespace", sa.String(length=64), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column(
            "value",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("value_encrypted", sa.Text(), nullable=True),
        sa.Column(
            "is_secret",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("organization_id", "namespace", "key"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["login_organizations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"],
            ["login_users.id"],
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "(is_secret = true  AND value_encrypted IS NOT NULL AND value IS NULL) "
            "OR (is_secret = false AND value_encrypted IS NULL)",
            name="ck_org_settings_value_exclusive",
        ),
    )
    op.create_index(
        "ix_org_settings_namespace_secret",
        "org_settings",
        ["namespace", "is_secret"],
    )

    op.create_table(
        "login_password_reset_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_ip", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "token_hash",
            name="uq_login_password_reset_tokens_token_hash",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["login_users.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_login_password_reset_tokens_user_id",
        "login_password_reset_tokens",
        ["user_id"],
    )
    op.create_index(
        "ix_login_password_reset_tokens_token_hash",
        "login_password_reset_tokens",
        ["token_hash"],
    )


def downgrade() -> None:
    """Drop tables and the suppression-reason enum."""
    op.drop_index(
        "ix_login_password_reset_tokens_token_hash",
        table_name="login_password_reset_tokens",
    )
    op.drop_index(
        "ix_login_password_reset_tokens_user_id",
        table_name="login_password_reset_tokens",
    )
    op.drop_table("login_password_reset_tokens")
    op.drop_index(
        "ix_org_settings_namespace_secret",
        table_name="org_settings",
    )
    op.drop_table("org_settings")
    op.drop_index(
        "ix_mail_suppressions_email",
        table_name="mail_suppressions",
    )
    op.drop_table("mail_suppressions")
    postgresql.ENUM(name="emailsuppressionreason").drop(
        op.get_bind(),
        checkfirst=True,
    )
