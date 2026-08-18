"""Lifecycle operations for persisted content access requests."""

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.defaults import resolve_effective_policy
from uniffy.core.content.members import ContentMembersOperations
from uniffy.core.errors import ConflictError, PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.permissions.content_access_request import (
    ContentAccessRequest,
    ContentAccessRequestState,
)
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType, generate_id
from uniffy.core.valkey.rate_limit import check_rate_limit
from uniffy.domains.chat.channels.operations import ChatChannelOperations
from uniffy.domains.permissions.access_request_notifications import AccessRequestNotifier
from uniffy.domains.permissions.access_request_queries import (
    AccessRequestPage,
    AccessRequestQueries,
    AccessRequestStatusView,
    AccessRequestView,
)
from uniffy.domains.permissions.resource_access import AccessGrantKind
from uniffy.domains.permissions.resource_access.targets import (
    AccessRequestTarget,
    AccessRequestTargetResolver,
)

REQUEST_RATE_LIMIT = 10
REQUEST_RATE_WINDOW_SECONDS = 60 * 60


class RequestAccessOutcome(StrEnum):
    CREATED = "CREATED"
    ALREADY_PENDING = "ALREADY_PENDING"
    ALREADY_ACCESSIBLE = "ALREADY_ACCESSIBLE"
    COOLDOWN = "COOLDOWN"


class AccessRequestDecision(StrEnum):
    APPROVE = "APPROVE"
    DENY = "DENY"


@dataclass(frozen=True)
class RequestAccessResult:
    outcome: RequestAccessOutcome
    view: AccessRequestView | None = None
    can_request_again_at: datetime | None = None


