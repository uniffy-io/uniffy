"""Lifecycle for platform support sessions; consent-bearing methods require
an actual org OWNER/ADMIN (sysadmin does not bypass).
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from typing import NamedTuple
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.events.bus import emit_notification
from uniffy.core.events.types import NotificationEvent
from uniffy.core.jobs import enqueue_job
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.models.platform.support_session import (
    SupportSession,
    SupportSessionScope,
    SupportSessionState,
)
from uniffy.core.rate_limit import check_rate_limit
from uniffy.core.types import NotificationType
from uniffy.domains.mail.jobs.contracts import SEND_EMAIL
from uniffy.domains.platform.support.errors import (
    SupportSessionScopeError,
    SupportSessionTransitionError,
)
from uniffy.domains.platform.support.policy import (
    ConsentMode,
    clamp_duration,
    effective_consent_mode,
)
from uniffy.domains.users.operations import UserOperations

logger = logger.bind(component="platform.support.operations")

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200

# Per-operator throughput cap; each request fans out to every owner of the target org.
_REQUEST_SESSION_LIMIT = 10
_REQUEST_SESSION_WINDOW_SECONDS = 60


def _clamp_duration(requested_minutes: int) -> int:
    return clamp_duration(requested_minutes)


class SupportSessionView(NamedTuple):
    id: UUID
    organization_id: UUID
    organization_name: str
    organization_slug: str
    support_user_id: UUID
    support_user_email: str
    support_user_full_name: str | None
    requested_by_user_id: UUID
    granted_by_user_id: UUID | None
    granted_by_email: str | None
    revoked_by_user_id: UUID | None
    revoked_by_email: str | None
    reason: str
    scope: SupportSessionScope
    state: SupportSessionState
    requested_at: datetime
    granted_at: datetime | None
    expires_at: datetime
    revoked_at: datetime | None
    created_at: datetime
    updated_at: datetime


class SupportSessionPage(NamedTuple):
    sessions: list[SupportSessionView]
    total_count: int
    page: int
    page_size: int


class ConsentModeView(NamedTuple):
    deployment: ConsentMode
    override: ConsentMode | None
    effective: ConsentMode
    locked_by_deployment: bool


_TERMINAL_STATES: frozenset[SupportSessionState] = frozenset({
    SupportSessionState.EXPIRED,
    SupportSessionState.REVOKED,
    SupportSessionState.REJECTED,
})


def _clamp_page_size(page_size: int) -> int:
    if page_size <= 0:
        return DEFAULT_PAGE_SIZE
    return min(page_size, MAX_PAGE_SIZE)


def _safe_page(page: int) -> int:
    return page if page > 0 else 0


class SupportSessionOperations:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._user_ops = UserOperations(session)

    async def request_session(
        self,
        *,
        actor_user_id: UUID,
        organization_id: UUID,
        reason: str,
        scope: SupportSessionScope,
        duration_minutes: int,
    ) -> SupportSessionView:
        await self._user_ops.require_system_admin(actor_user_id)
        await check_rate_limit(
            key=f"rl:platform:request_session:{actor_user_id}",
            limit=_REQUEST_SESSION_LIMIT,
            window_seconds=_REQUEST_SESSION_WINDOW_SECONDS,
            resource="support session requests",
        )

        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")
        if len(reason) > 2000:
            raise ValidationError("reason", "reason exceeds 2000 characters")

        if scope == SupportSessionScope.READ_WRITE:
            raise SupportSessionScopeError(scope.value)
        if scope != SupportSessionScope.READ_ONLY:
            raise SupportSessionScopeError(scope.value or "UNSPECIFIED")

        org = await self._require_org(organization_id)
        if org.deleted_at is not None:
            raise ValidationError("organization", "Cannot open a session for a deleted organization")

        duration = _clamp_duration(duration_minutes)
        now = datetime.now(UTC)
        expires_at = now + timedelta(minutes=duration)

        mode = await effective_consent_mode(self._session, org.id)
        requires_approval = mode == ConsentMode.OWNER_APPROVED
        initial_state = (
            SupportSessionState.PENDING if requires_approval else SupportSessionState.ACTIVE
        )
        granted_at = None if requires_approval else now

        row = SupportSession(
            organization_id=org.id,
            support_user_id=actor_user_id,
            requested_by_user_id=actor_user_id,
            reason=reason,
            scope=scope,
            state=initial_state,
            requested_at=now,
            granted_at=granted_at,
            expires_at=expires_at,
        )
        self._session.add(row)
        await self._session.flush()

        await write_audit_event(
            self._session,
            organization_id=org.id,
            actor_user_id=actor_user_id,
            action=Action.SUPPORT_SESSION_REQUESTED,
            resource_type=AuditResourceType.SUPPORT_SESSION,
            resource_id=row.id,
            details={
                "reason": reason,
                "scope": scope.value,
                "duration_minutes": duration,
                "initial_state": initial_state.value,
            },
        )
        if initial_state == SupportSessionState.ACTIVE:
            await write_audit_event(
                self._session,
                organization_id=org.id,
                actor_user_id=actor_user_id,
                action=Action.SUPPORT_SESSION_STARTED,
                resource_type=AuditResourceType.SUPPORT_SESSION,
                resource_id=row.id,
                details={"scope": scope.value},
            )

        await self._session.commit()

        lifecycle_event = "requested" if initial_state == SupportSessionState.PENDING else "started"
        await self._fanout_lifecycle(row, lifecycle_event)

        return await self._build_view(row)

    async def approve_session(self, *, actor_user_id: UUID, session_id: UUID) -> SupportSessionView:
        """Platform sysadmins cannot approve here; consent must come from an actual org admin."""
        row = await self._require_session(session_id)
        await self._require_actual_org_admin(actor_user_id, row.organization_id)

        if row.state != SupportSessionState.PENDING:
            raise SupportSessionTransitionError(row.state.value, "approve")

        now = datetime.now(UTC)
        if row.expires_at <= now:
            row.state = SupportSessionState.EXPIRED
            self._session.add(row)
            await write_audit_event(
                self._session,
                organization_id=row.organization_id,
                actor_user_id=actor_user_id,
                action=Action.SUPPORT_SESSION_EXPIRED,
                resource_type=AuditResourceType.SUPPORT_SESSION,
                resource_id=row.id,
                details={"reason": "expired_before_approval"},
            )
            await self._session.commit()
            return await self._build_view(row)

        row.state = SupportSessionState.ACTIVE
        row.granted_at = now
        row.granted_by_user_id = actor_user_id
        self._session.add(row)

        await write_audit_event(
            self._session,
            organization_id=row.organization_id,
            actor_user_id=actor_user_id,
            action=Action.SUPPORT_SESSION_APPROVED,
            resource_type=AuditResourceType.SUPPORT_SESSION,
            resource_id=row.id,
            details={"scope": row.scope.value},
        )
        await write_audit_event(
            self._session,
            organization_id=row.organization_id,
            actor_user_id=actor_user_id,
            action=Action.SUPPORT_SESSION_STARTED,
            resource_type=AuditResourceType.SUPPORT_SESSION,
            resource_id=row.id,
            details={"scope": row.scope.value},
        )
        await self._session.commit()

        await self._fanout_lifecycle(row, "started")

        return await self._build_view(row)

    async def reject_session(
        self, *, actor_user_id: UUID, session_id: UUID, reason: str
    ) -> SupportSessionView:
        row = await self._require_session(session_id)
        await self._require_actual_org_admin(actor_user_id, row.organization_id)

        if row.state != SupportSessionState.PENDING:
            raise SupportSessionTransitionError(row.state.value, "reject")

        row.state = SupportSessionState.REJECTED
        self._session.add(row)

        await write_audit_event(
            self._session,
            organization_id=row.organization_id,
            actor_user_id=actor_user_id,
            action=Action.SUPPORT_SESSION_REJECTED,
            resource_type=AuditResourceType.SUPPORT_SESSION,
            resource_id=row.id,
            details={"reason": reason.strip()},
        )
        await self._session.commit()
        return await self._build_view(row)

    async def revoke_session(
        self, *, actor_user_id: UUID, session_id: UUID, reason: str
    ) -> SupportSessionView:
        """Either side may end an ACTIVE or PENDING session early.

        Three allowed actors: the support user themselves (self-end),
        an actual org OWNER/ADMIN of the tenant (consent withdrawal),
        or any platform sysadmin (operational override). Routing
        through ``_require_actual_org_admin`` for non-support callers
        forces sysadmins down an explicit branch so the audit row
        records the true revoker kind instead of mislabelling them as
        "org_admin".
        """
        row = await self._require_session(session_id)

        is_support_user = row.support_user_id == actor_user_id
        is_sysadmin = False
        if not is_support_user:
            try:
                await self._require_actual_org_admin(actor_user_id, row.organization_id)
            except PermissionDeniedError:
                actor = (
                    await self._session.execute(select(User).where(User.id == actor_user_id))
                ).scalar_one_or_none()
                if actor is None or not actor.is_system_admin:
                    raise
                is_sysadmin = True

        if row.state in _TERMINAL_STATES:
            raise SupportSessionTransitionError(row.state.value, "revoke")

        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")
        if len(reason) > 2000:
            raise ValidationError("reason", "reason exceeds 2000 characters")

        now = datetime.now(UTC)
        row.state = SupportSessionState.REVOKED
        row.revoked_at = now
        row.revoked_by_user_id = actor_user_id
        self._session.add(row)

        revoked_by_kind = (
            "support" if is_support_user else ("sysadmin" if is_sysadmin else "org_admin")
        )
        await write_audit_event(
            self._session,
            organization_id=row.organization_id,
            actor_user_id=actor_user_id,
            action=Action.SUPPORT_SESSION_REVOKED,
            resource_type=AuditResourceType.SUPPORT_SESSION,
            resource_id=row.id,
            details={
                "reason": reason,
                "revoked_by_kind": revoked_by_kind,
            },
        )
        await self._session.commit()

        await self._fanout_lifecycle(row, "revoked", extra={"revoke_reason": reason})

        return await self._build_view(row)

    async def list_my_sessions(
        self,
        *,
        actor_user_id: UUID,
        page: int,
        page_size: int,
        include_inactive: bool,
    ) -> SupportSessionPage:
        await self._user_ops.require_system_admin(actor_user_id)
        return await self._list_paged(
            extra_where=[SupportSession.support_user_id == actor_user_id],
            page=page,
            page_size=page_size,
            include_inactive=include_inactive,
        )

    async def list_org_sessions(
        self,
        *,
        actor_user_id: UUID,
        organization_id: UUID,
        page: int,
        page_size: int,
        include_inactive: bool,
    ) -> SupportSessionPage:
        """Sysadmins use ``list_all_sessions`` and do not pass through this org-owner gate."""
        await self._require_actual_org_admin(actor_user_id, organization_id)
        return await self._list_paged(
            extra_where=[SupportSession.organization_id == organization_id],
            page=page,
            page_size=page_size,
            include_inactive=include_inactive,
        )

    async def list_all_sessions(
        self,
        *,
        actor_user_id: UUID,
        page: int,
        page_size: int,
        state: SupportSessionState | None,
        search: str,
    ) -> SupportSessionPage:
        await self._user_ops.require_system_admin(actor_user_id)

        extra_where = []
        if state is not None:
            extra_where.append(SupportSession.state == state)

        normalized = search.strip().lower() if search else ""
        if normalized:
            pattern = f"%{normalized}%"
            org_ids = (
                (
                    await self._session.execute(
                        select(Organization.id).where(
                            or_(
                                func.lower(Organization.name).like(pattern),
                                func.lower(Organization.slug).like(pattern),
                            )
                        )
                    )
                )
                .scalars()
                .all()
            )
            user_ids = (
                (
                    await self._session.execute(
                        select(User.id).where(func.lower(User.email).like(pattern))
                    )
                )
                .scalars()
                .all()
            )
            if not org_ids and not user_ids:
                return SupportSessionPage(
                    sessions=[],
                    total_count=0,
                    page=_safe_page(page),
                    page_size=_clamp_page_size(page_size),
                )
            extra_where.append(
                or_(
                    SupportSession.organization_id.in_(list(org_ids) or [None]),
                    SupportSession.support_user_id.in_(list(user_ids) or [None]),
                )
            )

        return await self._list_paged(
            extra_where=extra_where,
            page=page,
            page_size=page_size,
            include_inactive=True,
        )

    async def active_session_for(
        self, *, user_id: UUID, organization_id: UUID
    ) -> SupportSession | None:
        return (
            await self._session.execute(
                select(SupportSession)
                .where(SupportSession.support_user_id == user_id)
                .where(SupportSession.organization_id == organization_id)
                .where(SupportSession.state == SupportSessionState.ACTIVE)
                .where(SupportSession.expires_at > datetime.now(UTC))
                .order_by(SupportSession.granted_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def get_org_consent_mode(
        self,
        *,
        actor_user_id: UUID,
        organization_id: UUID,
    ) -> ConsentModeView:
        """Caller must be a platform admin OR an org OWNER/ADMIN of the target org."""
        from uniffy.core.models.login.user import User

        user = (
            await self._session.execute(select(User).where(User.id == actor_user_id))
        ).scalar_one_or_none()
        if user is None:
            raise PermissionDeniedError("Caller is not authenticated")
        if not user.is_system_admin:
            await self._require_org_admin(actor_user_id, organization_id)
        await self._require_org(organization_id)
        from uniffy.domains.platform.support.policy import (
            deployment_consent_mode,
            effective_consent_mode,
            org_override,
        )

        deployment = deployment_consent_mode()
        override = await org_override(self._session, organization_id)
        effective = await effective_consent_mode(self._session, organization_id)
        return ConsentModeView(
            deployment=deployment,
            override=override,
            effective=effective,
            locked_by_deployment=deployment == ConsentMode.OWNER_APPROVED,
        )

    async def set_org_consent_mode(
        self,
        *,
        actor_user_id: UUID,
        organization_id: UUID,
        mode: ConsentMode | None,
    ) -> ConsentModeView:
        """``mode=None`` clears the override; sysadmins do not bypass since
        the override belongs to the tenant.
        """
        await self._require_actual_org_admin(actor_user_id, organization_id)
        await self._require_org(organization_id)

        from uniffy.domains.platform.support.policy import (
            set_org_override,
        )

        await set_org_override(
            self._session,
            organization_id=organization_id,
            mode=mode,
            updated_by_user_id=actor_user_id,
        )

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            action=Action.SUPPORT_SESSION_CONSENT_MODE_CHANGED,
            resource_type=AuditResourceType.ORGANIZATION,
            resource_id=organization_id,
            details={"mode": mode.value if mode else None},
        )
        await self._session.commit()
        return await self.get_org_consent_mode(
            actor_user_id=actor_user_id, organization_id=organization_id
        )

    async def sweep_expired(self) -> int:
        """Flip ACTIVE/PENDING rows past ``expires_at`` to EXPIRED; idempotent, drains in batches."""
        total_flipped = 0
        batch_size = 500
        while True:
            now = datetime.now(UTC)
            rows = (
                (
                    await self._session.execute(
                        select(SupportSession)
                        .where(
                            or_(
                                and_(
                                    SupportSession.state == SupportSessionState.ACTIVE,
                                    SupportSession.expires_at <= now,
                                ),
                                and_(
                                    SupportSession.state == SupportSessionState.PENDING,
                                    SupportSession.expires_at <= now,
                                ),
                            )
                        )
                        .limit(batch_size)
                    )
                )
                .scalars()
                .all()
            )

            if not rows:
                break

            for row in rows:
                row.state = SupportSessionState.EXPIRED
                self._session.add(row)
                await write_audit_event(
                    self._session,
                    organization_id=row.organization_id,
                    actor_user_id=None,
                    action=Action.SUPPORT_SESSION_EXPIRED,
                    resource_type=AuditResourceType.SUPPORT_SESSION,
                    resource_id=row.id,
                    details={"reason": "deadline"},
                )
            await self._session.commit()

            for row in rows:
                await self._fanout_lifecycle(row, "expired")

            total_flipped += len(rows)
            if len(rows) < batch_size:
                break
        return total_flipped

    async def _require_org(self, organization_id: UUID) -> Organization:
        org = (
            await self._session.execute(
                select(Organization).where(Organization.id == organization_id)
            )
        ).scalar_one_or_none()
        if org is None:
            raise NotFoundError("Organization", str(organization_id))
        return org

    async def _require_session(self, session_id: UUID) -> SupportSession:
        row = (
            await self._session.execute(
                select(SupportSession).where(SupportSession.id == session_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFoundError("SupportSession", str(session_id))
        return row

    async def _require_actual_org_admin(
        self, user_id: UUID, organization_id: UUID
    ) -> OrganizationMember:
        """Sysadmin does NOT bypass; consent-bearing methods refuse operator self-approval."""
        membership = (
            await self._session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.user_id == user_id,
                    OrganizationMember.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if membership is None or not membership.is_active:
            raise PermissionDeniedError("Not a member of the target organization")
        if membership.role not in (OrganizationRole.OWNER, OrganizationRole.ADMIN):
            raise PermissionDeniedError("Only org OWNER or ADMIN can perform this action")
        return membership

    async def _require_org_admin(self, user_id: UUID, organization_id: UUID) -> OrganizationMember:
        """OWNER/ADMIN or platform sysadmin; reserved for actions where
        sysadmin bypass is intentional.
        """
        user = (
            await self._session.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if user is None:
            raise PermissionDeniedError("Caller is not authenticated")
        if user.is_system_admin:
            # Access to tenant CONTENT still goes through active_session_for
            # + PermissionChecker, not this gate.
            member = (
                await self._session.execute(
                    select(OrganizationMember).where(
                        OrganizationMember.user_id == user_id,
                        OrganizationMember.organization_id == organization_id,
                    )
                )
            ).scalar_one_or_none()
            return member or OrganizationMember(
                user_id=user_id,
                organization_id=organization_id,
                role=OrganizationRole.MEMBER,
                is_active=False,
            )

        membership = (
            await self._session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.user_id == user_id,
                    OrganizationMember.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if membership is None or not membership.is_active:
            raise PermissionDeniedError("Not a member of the target organization")
        if membership.role not in (OrganizationRole.OWNER, OrganizationRole.ADMIN):
            raise PermissionDeniedError("Only org OWNER or ADMIN can manage support sessions")
        return membership

    async def _list_paged(
        self,
        *,
        extra_where: list,
        page: int,
        page_size: int,
        include_inactive: bool,
    ) -> SupportSessionPage:
        page = _safe_page(page)
        page_size = _clamp_page_size(page_size)

        conditions = list(extra_where)
        if not include_inactive:
            conditions.append(
                SupportSession.state.in_([
                    SupportSessionState.PENDING,
                    SupportSessionState.ACTIVE,
                ])
            )
        where_clause = and_(*conditions) if conditions else None

        count_query = select(func.count()).select_from(SupportSession)
        if where_clause is not None:
            count_query = count_query.where(where_clause)
        total = (await self._session.execute(count_query)).scalar_one()

        query = select(SupportSession).order_by(SupportSession.requested_at.desc())
        if where_clause is not None:
            query = query.where(where_clause)
        query = query.limit(page_size).offset(page * page_size)
        rows = (await self._session.execute(query)).scalars().all()

        views = [await self._build_view(row) for row in rows]
        return SupportSessionPage(
            sessions=views,
            total_count=int(total),
            page=page,
            page_size=page_size,
        )

    async def _build_view(self, row: SupportSession) -> SupportSessionView:
        org_name = ""
        org_slug = ""
        org_row = (
            await self._session.execute(
                select(Organization.name, Organization.slug).where(
                    Organization.id == row.organization_id
                )
            )
        ).first()
        if org_row is not None:
            org_name, org_slug = org_row

        user_ids = {row.support_user_id}
        if row.granted_by_user_id:
            user_ids.add(row.granted_by_user_id)
        if row.revoked_by_user_id:
            user_ids.add(row.revoked_by_user_id)
        users = (
            await self._session.execute(
                select(User.id, User.email, User.full_name).where(User.id.in_(user_ids))
            )
        ).all()
        emails = {uid: (email, full_name) for uid, email, full_name in users}

        support_email, support_full = emails.get(row.support_user_id, ("", None))
        granted_email = (
            emails.get(row.granted_by_user_id, (None, None))[0] if row.granted_by_user_id else None
        )
        revoked_email = (
            emails.get(row.revoked_by_user_id, (None, None))[0] if row.revoked_by_user_id else None
        )

        return SupportSessionView(
            id=row.id,
            organization_id=row.organization_id,
            organization_name=org_name,
            organization_slug=org_slug,
            support_user_id=row.support_user_id,
            support_user_email=support_email,
            support_user_full_name=support_full,
            requested_by_user_id=row.requested_by_user_id,
            granted_by_user_id=row.granted_by_user_id,
            granted_by_email=granted_email,
            revoked_by_user_id=row.revoked_by_user_id,
            revoked_by_email=revoked_email,
            reason=row.reason,
            scope=row.scope,
            state=row.state,
            requested_at=row.requested_at,
            granted_at=row.granted_at,
            expires_at=row.expires_at,
            revoked_at=row.revoked_at,
            created_at=row.created_at,
            updated_at=row.updated_at or row.created_at,
        )

    async def _fanout_lifecycle(
        self,
        row: SupportSession,
        event: str,
        *,
        extra: dict | None = None,
    ) -> None:
        """Best-effort; never raises so a Valkey hiccup doesn't break the lifecycle commit."""
        owners = await self._fetch_org_owners(row.organization_id)
        if not owners:
            return

        operator_email = (
            await self._session.execute(select(User.email).where(User.id == row.support_user_id))
        ).scalar_one_or_none() or ""
        org_row = (
            await self._session.execute(
                select(Organization.name).where(Organization.id == row.organization_id)
            )
        ).scalar_one_or_none()
        org_name = org_row or "your workspace"

        await self._fire_in_app_notification(row, event, owners, operator_email, org_name)
        await self._fire_emails(row, event, owners, operator_email, org_name, extra or {})

    async def _fetch_org_owners(self, org_id) -> list[tuple]:
        rows = (
            await self._session.execute(
                select(User.id, User.email, User.full_name)
                .join(OrganizationMember, OrganizationMember.user_id == User.id)
                .where(OrganizationMember.organization_id == org_id)
                .where(OrganizationMember.role == OrganizationRole.OWNER)
                .where(OrganizationMember.is_active.is_(True))
                .where(User.is_active.is_(True))
            )
        ).all()
        return list(rows)

    async def _fire_in_app_notification(
        self,
        row: SupportSession,
        event: str,
        owners: list[tuple],
        operator_email: str,
        org_name: str,
    ) -> None:
        notification_type = {
            "requested": NotificationType.SUPPORT_SESSION_REQUESTED,
            "started": NotificationType.SUPPORT_SESSION_STARTED,
            "revoked": NotificationType.SUPPORT_SESSION_REVOKED,
            "expired": NotificationType.SUPPORT_SESSION_EXPIRED,
        }.get(event)
        if notification_type is None:
            return

        title = {
            "requested": "Support access request",
            "started": "Support session started",
            "revoked": "Support session ended",
            "expired": "Support session expired",
        }[event]
        body = {
            "requested": (
                f"{operator_email} is requesting temporary access to "
                f"{org_name}. Review the request to approve or reject."
            ),
            "started": (
                f"{operator_email} now has read-only access to {org_name}. "
                "You can revoke at any time from the in-app banner."
            ),
            "revoked": (f"The support session by {operator_email} for {org_name} has ended."),
            "expired": (
                f"The support session by {operator_email} for {org_name} "
                "reached its deadline and was closed automatically."
            ),
        }[event]

        try:
            await emit_notification(
                NotificationEvent(
                    notification_type=notification_type,
                    organization_id=row.organization_id,
                    actor_id=row.support_user_id,
                    title=title,
                    body=body,
                    target_user_ids=[uid for uid, _, _ in owners],
                    metadata={
                        "support_session_id": str(row.id),
                        "scope": row.scope.value,
                        "state": row.state.value,
                        "expires_at": row.expires_at.isoformat(),
                    },
                )
            )
        except Exception:
            logger.warning(
                "support_session fanout: in-app notification enqueue failed",
                session_id=str(row.id),
            )

    async def _fire_emails(
        self,
        row: SupportSession,
        event: str,
        owners: list[tuple],
        operator_email: str,
        org_name: str,
        extra: dict,
    ) -> None:
        template = {
            "requested": "support/session_requested",
            "started": "support/session_started",
            "revoked": "support/session_revoked",
            # No email for expired; the owner already opted into time-bounded access.
        }.get(event)
        if template is None:
            return

        duration_minutes = max(
            1,
            int((row.expires_at - row.requested_at).total_seconds() / 60),
        )
        expires_at_str = row.expires_at.strftime("%B %d, %Y at %H:%M UTC")
        revoked_by = ""
        if row.revoked_by_user_id:
            if row.revoked_by_user_id == row.support_user_id:
                revoked_by = "the operator"
            else:
                revoked_by = "your admin"

        context: dict = {
            "org_name": org_name,
            "operator_email": operator_email or "a platform operator",
            "duration_minutes": duration_minutes,
            "scope": row.scope.value,
            "reason": row.reason,
            "expires_at": expires_at_str,
            "revoke_reason": extra.get("revoke_reason", ""),
            "revoked_by": revoked_by,
            "app_url": os.getenv("UNIFFY_BASE_URL", "").rstrip("/"),
        }

        for user_id, email, _ in owners:
            idempotency_key = f"support_session/{row.id}/{event}/{user_id}"
            try:
                await enqueue_job(
                    SEND_EMAIL,
                    email,
                    template,
                    dumps_str(context),
                    organization_id=str(row.organization_id),
                    idempotency_key=idempotency_key,
                    user_id=str(user_id),
                )
            except RuntimeError:
                logger.warning(
                    "support_session fanout: core queue not initialised",
                    session_id=str(row.id),
                )
                return
            except Exception:
                logger.warning(
                    "support_session fanout: email enqueue failed",
                    session_id=str(row.id),
                    event=event,
                )
