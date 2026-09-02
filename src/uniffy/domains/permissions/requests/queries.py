"""Authorization-aware reads for content access requests."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.login.user import User
from uniffy.core.models.permissions.content_access_request import (
    ContentAccessRequest,
    ContentAccessRequestState,
)
from uniffy.core.types import ContentType
from uniffy.domains.permissions.access import (
    AccessGrantKind,
    ResourceAudienceResolver,
)
from uniffy.domains.permissions.access.targets import (
    AccessRequestTarget,
    AccessRequestTargetResolver,
)

DENIAL_COOLDOWN = timedelta(hours=24)
MAX_STATUS_BATCH = 100
MAX_LIST_PAGE_SIZE = 100


@dataclass(frozen=True)
class AccessRequestView:
    request: ContentAccessRequest
    requester_display_name: str
    requester_has_access: bool
    can_request_again_at: datetime | None


@dataclass(frozen=True)
class AccessRequestStatusView:
    requested_urn: str
    state: ContentAccessRequestState | None
    request_id: UUID | None
    can_request_again_at: datetime | None
    requester_has_access: bool


@dataclass(frozen=True)
class AccessRequestPage:
    requests: list[AccessRequestView]
    page: int
    page_size: int
    total_items: int


class AccessRequestQueries:
    def __init__(
        self,
        session: AsyncSession,
        targets: AccessRequestTargetResolver,
    ) -> None:
        self.session = session
        self.targets = targets

    async def get_my_statuses(
        self,
        *,
        requester_id: UUID,
        organization_id: UUID,
        requested_urns: list[str],
    ) -> list[AccessRequestStatusView]:
        await self.targets.require_active_member(requester_id, organization_id)
        if len(requested_urns) > MAX_STATUS_BATCH:
            raise ValidationError(
                "requested_urns",
                f"At most {MAX_STATUS_BATCH} URNs may be resolved at once",
            )

        unique_urns = list(dict.fromkeys(requested_urns))
        target_states = await self.targets.states_for_urns(
            organization_id,
            unique_urns,
            actor_id=requester_id,
        )
        canonical_keys = {
            state.canonical_key
            for state in target_states.values()
            if state.canonical_key is not None
        }
        requests: list[ContentAccessRequest] = []
        if canonical_keys:
            requests = list(
                (
                    await self.session.execute(
                        select(ContentAccessRequest)
                        .where(
                            ContentAccessRequest.organization_id == organization_id,
                            ContentAccessRequest.requester_id == requester_id,
                            tuple_(
                                ContentAccessRequest.canonical_content_type,
                                ContentAccessRequest.canonical_content_id,
                            ).in_(canonical_keys),
                        )
                        .order_by(ContentAccessRequest.created_at.desc())
                    )
                )
                .scalars()
                .all()
            )

        latest_by_target: dict[tuple[ContentType, UUID], ContentAccessRequest] = {}
        for request in requests:
            key = (request.canonical_content_type, request.canonical_content_id)
            latest_by_target.setdefault(key, request)

        statuses: list[AccessRequestStatusView] = []
        for urn in unique_urns:
            target_state = target_states.get(urn)
            canonical_key = target_state.canonical_key if target_state is not None else None
            request = latest_by_target.get(canonical_key) if canonical_key else None
            statuses.append(
                AccessRequestStatusView(
                    requested_urn=urn,
                    state=request.state if request else None,
                    request_id=request.id if request else None,
                    can_request_again_at=self.can_request_again_at(request),
                    requester_has_access=(
                        target_state.requester_has_access if target_state is not None else False
                    ),
                )
            )
        return statuses

    async def get_access_request(
        self,
        *,
        actor_user_id: UUID,
        organization_id: UUID,
        request_id: UUID,
    ) -> AccessRequestView:
        await self.targets.require_active_member(actor_user_id, organization_id)
        request = await self.get_request(organization_id, request_id)
        target = await self.targets.resolve_request(request)
        if request.requester_id != actor_user_id and not await self.targets.reviewer_can_manage(
            actor_user_id,
            organization_id,
            target,
        ):
            raise PermissionDeniedError("review", "access_request")
        return await self.view(request, target)

    async def list_access_requests(
        self,
        *,
        actor_user_id: UUID,
        organization_id: UUID,
        canonical_content_type: ContentType | None,
        canonical_content_id: UUID | None,
        state: ContentAccessRequestState | None,
        page: int,
        page_size: int,
    ) -> AccessRequestPage:
        await self.targets.require_active_member(actor_user_id, organization_id)
        page = max(page, 1)
        page_size = min(max(page_size, 1), MAX_LIST_PAGE_SIZE)

        if canonical_content_type is None or canonical_content_id is None:
            raise ValidationError(
                "canonical_target",
                "A canonical content type and id are required",
            )
        canonical_urn = f"urn:uniffy:content:{canonical_content_type.value}:{canonical_content_id}"
        target = await self.targets.resolve(
            organization_id,
            canonical_urn,
            actor_id=actor_user_id,
        )
        if not await self.targets.reviewer_can_manage(
            actor_user_id,
            organization_id,
            target,
        ):
            raise PermissionDeniedError("review", "access_request")

        conditions = [
            ContentAccessRequest.organization_id == organization_id,
            ContentAccessRequest.canonical_content_type == canonical_content_type,
            ContentAccessRequest.canonical_content_id == canonical_content_id,
        ]
        if state is not None:
            conditions.append(ContentAccessRequest.state == state)

        total_items = (
            await self.session.execute(
                select(func.count()).select_from(ContentAccessRequest).where(*conditions)
            )
        ).scalar_one()
        offset = (page - 1) * page_size
        requests = list(
            (
                await self.session.execute(
                    select(ContentAccessRequest)
                    .where(*conditions)
                    .order_by(ContentAccessRequest.created_at.desc())
                    .offset(offset)
                    .limit(page_size)
                )
            )
            .scalars()
            .all()
        )
        requester_ids = {request.requester_id for request in requests}
        user_rows = (
            await self.session.execute(select(User).where(User.id.in_(requester_ids)))
        ).scalars()
        display_names = {user.id: user.full_name or user.username for user in user_rows}
        audience = ResourceAudienceResolver(self.session)
        if target.grant_kind == AccessGrantKind.CHAT:
            allowed = set(
                await audience.filter_chat(
                    organization_id=organization_id,
                    channel=target.canonical_row,
                    candidate_user_ids=requester_ids,
                )
            )
        else:
            row = target.canonical_row
            allowed = set(
                await audience.filter_standard(
                    organization_id=organization_id,
                    content_type=target.canonical_content_type,
                    content_id=target.canonical_content_id,
                    owner_id=row.owner_id,
                    access_mode=row.access_mode,
                    baseline_role=row.baseline_role,
                    candidate_user_ids=requester_ids,
                )
            )
        views = [
            await self.view(
                request,
                target,
                requester_has_access=request.requester_id in allowed,
                requester_display_name=display_names.get(request.requester_id),
            )
            for request in requests
        ]
        return AccessRequestPage(
            requests=views,
            page=page,
            page_size=page_size,
            total_items=total_items,
        )

    async def pending_request(
        self,
        requester_id: UUID,
        organization_id: UUID,
        target: AccessRequestTarget,
    ) -> ContentAccessRequest | None:
        return (
            await self.session.execute(
                select(ContentAccessRequest).where(
                    ContentAccessRequest.organization_id == organization_id,
                    ContentAccessRequest.requester_id == requester_id,
                    ContentAccessRequest.canonical_content_type == target.canonical_content_type,
                    ContentAccessRequest.canonical_content_id == target.canonical_content_id,
                    ContentAccessRequest.state == ContentAccessRequestState.PENDING,
                )
            )
        ).scalar_one_or_none()

    async def latest_request(
        self,
        requester_id: UUID,
        organization_id: UUID,
        target: AccessRequestTarget,
    ) -> ContentAccessRequest | None:
        return (
            await self.session.execute(
                select(ContentAccessRequest)
                .where(
                    ContentAccessRequest.organization_id == organization_id,
                    ContentAccessRequest.requester_id == requester_id,
                    ContentAccessRequest.canonical_content_type == target.canonical_content_type,
                    ContentAccessRequest.canonical_content_id == target.canonical_content_id,
                )
                .order_by(ContentAccessRequest.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def get_request(
        self,
        organization_id: UUID,
        request_id: UUID,
        *,
        for_update: bool = False,
    ) -> ContentAccessRequest:
        statement = select(ContentAccessRequest).where(
            ContentAccessRequest.id == request_id,
            ContentAccessRequest.organization_id == organization_id,
        )
        if for_update:
            statement = statement.with_for_update()
        request = (await self.session.execute(statement)).scalar_one_or_none()
        if request is None:
            raise NotFoundError("access_request", request_id)
        return request

    async def view(
        self,
        request: ContentAccessRequest,
        target: AccessRequestTarget,
        *,
        requester_has_access: bool | None = None,
        requester_display_name: str | None = None,
    ) -> AccessRequestView:
        if requester_display_name is None:
            user = (
                await self.session.execute(select(User).where(User.id == request.requester_id))
            ).scalar_one_or_none()
            if user is None:
                raise NotFoundError("user", request.requester_id)
            requester_display_name = user.full_name or user.username
        if requester_has_access is None:
            requester_has_access = await self.targets.requester_has_access(
                request.requester_id,
                request.organization_id,
                target,
            )
        return AccessRequestView(
            request=request,
            requester_display_name=requester_display_name,
            requester_has_access=requester_has_access,
            can_request_again_at=self.can_request_again_at(request),
        )

    @staticmethod
    def can_request_again_at(request: ContentAccessRequest | None) -> datetime | None:
        if request is None or request.state != ContentAccessRequestState.DENIED:
            return None
        denied_at = request.responded_at or request.updated_at
        retry_at = denied_at + DENIAL_COOLDOWN
        return retry_at if retry_at > datetime.now(UTC) else None
