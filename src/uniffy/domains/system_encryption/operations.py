"""Platform operations on the deployment DEK; rotation walks the consumer
registry to re-encrypt rows in place.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.crypto import DeploymentCipher, DeploymentEncryptionStatus
from uniffy.core.errors import ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.domains.users.operations import UserOperations


class SystemEncryptionOperations:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._user_ops = UserOperations(session)
        self._cipher = DeploymentCipher(session)

    async def get_status(self, *, user_id: UUID) -> DeploymentEncryptionStatus:
        await self._user_ops.require_system_admin(user_id)
        return await self._cipher.get_status()

    async def rotate(self, *, user_id: UUID, reason: str) -> int:
        """Returns the new active version; the retired DEK stays referenced
        until the sweep completes.
        """
        await self._user_ops.require_system_admin(user_id)
        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")

        previous_status = await self._cipher.get_status()
        new_version = await self._cipher.rotate()

        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=user_id,
            action=Action.DEPLOYMENT_ENCRYPTION_ROTATED,
            resource_type=AuditResourceType.DEPLOYMENT_ENCRYPTION_KEY,
            resource_id=None,
            details={
                "previous_version": previous_status.active_version,
                "new_version": new_version,
                "reason": reason,
            },
        )
        await self._session.commit()
        return new_version
