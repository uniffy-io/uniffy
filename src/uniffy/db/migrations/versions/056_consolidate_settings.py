"""Consolidate per-domain settings tables into the two generic KV stores.

Moves three stragglers into the canonical stores, then drops them:

* ``application_settings`` (VAPID keys) -> ``deployment_settings`` (``namespace='push'``).
  The private key is re-encrypted from the master-Fernet scheme to ``DeploymentCipher``
  framing (``v{version}:...``) so it decrypts through the standard deployment-secret path.
* ``calls_org_policies`` -> ``org_settings`` (``namespace='calls'``, ``key='policy'``).
* ``agents_runtime_settings`` -> ``org_settings`` (``namespace='agents'``, ``key='runtime'``).

Also drops ``calls_channel_settings``, which never had a consumer (no data to move).

Data is copied before the drop so an existing (staging) deployment keeps its rows.
Timestamps come from each store's ``server_default now()`` (timestamptz = UTC).
"""

import base64
import json
import os
import secrets
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from cryptography.fernet import Fernet

revision: str = "056"
down_revision: str | None = "054"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _master_cipher() -> Fernet:
    raw = os.environ.get("APP_MASTER_KEY", "").strip()
    if not raw:
        raise RuntimeError("APP_MASTER_KEY must be set to migrate VAPID secrets")
    return Fernet(raw.encode("ascii"))


def _active_deployment_dek(bind, master: Fernet) -> tuple[Fernet, int]:
    """Return (Fernet-on-DEK, version), provisioning a v1 DEK if none exists."""
    row = (
        bind
        .execute(
            sa.text(
                "SELECT version, wrapped_dek FROM deployment_encryption_keys "
                "WHERE is_active = true LIMIT 1"
            )
        )
        .mappings()
        .first()
    )
    if row is not None:
        dek = master.decrypt(row["wrapped_dek"].encode("ascii"))
        return Fernet(dek), int(row["version"])

    dek = base64.urlsafe_b64encode(secrets.token_bytes(32))
    wrapped = master.encrypt(dek).decode("ascii")
    bind.execute(
        sa.text(
            "INSERT INTO deployment_encryption_keys (id, version, wrapped_dek, is_active) "
            "VALUES (gen_random_uuid(), 1, :wrapped, true)"
        ),
        {"wrapped": wrapped},
    )
    return Fernet(dek), 1


def _insert_deployment_setting(
    bind, key: str, *, value: str | None, ciphertext: str | None, is_secret: bool
) -> None:
    bind.execute(
        sa.text(
            "INSERT INTO deployment_settings "
            "(namespace, key, value, value_encrypted, is_secret) "
            "VALUES ('push', :key, "
            "CAST(:value AS jsonb), :ciphertext, :is_secret) "
            "ON CONFLICT (namespace, key) DO NOTHING"
        ),
        {
            "key": key,
            "value": None if value is None else json.dumps(value),
            "ciphertext": ciphertext,
            "is_secret": is_secret,
        },
    )


def _insert_org_setting(bind, organization_id, namespace: str, key: str, blob: dict) -> None:
    bind.execute(
        sa.text(
            "INSERT INTO org_settings "
            "(organization_id, namespace, key, value, value_encrypted, is_secret) "
            "VALUES (CAST(:org AS uuid), :ns, :key, CAST(:blob AS jsonb), NULL, false) "
            "ON CONFLICT (organization_id, namespace, key) DO NOTHING"
        ),
        {"org": str(organization_id), "ns": namespace, "key": key, "blob": json.dumps(blob)},
    )


def _migrate_vapid(bind) -> None:
    rows = (
        bind
        .execute(
            sa.text(
                "SELECT key, value, is_encrypted FROM application_settings "
                "WHERE key IN ('vapid_private_key', 'vapid_public_key', 'vapid_contact_email')"
            )
        )
        .mappings()
        .all()
    )
    if not rows:
        return
    data = {r["key"]: r for r in rows}

    for key in ("vapid_public_key", "vapid_contact_email"):
        row = data.get(key)
        if row is not None:
            _insert_deployment_setting(
                bind, key, value=row["value"], ciphertext=None, is_secret=False
            )

    priv = data.get("vapid_private_key")
    if priv is not None:
        master = _master_cipher()
        plaintext = (
            master.decrypt(priv["value"].encode("ascii")).decode("utf-8")
            if priv["is_encrypted"]
            else priv["value"]
        )
        fernet, version = _active_deployment_dek(bind, master)
        token = f"v{version}:" + fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")
        _insert_deployment_setting(
            bind, "vapid_private_key", value=None, ciphertext=token, is_secret=True
        )


