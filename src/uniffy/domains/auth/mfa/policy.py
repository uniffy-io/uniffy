"""Deployment-wide MFA policy.

Lives in the generic ``deployment_settings`` KV store under
``namespace='mfa'`` so a self-hoster can flip the policy from
``/platform/server-settings`` without touching the environment, while
cloud operators get the same UI.

Single knob today:

* ``required_for_system_admins`` -- bool. When true (the default),
  every ``is_system_admin`` user must enrol TOTP. The requirement is
  immediate: the next sign in routes the user straight to enrollment.

Env tier (``MFA_REQUIRED_FOR_SYSTEM_ADMINS``) seeds the default; once
a row is written it wins. Self-hosters who never touch the UI keep
the env behaviour.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.domains.deployment_settings.operations import DeploymentSettingsOperations

MFA_NAMESPACE = "mfa"
_KEY_REQUIRED_FOR_SYSTEM_ADMINS = "required_for_system_admins"

_DEFAULT_REQUIRED_FOR_SYSTEM_ADMINS = True


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class MfaDeploymentPolicy:
    """Effective deployment-wide MFA policy."""

    required_for_system_admins: bool


class MfaPolicyOperations:
    """Read / write the deployment-level MFA policy."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._settings = DeploymentSettingsOperations(session)

    async def get(self) -> MfaDeploymentPolicy:
        """Return the effective policy."""
        rows = await self._settings.get_namespace(MFA_NAMESPACE)
        required_row = rows.get(_KEY_REQUIRED_FOR_SYSTEM_ADMINS)
        return MfaDeploymentPolicy(
            required_for_system_admins=(
                bool(required_row.value)
                if required_row is not None and required_row.value is not None
                else _env_bool(
                    "MFA_REQUIRED_FOR_SYSTEM_ADMINS",
                    _DEFAULT_REQUIRED_FOR_SYSTEM_ADMINS,
                )
            ),
        )

    async def set_required_for_system_admins(
        self,
        required: bool,
        actor_user_id: UUID,
    ) -> MfaDeploymentPolicy:
        """Flip the platform-admin MFA requirement."""
        previous = await self.get()
        if previous.required_for_system_admins == bool(required):
            return previous
        await self._settings.set(
            namespace=MFA_NAMESPACE,
            key=_KEY_REQUIRED_FOR_SYSTEM_ADMINS,
            value=bool(required),
            is_secret=False,
            updated_by_user_id=actor_user_id,
        )
        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=actor_user_id,
            action=Action.AUTH_MFA_POLICY_CHANGED,
            resource_type="DEPLOYMENT",
            resource_id=None,
            details={
                "scope": "deployment",
                "key": _KEY_REQUIRED_FOR_SYSTEM_ADMINS,
                "previous": previous.required_for_system_admins,
                "new": bool(required),
            },
        )
        await self._session.commit()
        return await self.get()
