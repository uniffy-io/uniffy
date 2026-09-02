"""Read-only platform audit feed; the whitelist is enforced server-side so
a fiddled request cannot widen scope.
"""

from __future__ import annotations

from datetime import datetime
from typing import NamedTuple
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.json_codec import dumps_str
from uniffy.core.models.audit.event import AuditEvent, AuditResourceType
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.user import User
from uniffy.domains.platform.audit.whitelist import (
    PLATFORM_ACTION_PREFIXES,
    is_platform_action,
    platform_action_catalog,
)
from uniffy.domains.users.operations import UserOperations

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


class PlatformAuditView(NamedTuple):
    id: UUID
    created_at: datetime
    action: str
    organization_id: UUID | None
    organization_name: str | None
    actor_user_id: UUID | None
    actor_email: str | None
    actor_org_role: str | None
    resource_type: AuditResourceType | None
    resource_id: UUID | None
    details_json: str
    ip_address: str | None
    user_agent: str | None


class PlatformAuditPage(NamedTuple):
    events: list[PlatformAuditView]
    total_count: int
    page: int
    page_size: int


def _safe_page(page: int) -> int:
    return page if page > 0 else 0


def _clamp_page_size(page_size: int) -> int:
    if page_size <= 0:
        return DEFAULT_PAGE_SIZE
    return min(page_size, MAX_PAGE_SIZE)


def _whitelist_or_clause():
    return or_(*(AuditEvent.action.like(f"{p}%") for p in PLATFORM_ACTION_PREFIXES))


class PlatformAuditOperations:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._user_ops = UserOperations(session)

    async def list_events(
        self,
        *,
        actor_user_id: UUID,
        page: int,
        page_size: int,
        organization_id: UUID | None = None,
        target_actor_user_id: UUID | None = None,
        actions: list[str] | None = None,
        from_ts: datetime | None = None,
        to_ts: datetime | None = None,
    ) -> PlatformAuditPage:
        await self._user_ops.require_system_admin(actor_user_id)

        page = _safe_page(page)
        page_size = _clamp_page_size(page_size)

        conditions = [_whitelist_or_clause()]

        if actions:
            allowed = [a for a in actions if is_platform_action(a)]
            if allowed:
                conditions.append(AuditEvent.action.in_(allowed))
            else:
                # All requested actions are outside the whitelist; refuse
                # rather than ignore the filter.
                return PlatformAuditPage(
                    events=[],
                    total_count=0,
                    page=page,
                    page_size=page_size,
                )

        if organization_id is not None:
            conditions.append(AuditEvent.organization_id == organization_id)
        if target_actor_user_id is not None:
            conditions.append(AuditEvent.actor_user_id == target_actor_user_id)
        if from_ts is not None:
            conditions.append(AuditEvent.created_at >= from_ts)
        if to_ts is not None:
            conditions.append(AuditEvent.created_at <= to_ts)

        where_clause = and_(*conditions)

        total = (
            await self._session.execute(
                select(func.count()).select_from(AuditEvent).where(where_clause)
            )
        ).scalar_one()

        events = (
            (
                await self._session.execute(
                    select(AuditEvent)
                    .where(where_clause)
                    .order_by(AuditEvent.created_at.desc())
                    .limit(page_size)
                    .offset(page * page_size)
                )
            )
            .scalars()
            .all()
        )

        if not events:
            return PlatformAuditPage(
                events=[],
                total_count=int(total),
                page=page,
                page_size=page_size,
            )

        org_ids = {e.organization_id for e in events if e.organization_id is not None}
        actor_ids = {e.actor_user_id for e in events if e.actor_user_id is not None}

        org_names: dict[UUID, str] = {}
        if org_ids:
            rows = (
                await self._session.execute(
                    select(Organization.id, Organization.name).where(Organization.id.in_(org_ids))
                )
            ).all()
            org_names = {oid: name for oid, name in rows}

        actor_emails: dict[UUID, str] = {}
        if actor_ids:
            rows = (
                await self._session.execute(
                    select(User.id, User.email).where(User.id.in_(actor_ids))
                )
            ).all()
            actor_emails = {uid: email for uid, email in rows}

        views = [
            PlatformAuditView(
                id=e.id,
                created_at=e.created_at,
                action=e.action,
                organization_id=e.organization_id,
                organization_name=org_names.get(e.organization_id) if e.organization_id else None,
                actor_user_id=e.actor_user_id,
                actor_email=actor_emails.get(e.actor_user_id) if e.actor_user_id else None,
                actor_org_role=e.actor_org_role,
                resource_type=e.resource_type,
                resource_id=e.resource_id,
                details_json=dumps_str(e.details or {}, default=str),
                ip_address=str(e.ip_address) if e.ip_address is not None else None,
                user_agent=e.user_agent,
            )
            for e in events
        ]
        return PlatformAuditPage(
            events=views,
            total_count=int(total),
            page=page,
            page_size=page_size,
        )

    async def list_actions(self, *, actor_user_id: UUID) -> list[tuple[str, str]]:
        await self._user_ops.require_system_admin(actor_user_id)
        return platform_action_catalog()
