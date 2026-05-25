"""Per-org security settings.

One row in ``org_settings`` per (org, key) under ``namespace='security'``:

* ``password_reset_enabled`` -- bool, default ``True`` when no row exists.

Future keys land here as new entries; absence always means the documented
default. The toggle is read on every password-reset request, so we keep
it dirt-simple: no encryption (these are policy flags, not secrets), no
caching beyond what ``OrgSettingsOperations`` already does.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.domains.org_settings.operations import OrgSettingsOperations

SECURITY_NAMESPACE = "security"
_KEY_PASSWORD_RESET_ENABLED = "password_reset_enabled"

_DEFAULT_PASSWORD_RESET_ENABLED = True


@dataclass(frozen=True)
class SecuritySettings:
    """Effective security policy for one organization."""

    password_reset_enabled: bool


class SecurityOperations:
    """CRUD on per-org security policy.

    Reads fall through to documented defaults when no row exists so a
    brand-new org behaves sensibly without any seeding work.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._settings = OrgSettingsOperations(session)

    async def get(self, organization_id: UUID) -> SecuritySettings:
        """Return the effective settings; missing keys take the default."""
        rows = await self._settings.get_namespace(organization_id, SECURITY_NAMESPACE)
        password_reset_row = rows.get(_KEY_PASSWORD_RESET_ENABLED)
        return SecuritySettings(
            password_reset_enabled=(
                bool(password_reset_row.value)
                if password_reset_row is not None and password_reset_row.value is not None
                else _DEFAULT_PASSWORD_RESET_ENABLED
            ),
        )

    async def set_password_reset_enabled(
        self,
        organization_id: UUID,
        enabled: bool,
        actor_user_id: UUID,
    ) -> SecuritySettings:
        """Toggle ``password_reset_enabled``. Audit row written same txn."""
        previous = await self.get(organization_id)
        if previous.password_reset_enabled == enabled:
            return previous

        await self._settings.set(
            organization_id=organization_id,
            namespace=SECURITY_NAMESPACE,
            key=_KEY_PASSWORD_RESET_ENABLED,
            value=enabled,
            is_secret=False,
            updated_by_user_id=actor_user_id,
        )
        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            action=Action.ORGANIZATION_SECURITY_SETTINGS_CHANGED,
            resource_type="ORGANIZATION",
            resource_id=organization_id,
            details={
                "key": _KEY_PASSWORD_RESET_ENABLED,
                "previous": previous.password_reset_enabled,
                "new": enabled,
            },
        )
        await self._session.commit()
        return SecuritySettings(password_reset_enabled=enabled)
