from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.roles import role_can_manage
from uniffy.core.content.members import get_content_loader
from uniffy.core.content.references import parse_urn
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.permissions.content_access_request import ContentAccessRequest
from uniffy.core.types import ContentType
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.permissions.resource_access.resolver import ResourceAccessResolver
from uniffy.domains.permissions.resource_access.types import (
    AccessGrantKind,
    RequestTarget,
    ResourceAccessDecision,
    ResourceAccessPurpose,
    ResourceKey,
    ResourceRowState,
)


@dataclass(frozen=True)
class AccessRequestTarget:
    requested_urn: str
    original_content_type: ContentType
    original_content_id: UUID
    canonical_content_type: ContentType
    canonical_content_id: UUID
    grant_kind: AccessGrantKind
    canonical_row: object


@dataclass(frozen=True)
class AccessRequestTargetState:
    canonical_key: tuple[ContentType, UUID] | None
    requester_has_access: bool


class AccessRequestTargetResolver:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.resources = ResourceAccessResolver(session)

    async def require_active_member(self, user_id: UUID, organization_id: UUID) -> None:
        subject = await self.resources.subject(
            actor_id=user_id,
            organization_id=organization_id,
        )
        if not subject.is_active_member:
            raise PermissionDeniedError("access", "organization")

    async def resolve(
        self,
        organization_id: UUID,
        requested_urn: str,
        *,
        actor_id: UUID,
    ) -> AccessRequestTarget:
        parsed = parse_urn(requested_urn)
        if parsed is None:
            raise ValidationError("requested_urn", "Invalid content URN")
        key = ResourceKey(*parsed)
        decisions = await self.resources.resolve(
            actor_id=actor_id,
            organization_id=organization_id,
            keys=[key],
            purpose=ResourceAccessPurpose.ACCESS_REQUEST,
        )
        return await self._from_decision(organization_id, requested_urn, decisions[key])

    async def resolve_request(self, request: ContentAccessRequest) -> AccessRequestTarget:
        target = RequestTarget(
            request.canonical_content_type,
            request.canonical_content_id,
            (
                AccessGrantKind.CHAT
                if request.canonical_content_type == ContentType.CHAT
                else AccessGrantKind.STANDARD
            ),
        )
        row = await self._load_canonical(request.organization_id, target)
        return AccessRequestTarget(
            requested_urn=request.requested_urn,
            original_content_type=request.original_content_type,
            original_content_id=request.original_content_id,
            canonical_content_type=target.content_type,
            canonical_content_id=target.content_id,
            grant_kind=target.grant_kind,
            canonical_row=row,
        )

    async def requester_has_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        target: AccessRequestTarget,
    ) -> bool:
        key = ResourceKey(target.canonical_content_type, target.canonical_content_id)
        decisions = await ResourceAccessResolver(self.session).resolve(
            actor_id=user_id,
            organization_id=organization_id,
            keys=[key],
            purpose=ResourceAccessPurpose.ACCESS_REQUEST,
        )
        decision = decisions.get(key)
        return bool(
            decision is not None
            and decision.row_state == ResourceRowState.LIVE
            and decision.can_view
        )

    async def reviewer_can_manage(
        self,
        user_id: UUID,
        organization_id: UUID,
        target: AccessRequestTarget,
    ) -> bool:
        if target.grant_kind == AccessGrantKind.CHAT:
            return await ChatAccessChecker(self.session).require_elevated(
                user_id,
                organization_id,
                target.canonical_content_id,
            )

        row = target.canonical_row
        role = await PermissionChecker(self.session).effective_role(
            user_id=user_id,
            organization_id=organization_id,
            content_type=target.canonical_content_type,
            content_id=target.canonical_content_id,
            owner_id=row.owner_id,
            access_mode=row.access_mode,
            baseline_role=row.baseline_role,
        )
        return role_can_manage(role)

    async def states_for_urns(
        self,
        organization_id: UUID,
        requested_urns: list[str],
        *,
        actor_id: UUID,
    ) -> dict[str, AccessRequestTargetState]:
        keys_by_urn = {
            urn: ResourceKey(*parsed)
            for urn in requested_urns
            if (parsed := parse_urn(urn)) is not None
        }
        if not keys_by_urn:
            return {}
        decisions = await self.resources.resolve(
            actor_id=actor_id,
            organization_id=organization_id,
            keys=keys_by_urn.values(),
            purpose=ResourceAccessPurpose.ACCESS_REQUEST,
        )
        states: dict[str, AccessRequestTargetState] = {}
        for urn, key in keys_by_urn.items():
            decision = decisions.get(key)
            target = (
                decision.request_target
                if decision is not None and decision.row_state == ResourceRowState.LIVE
                else None
            )
            states[urn] = AccessRequestTargetState(
                canonical_key=(
                    (target.content_type, target.content_id) if target is not None else None
                ),
                requester_has_access=bool(
                    decision is not None
                    and decision.row_state == ResourceRowState.LIVE
                    and decision.can_view
                ),
            )
        return states

    async def _from_decision(
        self,
        organization_id: UUID,
        requested_urn: str,
        decision: ResourceAccessDecision,
    ) -> AccessRequestTarget:
        if decision.row_state != ResourceRowState.LIVE:
            raise NotFoundError(decision.key.content_type.value.lower(), decision.key.content_id)
        if decision.request_target is None:
            raise ValidationError(
                "requested_urn",
                "This content type does not support access requests",
            )
        row = await self._load_canonical(organization_id, decision.request_target)
        return AccessRequestTarget(
            requested_urn=requested_urn,
            original_content_type=decision.key.content_type,
            original_content_id=decision.key.content_id,
            canonical_content_type=decision.request_target.content_type,
            canonical_content_id=decision.request_target.content_id,
            grant_kind=decision.request_target.grant_kind,
            canonical_row=row,
        )

    async def _load_canonical(
        self,
        organization_id: UUID,
        target: RequestTarget,
    ) -> object:
        if target.grant_kind == AccessGrantKind.CHAT:
            channel = (
                await self.session.execute(
                    select(ChatChannel).where(
                        ChatChannel.id == target.content_id,
                        ChatChannel.organization_id == organization_id,
                        ChatChannel.is_deleted.is_(False),
                    )
                )
            ).scalar_one_or_none()
            if channel is None:
                raise NotFoundError("channel", target.content_id)
            if channel.channel_type != ChannelType.PRIVATE or channel.is_agent_dm:
                raise ValidationError(
                    "requested_urn",
                    "Only private channels support access requests",
                )
            return channel

        row = await get_content_loader(target.content_type)(
            self.session,
            organization_id,
            target.content_id,
        )
        if row is None or getattr(row, "is_deleted", False):
            raise NotFoundError(target.content_type.value.lower(), target.content_id)
        return row