def _migrate_calls_policies(bind) -> None:
    # calls_org_policies (migration 054) predates the per-type screen-share caps,
    # so existing rows carry none; they migrate as UNSPECIFIED (0) and the server
    # resolves its built-in per-type default. New writes store real caps in the blob.
    rows = (
        bind
        .execute(
            sa.text(
                "SELECT organization_id, calls_enabled, max_participants, max_duration_minutes "
                "FROM calls_org_policies"
            )
        )
        .mappings()
        .all()
    )
    for r in rows:
        blob = {
            "calls_enabled": bool(r["calls_enabled"]),
            "max_participants": int(r["max_participants"]),
            "max_duration_minutes": int(r["max_duration_minutes"]),
            "max_screen_share_quality_direct": 0,
            "max_screen_share_quality_group": 0,
            "max_screen_share_quality_channel": 0,
        }
        _insert_org_setting(bind, r["organization_id"], "calls", "policy", blob)


def _migrate_agent_runtime_settings(bind) -> None:
    rows = (
        bind
        .execute(
            sa.text(
                "SELECT organization_id, send_deadline_seconds, failover_enabled, resume_enabled, "
                "circuit_breaker_failure_threshold, circuit_breaker_recovery_seconds, "
                "display_currency FROM agents_runtime_settings"
            )
        )
        .mappings()
        .all()
    )
    for r in rows:
        blob = {
            "send_deadline_seconds": r["send_deadline_seconds"],
            "failover_enabled": bool(r["failover_enabled"]),
            "resume_enabled": bool(r["resume_enabled"]),
            "circuit_breaker_failure_threshold": int(r["circuit_breaker_failure_threshold"]),
            "circuit_breaker_recovery_seconds": int(r["circuit_breaker_recovery_seconds"]),
            "display_currency": r["display_currency"] or "USD",
        }
        _insert_org_setting(bind, r["organization_id"], "agents", "runtime", blob)


def upgrade() -> None:
    bind = op.get_bind()
    _migrate_vapid(bind)
    _migrate_calls_policies(bind)
    _migrate_agent_runtime_settings(bind)

    op.drop_table("application_settings")
    op.drop_table("calls_org_policies")
    op.drop_table("agents_runtime_settings")
    # Never wired to any consumer; drop rather than carry a dead table.
    op.drop_table("calls_channel_settings")


def downgrade() -> None:
    """Recreate the three tables empty; the moved data is not copied back."""
    op.create_table(
        "application_settings",
        sa.Column("key", sa.String(length=255), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("is_encrypted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("description", sa.String(length=500), nullable=False, server_default=""),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.PrimaryKeyConstraint("key"),
    )

    op.create_table(
        "calls_org_policies",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("calls_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("max_participants", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("max_duration_minutes", sa.Integer(), nullable=False, server_default="480"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("now()")
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.UniqueConstraint("organization_id"),
    )

    op.create_table(
        "agents_runtime_settings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("send_deadline_seconds", sa.Integer(), nullable=True),
        sa.Column("failover_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("resume_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "circuit_breaker_failure_threshold", sa.Integer(), nullable=False, server_default="5"
        ),
        sa.Column(
            "circuit_breaker_recovery_seconds", sa.Integer(), nullable=False, server_default="60"
        ),
        sa.Column("display_currency", sa.String(length=3), nullable=False, server_default="USD"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", name="uq_agents_runtime_settings_org"),
    )

    op.create_table(
        "calls_channel_settings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("allow_member_publish", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("now()")
        ),
        sa.ForeignKeyConstraint(["channel_id"], ["chat_channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("channel_id"),
    )
    op.create_index(
        "ix_calls_channel_settings_organization_id",
        "calls_channel_settings",
        ["organization_id"],
    )
