"""Read-only operations over the central audit-event table."""

from __future__ import annotations

import base64
import enum
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.membership import get_active_membership
from uniffy.core.auth.permissions.support import get_active_support_access
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.json_codec import dumps_bytes, loads
from uniffy.core.models.audit.event import AuditEvent, AuditResourceType
from uniffy.core.models.login.organization_member import OrganizationRole

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 500


class SortOrder(enum.Enum):
    TIME_DESC = "time_desc"
    TIME_ASC = "time_asc"


@dataclass(frozen=True)
class ListEventsFilter:
    organization_id: UUID
    actor_user_id: UUID | None = None
    actions: tuple[str, ...] = ()
    resource_type: AuditResourceType | None = None
    resource_id: UUID | None = None
    from_time: datetime | None = None
    to_time: datetime | None = None
    page_size: int = DEFAULT_PAGE_SIZE
    page_token: str | None = None
    order: SortOrder = field(default=SortOrder.TIME_DESC)


@dataclass(frozen=True)
class ListEventsPage:
    events: list[AuditEvent]
    next_page_token: str | None


class AuditOperations:
    """Read-only operations on the central audit log."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_events(
        self,
        actor_user_id: UUID,
        filters: ListEventsFilter,
    ) -> ListEventsPage:
        await self.require_audit_view(actor_user_id, filters.organization_id)

        page_size = max(1, min(filters.page_size or DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))

        query = select(AuditEvent).where(AuditEvent.organization_id == filters.organization_id)

        if filters.actor_user_id is not None:
            query = query.where(AuditEvent.actor_user_id == filters.actor_user_id)
        if filters.actions:
            query = query.where(AuditEvent.action.in_(filters.actions))
        if filters.resource_type is not None:
            query = query.where(AuditEvent.resource_type == filters.resource_type)
        if filters.resource_id is not None:
            query = query.where(AuditEvent.resource_id == filters.resource_id)
        if filters.from_time is not None:
            query = query.where(AuditEvent.created_at >= filters.from_time)
        if filters.to_time is not None:
            query = query.where(AuditEvent.created_at <= filters.to_time)

        if filters.page_token:
            cursor_created_at, cursor_id = _decode_cursor(filters.page_token)
            if filters.order is SortOrder.TIME_ASC:
                query = query.where(
                    or_(
                        AuditEvent.created_at > cursor_created_at,
                        and_(
                            AuditEvent.created_at == cursor_created_at,
                            AuditEvent.id > cursor_id,
                        ),
                    )
                )
            else:
                query = query.where(
                    or_(
                        AuditEvent.created_at < cursor_created_at,
                        and_(
                            AuditEvent.created_at == cursor_created_at,
                            AuditEvent.id < cursor_id,
                        ),
                    )
                )

        if filters.order is SortOrder.TIME_ASC:
            query = query.order_by(AuditEvent.created_at.asc(), AuditEvent.id.asc())
        else:
            query = query.order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())

        query = query.limit(page_size + 1)

        rows = list((await self.session.execute(query)).scalars().all())

        next_token: str | None = None
        if len(rows) > page_size:
            tail = rows[page_size - 1]
            next_token = _encode_cursor(tail.created_at, tail.id)
            rows = rows[:page_size]

        return ListEventsPage(events=rows, next_page_token=next_token)

    async def require_audit_view(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
    ) -> None:
        """Require org ownership/admin or audited non-member support access."""
        membership = await get_active_membership(
            self.session,
            actor_user_id,
            organization_id,
        )
        if membership is not None and membership.role in (
            OrganizationRole.OWNER,
            OrganizationRole.ADMIN,
        ):
            return
        if membership is not None:
            raise PermissionDeniedError("view", "audit_events")

        if (
            await get_active_support_access(
                self.session,
                actor_user_id,
                organization_id,
            )
            is None
        ):
            raise PermissionDeniedError("view", "audit_events")


def _encode_cursor(created_at: datetime, event_id: UUID) -> str:
    payload = dumps_bytes({"t": created_at.isoformat(), "i": str(event_id)})
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_cursor(token: str) -> tuple[datetime, UUID]:
    try:
        padding = "=" * (-len(token) % 4)
        payload = base64.urlsafe_b64decode((token + padding).encode("ascii"))
        data = loads(payload)
        return datetime.fromisoformat(data["t"]), UUID(data["i"])
    except (ValueError, KeyError, TypeError) as exc:
        raise ValidationError("page_token", "Malformed pagination cursor") from exc
