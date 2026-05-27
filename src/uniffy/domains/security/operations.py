"""Per-org security settings under ``namespace='security'``; absence of a
row means the documented default.
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
_KEY_MFA_REQUIRED_FOR_MEMBERS = "mfa_required_for_members"
_KEY_MFA_REQUIRED_FOR_ADMINS = "mfa_required_for_admins"

_DEFAULT_PASSWORD_RESET_ENABLED = True
_DEFAULT_MFA_REQUIRED_FOR_MEMBERS = False
_DEFAULT_MFA_REQUIRED_FOR_ADMINS = False


@dataclass(frozen=True)
class SecuritySettings:
    password_reset_enabled: bool
    mfa_required_for_members: bool
    mfa_required_for_admins: bool


def _bool_or_default(row, default: bool) -> bool:
    if row is None or row.value is None:
        return default
    return bool(row.value)


class SecurityOperations:
    """Reads fall through to documented defaults so a brand-new org needs no seeding."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._settings = OrgSettingsOperations(session)

    async def get(self, organization_id: UUID) -> SecuritySettings:
        rows = await self._settings.get_namespace(organization_id, SECURITY_NAMESPACE)
        return SecuritySettings(
            password_reset_enabled=_bool_or_default(
                rows.get(_KEY_PASSWORD_RESET_ENABLED),
                _DEFAULT_PASSWORD_RESET_ENABLED,
            ),
            mfa_required_for_members=_bool_or_default(
                rows.get(_KEY_MFA_REQUIRED_FOR_MEMBERS),
                _DEFAULT_MFA_REQUIRED_FOR_MEMBERS,
            ),
            mfa_required_for_admins=_bool_or_default(
                rows.get(_KEY_MFA_REQUIRED_FOR_ADMINS),
                _DEFAULT_MFA_REQUIRED_FOR_ADMINS,
            ),
        )

    async def set_password_reset_enabled(
        self,
        organization_id: UUID,
        enabled: bool,
        actor_user_id: UUID,
    ) -> SecuritySettings:
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
        return await self.get(organization_id)

    async def set_mfa_required_for_members(
        self,
        organization_id: UUID,
        required: bool,
        actor_user_id: UUID,
    ) -> SecuritySettings:
        return await self._set_bool_with_audit(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            key=_KEY_MFA_REQUIRED_FOR_MEMBERS,
            new_value=required,
            previous_value=lambda s: s.mfa_required_for_members,
            action=Action.AUTH_MFA_POLICY_CHANGED,
        )

    async def set_mfa_required_for_admins(
        self,
        organization_id: UUID,
        required: bool,
        actor_user_id: UUID,
    ) -> SecuritySettings:
        return await self._set_bool_with_audit(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            key=_KEY_MFA_REQUIRED_FOR_ADMINS,
            new_value=required,
            previous_value=lambda s: s.mfa_required_for_admins,
            action=Action.AUTH_MFA_POLICY_CHANGED,
        )

    async def _set_bool_with_audit(
        self,
        *,
        organization_id: UUID,
        actor_user_id: UUID,
        key: str,
        new_value: bool,
        previous_value,
        action: Action,
    ) -> SecuritySettings:
        previous = await self.get(organization_id)
        if previous_value(previous) == new_value:
            return previous
        await self._settings.set(
            organization_id=organization_id,
            namespace=SECURITY_NAMESPACE,
            key=key,
            value=new_value,
            is_secret=False,
            updated_by_user_id=actor_user_id,
        )
        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            action=action,
            resource_type="ORGANIZATION",
            resource_id=organization_id,
            details={
                "key": key,
                "previous": previous_value(previous),
                "new": new_value,
            },
        )
        await self._session.commit()
        return await self.get(organization_id)
