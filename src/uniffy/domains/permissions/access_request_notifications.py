"""Notification delivery and requester stream updates for access requests."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.permissions.v1.permissions_pb2 import (
    ACCESS_REQUEST_STATE_APPROVED,
    ACCESS_REQUEST_STATE_CANCELED,
    ACCESS_REQUEST_STATE_DENIED,
    ACCESS_REQUEST_STATE_PENDING,
)

from uniffy.core.auth.membership import is_active_member
from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.permissions.content_access_request import (
    ContentAccessRequest,
    ContentAccessRequestState,
)
from uniffy.core.types import NotificationType
from uniffy.core.valkey import publish_access_request_changed
from uniffy.domains.permissions.access_request_queries import DENIAL_COOLDOWN
from uniffy.domains.permissions.access_request_targets import (
    AccessGrantKind,
    AccessRequestTarget,
)

_REQUEST_STATE_TO_PROTO = {
    ContentAccessRequestState.PENDING: ACCESS_REQUEST_STATE_PENDING,
    ContentAccessRequestState.APPROVED: ACCESS_REQUEST_STATE_APPROVED,
    ContentAccessRequestState.DENIED: ACCESS_REQUEST_STATE_DENIED,
    ContentAccessRequestState.CANCELED: ACCESS_REQUEST_STATE_CANCELED,
}


class AccessRequestNotifier:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def notify_requested(
        self,
        request: ContentAccessRequest,
        target: AccessRequestTarget,
    ) -> None:
        recipients = await self._review_recipients(request, target)
        if not recipients:
            return
        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.ACCESS_REQUESTED,
                organization_id=request.organization_id,
                actor_id=request.requester_id,
                title="Requested access",
                body=request.message,
                source_urn=request.requested_urn,
                target_user_ids=recipients,
                metadata=self._metadata(request),
            )
        )

    async def notify_denied(
        self,
        request: ContentAccessRequest,
        actor_user_id: UUID,
    ) -> None:
        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.ACCESS_REQUEST_DENIED,
                organization_id=request.organization_id,
                actor_id=actor_user_id,
                title="Denied your access request",
                body=request.decision_note,
                target_user_ids=[request.requester_id],
                metadata=self._metadata(request),
            )
        )

    async def publish_state(self, request: ContentAccessRequest) -> None:
        can_request_again_at = (
            request.responded_at + DENIAL_COOLDOWN
            if request.state == ContentAccessRequestState.DENIED and request.responded_at
            else None
        )
        await publish_access_request_changed(
            user_id=request.requester_id,
            request_id=request.id,
            requested_urn=request.requested_urn,
            state=_REQUEST_STATE_TO_PROTO[request.state],
            can_request_again_at=can_request_again_at,
        )

    async def _review_recipients(
        self,
        request: ContentAccessRequest,
        target: AccessRequestTarget,
    ) -> list[UUID]:
        if target.grant_kind == AccessGrantKind.STANDARD:
            return [target.canonical_row.owner_id]

        rows = (
            await self.session.execute(
                select(ChatChannelMember.user_id)
                .join(
                    OrganizationMember,
                    (OrganizationMember.user_id == ChatChannelMember.user_id)
                    & (OrganizationMember.organization_id == request.organization_id),
                )
                .where(
                    ChatChannelMember.channel_id == target.canonical_content_id,
                    ChatChannelMember.role == ChannelRole.OWNER,
                    ChatChannelMember.user_id.is_not(None),
                    OrganizationMember.is_active == True,  # noqa: E712
                )
            )
        ).scalars()
        owners = list(dict.fromkeys(user_id for user_id in rows if user_id is not None))
        if owners:
            return owners
        owner_id = target.canonical_row.owner_id
        if await is_active_member(owner_id, request.organization_id, session=self.session):
            return [owner_id]
        return []

    @staticmethod
    def _metadata(request: ContentAccessRequest) -> dict[str, str]:
        return {
            "request_id": str(request.id),
            "requested_urn": request.requested_urn,
            "canonical_content_type": request.canonical_content_type.value,
            "canonical_content_id": str(request.canonical_content_id),
        }
