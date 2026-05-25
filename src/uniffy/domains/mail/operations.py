"""Per-org mail config CRUD + test send.

Delegates storage to ``OrgSettingsOperations`` under
``namespace='mail'``. Keeps the per-key value-typing (port -> int,
use_tls -> bool, etc.) consistent so the resolver gets the shapes it
expects.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, NamedTuple
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.mail import MailSender
from uniffy.core.mail.backends.base import MailResult
from uniffy.core.mail.config import MAIL_NAMESPACE
from uniffy.core.mail.errors import MailProviderError, MailSuppressedError
from uniffy.core.mail.resolver import MailConfigResolver
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.domains.org_settings.operations import OrgSettingsOperations
from uniffy.domains.organizations.operations import OrganizationOperations

# Plain keys (stored in OrgSetting.value as JSONB).
PLAIN_KEYS: tuple[str, ...] = (
    "from_address",
    "from_name",
    "reply_to",
    "smtp_host",
    "smtp_port",
    "smtp_username",
    "smtp_use_tls",
    "rate_limit_per_min",
)

# Secret keys (stored encrypted in OrgSetting.value_encrypted).
SECRET_KEYS: tuple[str, ...] = ("smtp_password",)

# Test-send metadata keys (plain, written by SendTestMail only).
META_KEYS: tuple[str, ...] = (
    "verified_at",
    "last_test_at",
    "last_test_status",
    "last_test_error",
)


class OrgMailConfigSummary(NamedTuple):
    """Non-secret view of an org's mail config + env fallback hint."""

    has_org_config: bool
    effective_source: str  # 'org' | 'env'
    from_address: str
    from_name: str
    reply_to: str
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password_set: bool
    smtp_use_tls: bool
    rate_limit_per_min: int
    verified_at: datetime | None
    last_test_at: datetime | None
    last_test_status: str | None
    last_test_error: str | None


def _plain(row: OrgSetting | None) -> Any:
    """Return a row's plaintext JSON value (None when absent or secret)."""
    if row is None or row.is_secret:
        return None
    return row.value


def _str(row: OrgSetting | None) -> str:
    value = _plain(row)
    return "" if value is None else str(value)


def _int(row: OrgSetting | None, default: int) -> int:
    value = _plain(row)
    if value is None:
        return default
    return int(value)


def _bool(row: OrgSetting | None, default: bool) -> bool:
    value = _plain(row)
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in ("1", "true", "yes")
    return bool(value)


def _datetime(row: OrgSetting | None) -> datetime | None:
    value = _plain(row)
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _summarize(rows: dict[str, OrgSetting]) -> OrgMailConfigSummary:
    """Map raw row dict -> OrgMailConfigSummary (no secrets surfaced)."""
    has_org_config = bool(rows)
    pw_row = rows.get("smtp_password")
    smtp_password_set = (
        pw_row is not None
        and pw_row.is_secret
        and pw_row.value_encrypted is not None
    )
    return OrgMailConfigSummary(
        has_org_config=has_org_config,
        effective_source="org" if has_org_config else "env",
        from_address=_str(rows.get("from_address")),
        from_name=_str(rows.get("from_name")),
        reply_to=_str(rows.get("reply_to")),
        smtp_host=_str(rows.get("smtp_host")),
        smtp_port=_int(rows.get("smtp_port"), 587),
        smtp_username=_str(rows.get("smtp_username")),
        smtp_password_set=smtp_password_set,
        smtp_use_tls=_bool(rows.get("smtp_use_tls"), True),
        rate_limit_per_min=_int(rows.get("rate_limit_per_min"), 100),
        verified_at=_datetime(rows.get("verified_at")),
        last_test_at=_datetime(rows.get("last_test_at")),
        last_test_status=(_str(rows.get("last_test_status")) or None),
        last_test_error=(_str(rows.get("last_test_error")) or None),
    )


