"""Operator writes for deployment-wide platform flags."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.config.org_creation import (
    ORG_CREATION_KEY,
    ORG_CREATION_NAMESPACE,
    OrgCreationPolicy,
    OrgCreationState,
    resolve_org_creation,
)
from uniffy.core.config.registration import (
    PUBLIC_REGISTRATION_KEY,
    PUBLIC_REGISTRATION_NAMESPACE,
    PublicRegistrationState,
    resolve_public_registration,
)
from uniffy.core.config.settings import DeploymentSettingsOperations
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.domains.users.operations import UserOperations


@dataclass(frozen=True, slots=True)
class SystemConfigState:
    public_registration: PublicRegistrationState
    org_creation: OrgCreationState


class SystemConfigOperations:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._user_ops = UserOperations(session)
        self._settings = DeploymentSettingsOperations(session)

    async def get_state(self, *, user_id: UUID) -> SystemConfigState:
        await self._user_ops.require_system_admin(user_id)
        return SystemConfigState(
            public_registration=await resolve_public_registration(self._session),
            org_creation=await resolve_org_creation(self._session),
        )

    async def set_public_registration(
        self,
        *,
        user_id: UUID,
        enabled: bool,
    ) -> SystemConfigState:
        await self._user_ops.require_system_admin(user_id)
        previous = await resolve_public_registration(self._session)
        await self._settings.set(
            namespace=PUBLIC_REGISTRATION_NAMESPACE,
            key=PUBLIC_REGISTRATION_KEY,
            value=bool(enabled),
            is_secret=False,
            updated_by_user_id=user_id,
        )
        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=user_id,
            action=Action.SYSTEM_PUBLIC_REGISTRATION_CHANGED,
            resource_type=AuditResourceType.SYSTEM_FLAG,
            resource_id=None,
            details={
                "key": PUBLIC_REGISTRATION_KEY,
                "previous_enabled": previous.enabled,
                "previous_source": previous.source.value,
                "new_enabled": bool(enabled),
            },
        )
        await self._session.commit()
        return await self.get_state(user_id=user_id)

    async def set_org_creation_policy(
        self,
        *,
        user_id: UUID,
        policy: OrgCreationPolicy,
    ) -> SystemConfigState:
        await self._user_ops.require_system_admin(user_id)
        previous = await resolve_org_creation(self._session)
        await self._settings.set(
            namespace=ORG_CREATION_NAMESPACE,
            key=ORG_CREATION_KEY,
            value=policy.value,
            is_secret=False,
            updated_by_user_id=user_id,
        )
        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=user_id,
            action=Action.SYSTEM_ORG_CREATION_CHANGED,
            resource_type=AuditResourceType.SYSTEM_FLAG,
            resource_id=None,
            details={
                "key": ORG_CREATION_KEY,
                "policy": policy.value,
                "previous_policy": previous.policy.value,
                "previous_source": previous.source.value,
            },
        )
        await self._session.commit()
        return await self.get_state(user_id=user_id)
