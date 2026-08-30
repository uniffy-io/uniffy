"""Platform-facing MFA administration contracts."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class PendingPeerReset:
    request_id: UUID
    requester_user_id: UUID
    requester_email: str
    target_user_id: UUID
    target_email: str
    reason: str
    created_at: datetime
    expires_at: datetime


class PlatformMfaOperations(Protocol):
    async def platform_reset_mfa(
        self,
        actor_user_id: UUID,
        target_user_id: UUID,
        reason: str,
    ) -> None: ...

    async def request_platform_peer_reset(
        self,
        actor_user_id: UUID,
        target_user_id: UUID,
        reason: str,
    ) -> tuple[UUID, datetime]: ...

    async def list_platform_peer_resets(
        self,
        actor_user_id: UUID,
    ) -> list[PendingPeerReset]: ...

    async def approve_platform_peer_reset(
        self,
        actor_user_id: UUID,
        request_id: UUID,
    ) -> None: ...


type PlatformMfaOperationsFactory = Callable[[AsyncSession], PlatformMfaOperations]