class ContentAccessRequestOperations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.targets = AccessRequestTargetResolver(session)
        self.queries = AccessRequestQueries(session, self.targets)
        self.notifier = AccessRequestNotifier(session)

    async def request_access(
        self,
        *,
        requester_id: UUID,
        organization_id: UUID,
        requested_urn: str,
        message: str,
    ) -> RequestAccessResult:
        await self.targets.require_active_member(requester_id, organization_id)
        message = message.strip()
        if len(message) > 500:
            raise ValidationError("message", "Message must be 500 characters or fewer")

        target = await self.targets.resolve(
            organization_id,
            requested_urn,
            actor_id=requester_id,
        )
        if await self.targets.requester_has_access(requester_id, organization_id, target):
            return RequestAccessResult(RequestAccessOutcome.ALREADY_ACCESSIBLE)

        pending = await self.queries.pending_request(requester_id, organization_id, target)
        if pending is not None:
            return RequestAccessResult(
                RequestAccessOutcome.ALREADY_PENDING,
                view=await self.queries.view(pending, target),
            )

        latest = await self.queries.latest_request(requester_id, organization_id, target)
        can_request_again_at = self.queries.can_request_again_at(latest)
        if can_request_again_at is not None:
            return RequestAccessResult(
                RequestAccessOutcome.COOLDOWN,
                can_request_again_at=can_request_again_at,
            )

        await check_rate_limit(
            key=f"access_request:{organization_id}:{requester_id}",
            limit=REQUEST_RATE_LIMIT,
            window_seconds=REQUEST_RATE_WINDOW_SECONDS,
            resource="access requests",
        )

        now = datetime.now(UTC)
        request_id = generate_id()
        result = await self.session.execute(
            pg_insert(ContentAccessRequest)
            .values(
                id=request_id,
                organization_id=organization_id,
                requester_id=requester_id,
                requested_urn=requested_urn,
                original_content_type=target.original_content_type,
                original_content_id=target.original_content_id,
                canonical_content_type=target.canonical_content_type,
                canonical_content_id=target.canonical_content_id,
                state=ContentAccessRequestState.PENDING,
                message=message,
                decision_note="",
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_nothing()
            .returning(ContentAccessRequest)
        )
        request = result.scalar_one_or_none()
        if request is None:
            await self.session.rollback()
            request = await self.queries.pending_request(requester_id, organization_id, target)
            if request is None:
                raise ConflictError("access_request", "Concurrent request could not be loaded")
            return RequestAccessResult(
                RequestAccessOutcome.ALREADY_PENDING,
                view=await self.queries.view(request, target),
            )

        await self._write_audit(
            request,
            actor_user_id=requester_id,
            action=Action.PERMISSIONS_ACCESS_REQUESTED,
        )
        await self.session.commit()
        view = await self.queries.view(request, target)
        await self.notifier.notify_requested(request, target)
        await self.notifier.publish_state(request)
        return RequestAccessResult(
            RequestAccessOutcome.CREATED,
            view=view,
        )

    async def get_my_statuses(
        self,
        *,
        requester_id: UUID,
        organization_id: UUID,
        requested_urns: list[str],
    ) -> list[AccessRequestStatusView]:
        return await self.queries.get_my_statuses(
            requester_id=requester_id,
            organization_id=organization_id,
            requested_urns=requested_urns,
        )

    async def get_access_request(
        self,
        *,
        actor_user_id: UUID,
        organization_id: UUID,
        request_id: UUID,
    ) -> AccessRequestView:
        return await self.queries.get_access_request(
            actor_user_id=actor_user_id,
            organization_id=organization_id,
            request_id=request_id,
        )

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
        return await self.queries.list_access_requests(
            actor_user_id=actor_user_id,
            organization_id=organization_id,
            canonical_content_type=canonical_content_type,
            canonical_content_id=canonical_content_id,
            state=state,
            page=page,
            page_size=page_size,
        )

    async def respond(
        self,
        *,
        actor_user_id: UUID,
        organization_id: UUID,
        request_id: UUID,
        decision: AccessRequestDecision,
        approved_role: ContentRole | None,
        decision_note: str,
    ) -> AccessRequestView:
        await self.targets.require_active_member(actor_user_id, organization_id)
        decision_note = decision_note.strip()
        if len(decision_note) > 2000:
            raise ValidationError(
                "decision_note",
                "Decision note must be 2000 characters or fewer",
            )

        request = await self.queries.get_request(
            organization_id,
            request_id,
            for_update=True,
        )
        target = await self.targets.resolve_request(request)
        if not await self.targets.reviewer_can_manage(
            actor_user_id,
            organization_id,
            target,
        ):
            raise PermissionDeniedError("review", "access_request")

        if request.state != ContentAccessRequestState.PENDING:
            return await self._terminal_response(request, target, decision)

        if decision == AccessRequestDecision.DENY:
            if approved_role is not None:
                raise ValidationError("approved_role", "A denied request cannot include a role")
            await self._close_request(
                request,
                actor_user_id=actor_user_id,
                state=ContentAccessRequestState.DENIED,
                decision_note=decision_note,
            )
            await self._write_audit(
                request,
                actor_user_id=actor_user_id,
                action=Action.PERMISSIONS_ACCESS_REQUEST_DENIED,
            )
            await self.session.commit()
            view = await self.queries.view(request, target)
            await self.notifier.notify_denied(request, actor_user_id)
            await self.notifier.publish_state(request)
            return view

        await self.targets.require_active_member(request.requester_id, organization_id)
        if target.grant_kind == AccessGrantKind.CHAT:
            if approved_role is not None:
                raise ValidationError(
                    "approved_role",
                    "Private chat approval grants ordinary channel membership",
                )
        else:
            if approved_role is None:
                approved_role = ContentRole.VIEWER
            if approved_role not in {
                ContentRole.VIEWER,
                ContentRole.COMMENTER,
                ContentRole.EDITOR,
                ContentRole.ADMIN,
            }:
                raise ValidationError("approved_role", "Invalid role for an access request")

        requester_has_access = await self.targets.requester_has_access(
            request.requester_id,
            organization_id,
            target,
        )
        if not requester_has_access:
            await self._grant_access(
                request,
                target,
                actor_user_id=actor_user_id,
                approved_role=approved_role,
            )
            refreshed_target = await AccessRequestTargetResolver(self.session).resolve_request(
                request
            )
            requester_has_access = await AccessRequestTargetResolver(
                self.session
            ).requester_has_access(
                request.requester_id,
                organization_id,
                refreshed_target,
            )
            target = refreshed_target

        if not requester_has_access:
            raise ConflictError(
                "access_request",
                "The canonical grant did not provide view access; the request remains pending",
            )

        await self._close_request(
            request,
            actor_user_id=actor_user_id,
            state=ContentAccessRequestState.APPROVED,
            decision_note=decision_note,
            approved_role=approved_role,
        )
        await self._write_audit(
            request,
            actor_user_id=actor_user_id,
            action=Action.PERMISSIONS_ACCESS_REQUEST_APPROVED,
        )
        await self.session.commit()
        view = await self.queries.view(request, target, requester_has_access=True)
        await self.notifier.publish_state(request)
        return view

    async def cancel(
        self,
        *,
        requester_id: UUID,
        organization_id: UUID,
        request_id: UUID,
    ) -> AccessRequestView:
        await self.targets.require_active_member(requester_id, organization_id)
        request = await self.queries.get_request(
            organization_id,
            request_id,
            for_update=True,
        )
        if request.requester_id != requester_id:
            raise PermissionDeniedError("cancel", "access_request")
        target = await self.targets.resolve_request(request)
        if request.state == ContentAccessRequestState.CANCELED:
            return await self.queries.view(request, target)
        if request.state != ContentAccessRequestState.PENDING:
            raise ConflictError("access_request", "Only pending requests can be canceled")

        await self._close_request(
            request,
            actor_user_id=requester_id,
            state=ContentAccessRequestState.CANCELED,
            decision_note="",
        )
        await self._write_audit(
            request,
            actor_user_id=requester_id,
            action=Action.PERMISSIONS_ACCESS_REQUEST_CANCELED,
        )
        await self.session.commit()
        view = await self.queries.view(request, target)
        await self.notifier.publish_state(request)
        return view

    async def _grant_access(
        self,
        request: ContentAccessRequest,
        target: AccessRequestTarget,
        *,
        actor_user_id: UUID,
        approved_role: ContentRole | None,
    ) -> None:
        if target.grant_kind == AccessGrantKind.CHAT:
            await ChatChannelOperations(self.session).add_members(
                actor_user_id,
                request.organization_id,
                target.canonical_content_id,
                [request.requester_id],
            )
            return

        if approved_role is None:
            raise ValidationError("approved_role", "A standard content role is required")

        row = target.canonical_row
        checker = PermissionChecker(self.session)
        default_mode, default_baseline = await checker.get_org_defaults(
            request.organization_id,
            target.canonical_content_type,
        )
        effective_mode, _ = resolve_effective_policy(
            row.access_mode,
            row.baseline_role,
            default_mode,
            default_baseline,
        )
        members = ContentMembersOperations(self.session)
        if effective_mode == AccessMode.OWNER_ONLY:
            await members.set_access_mode(
                actor_user_id=actor_user_id,
                organization_id=request.organization_id,
                content_type=target.canonical_content_type,
                content_id=target.canonical_content_id,
                new_access_mode=AccessMode.EXPLICIT_MEMBERS,
                note=f"Approved access request {request.id}",
            )
        await members.add_member(
            actor_user_id=actor_user_id,
            organization_id=request.organization_id,
            content_type=target.canonical_content_type,
            content_id=target.canonical_content_id,
            subject_type=SubjectType.USER,
            subject_id=request.requester_id,
            role=approved_role,
            note=f"Approved access request {request.id}",
        )

    async def _terminal_response(
        self,
        request: ContentAccessRequest,
        target: AccessRequestTarget,
        decision: AccessRequestDecision,
    ) -> AccessRequestView:
        matching = (
            decision == AccessRequestDecision.APPROVE
            and request.state == ContentAccessRequestState.APPROVED
        ) or (
            decision == AccessRequestDecision.DENY
            and request.state == ContentAccessRequestState.DENIED
        )
        if not matching:
            raise ConflictError(
                "access_request", f"Request is already {request.state.value.lower()}"
            )
        return await self.queries.view(request, target)

    async def _close_request(
        self,
        request: ContentAccessRequest,
        *,
        actor_user_id: UUID,
        state: ContentAccessRequestState,
        decision_note: str,
        approved_role: ContentRole | None = None,
    ) -> None:
        now = datetime.now(UTC)
        request.state = state
        request.responded_by_user_id = actor_user_id
        request.responded_at = now
        request.updated_at = now
        request.decision_note = decision_note
        request.approved_role = approved_role
        self.session.add(request)

    async def _write_audit(
        self,
        request: ContentAccessRequest,
        *,
        actor_user_id: UUID,
        action: str,
    ) -> None:
        await write_audit_event(
            self.session,
            organization_id=request.organization_id,
            actor_user_id=actor_user_id,
            action=action,
            resource_type=AuditResourceType(request.canonical_content_type.value),
            resource_id=request.canonical_content_id,
            details={
                "request_id": str(request.id),
                "requested_urn": request.requested_urn,
                "requester_id": str(request.requester_id),
                "state": request.state.value,
                "approved_role": (
                    request.approved_role.value if request.approved_role is not None else None
                ),
                "decision_note": request.decision_note,
            },
        )
