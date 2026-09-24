"""Call revocation contract for auth, platform and directory owners."""

from collections.abc import Sequence
from enum import Enum
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calls import CallEndReason

CALL_LIFECYCLE_CTX_KEY = "call_lifecycle"


class CallEvictionReason(str, Enum):
    USER_DEACTIVATED = "USER_DEACTIVATED"
    SESSION_REVOKED = "SESSION_REVOKED"
    MEMBERSHIP_REVOKED = "MEMBERSHIP_REVOKED"


class CallRevocationLifecycle(Protocol):
    async def evict_user(
        self,
        session: AsyncSession,
        user_id: UUID,
        *,
        reason: CallEvictionReason,
        organization_id: UUID | None = None,
        session_ids: Sequence[UUID] | None = None,
        actor_user_id: UUID | None = None,
    ) -> None: ...

    async def stage_transfer_session(
        self,
        session: AsyncSession,
        from_session_id: UUID,
        to_session_id: UUID,
    ) -> None:
        """Restamp live rows in the open transaction; the caller commits."""
        ...

    async def end_for_organization(
        self,
        session: AsyncSession,
        organization_id: UUID,
        reason: CallEndReason,
        actor_user_id: UUID | None = None,
    ) -> None: ...