class OrgMailOperations:
    """Admin operations on per-org mail config."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._settings = OrgSettingsOperations(session)
        self._org_ops = OrganizationOperations(session)

    async def get_config(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
    ) -> OrgMailConfigSummary:
        """Org admin / owner only. Returns a non-secret summary."""
        await self._org_ops.require_org_admin(user_id, organization_id)
        rows = await self._settings.get_namespace(organization_id, MAIL_NAMESPACE)
        return _summarize(rows)

    async def update_config(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        from_address: str,
        from_name: str,
        reply_to: str,
        smtp_host: str,
        smtp_port: int,
        smtp_username: str,
        smtp_password: str,  # empty -> leave existing
        smtp_use_tls: bool,
        rate_limit_per_min: int,
    ) -> OrgMailConfigSummary:
        """Upsert every plain key + optionally the encrypted password."""
        await self._org_ops.require_org_admin(user_id, organization_id)

        existing = await self._settings.get_namespace(organization_id, MAIL_NAMESPACE)
        had_org_config = bool(existing)

        updates: dict[str, Any] = {
            "from_address": from_address.strip(),
            "from_name": from_name.strip() or "Uniffy",
            "reply_to": reply_to.strip(),
            "smtp_host": smtp_host.strip(),
            "smtp_port": int(smtp_port) if smtp_port else 587,
            "smtp_username": smtp_username,
            "smtp_use_tls": bool(smtp_use_tls),
            "rate_limit_per_min": int(rate_limit_per_min) if rate_limit_per_min else 100,
        }

        changed_keys = [k for k, v in updates.items() if _plain(existing.get(k)) != v]

        for key, value in updates.items():
            await self._settings.set(
                organization_id=organization_id,
                namespace=MAIL_NAMESPACE,
                key=key,
                value=value,
                is_secret=False,
                updated_by_user_id=user_id,
            )

        password_changed = bool(smtp_password)
        if password_changed:
            await self._settings.set(
                organization_id=organization_id,
                namespace=MAIL_NAMESPACE,
                key="smtp_password",
                value=smtp_password,
                is_secret=True,
                updated_by_user_id=user_id,
            )
            changed_keys.append("smtp_password")

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.MAIL_CONFIG_UPDATED,
            resource_type="mail_config",
            resource_id=organization_id,
            details={
                "from_address": updates["from_address"],
                "smtp_host": updates["smtp_host"],
                "smtp_port": updates["smtp_port"],
                "smtp_username": updates["smtp_username"],
                "smtp_use_tls": updates["smtp_use_tls"],
                "rate_limit_per_min": updates["rate_limit_per_min"],
                "password_changed": password_changed,
                "changed_keys": changed_keys,
                "was_new": not had_org_config,
            },
        )

        await self._session.commit()
        await MailConfigResolver.invalidate(organization_id)

        rows = await self._settings.get_namespace(organization_id, MAIL_NAMESPACE)
        return _summarize(rows)

    async def clear_config(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
    ) -> int:
        """Drop every mail.* row for the org."""
        await self._org_ops.require_org_admin(user_id, organization_id)
        deleted = await self._settings.delete_namespace(
            organization_id=organization_id,
            namespace=MAIL_NAMESPACE,
        )
        if deleted:
            await write_audit_event(
                self._session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.MAIL_CONFIG_CLEARED,
                resource_type="mail_config",
                resource_id=organization_id,
                details={"deleted_keys": deleted},
            )
        await self._session.commit()
        await MailConfigResolver.invalidate(organization_id)
        return deleted

    async def send_test(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        recipient_email: str,
        sender: MailSender | None = None,
    ) -> MailResult:
        """Dispatch the admin/test template and record status on the org row."""
        await self._org_ops.require_org_admin(user_id, organization_id)
        recipient = recipient_email.strip()
        if not recipient or "@" not in recipient:
            raise ValueError("recipient_email must be a valid address")

        sender = sender or MailSender()
        now_iso = datetime.now(UTC).isoformat()

        # Resolve the org's display name for the template context.
        try:
            org = await self._org_ops.get_by_id(organization_id)
            org_name = org.name
        except Exception:
            org_name = ""

        status = "ok"
        error: str | None = None
        result: MailResult
        try:
            result = await sender.send(
                recipient_email=recipient,
                template_name="admin/test",
                context={
                    "sent_at": now_iso,
                    "config_source": "org",
                    "org_name": org_name,
                },
                organization_id=organization_id,
                idempotency_key=f"admin-test/{organization_id}/{now_iso}",
                user_id=user_id,
            )
        except MailSuppressedError as exc:
            status = "failed"
            error = f"recipient suppressed: {exc.message}"
            result = MailResult(success=False, error=error)
        except MailProviderError as exc:
            status = "failed"
            error = exc.message
            result = MailResult(success=False, error=error)

        await self._settings.set(
            organization_id=organization_id,
            namespace=MAIL_NAMESPACE,
            key="last_test_at",
            value=now_iso,
            is_secret=False,
            updated_by_user_id=user_id,
        )
        await self._settings.set(
            organization_id=organization_id,
            namespace=MAIL_NAMESPACE,
            key="last_test_status",
            value=status,
            is_secret=False,
            updated_by_user_id=user_id,
        )
        if error is not None:
            await self._settings.set(
                organization_id=organization_id,
                namespace=MAIL_NAMESPACE,
                key="last_test_error",
                value=error,
                is_secret=False,
                updated_by_user_id=user_id,
            )
        if result.success:
            await self._settings.set(
                organization_id=organization_id,
                namespace=MAIL_NAMESPACE,
                key="verified_at",
                value=now_iso,
                is_secret=False,
                updated_by_user_id=user_id,
            )
        await self._session.commit()
        await MailConfigResolver.invalidate(organization_id)

        return result
