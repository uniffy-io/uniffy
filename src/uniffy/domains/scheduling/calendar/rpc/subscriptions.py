"""External calendar feed subscription RPC handlers; unsubscribing rides DeleteCalendar."""

from uuid import UUID

from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.cal.v1.calendar_pb import Calendar as ProtoCalendar
from uniffy_proto.cal.v1.calendar_pb import (
    CreateCalendarSubscriptionRequest,
    CreateCalendarSubscriptionResponse,
    RefreshCalendarSubscriptionRequest,
    RefreshCalendarSubscriptionResponse,
    UpdateCalendarSubscriptionRequest,
    UpdateCalendarSubscriptionResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.search import SearchIndexer
from uniffy.domains.scheduling.calendar.calendars.reader import CalendarReader
from uniffy.domains.scheduling.calendar.rpc.calendars import listings_to_proto
from uniffy.domains.scheduling.calendar.rpc.support import map_domain_error, parse_uuid
from uniffy.domains.scheduling.calendar.subscriptions.converters import failure_to_proto
from uniffy.domains.scheduling.calendar.subscriptions.operations import (
    CalendarSubscriptionOperations,
)
from uniffy.domains.scheduling.calendar.subscriptions.verify import FeedCheckFailed
from uniffy.infrastructure.database import open_session


async def _calendar_message(
    session: AsyncSession, user_id: UUID, organization_id: UUID, calendar_id: UUID
) -> ProtoCalendar:
    listing = await CalendarReader(session).get_listing(user_id, organization_id, calendar_id)
    (message,) = await listings_to_proto(session, user_id, organization_id, [listing])
    return message


class SubscriptionHandlers:
    search_indexer: SearchIndexer

    async def create_calendar_subscription(
        self,
        request: CreateCalendarSubscriptionRequest,
        ctx: RequestContext,
    ) -> CreateCalendarSubscriptionResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        try:
            async with open_session() as session:
                calendar = await CalendarSubscriptionOperations(session, self.search_indexer).create(
                    user_id,
                    organization_id,
                    url=request.url,
                    name=request.name,
                    color=request.color,
                    refresh_interval_minutes=request.refresh_interval_minutes or None,
                    counts_as_busy=request.counts_as_busy,
                )
                message = await _calendar_message(session, user_id, organization_id, calendar.id)
        except FeedCheckFailed as refused:
            # An answer, not an error: the form shows why and keeps what was typed.
            return CreateCalendarSubscriptionResponse(
                check_error=failure_to_proto(refused.failure),
                check_error_status=refused.status or 0,
            )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_calendar_subscription", exc) from exc
        return CreateCalendarSubscriptionResponse(calendar=message)

    async def update_calendar_subscription(
        self,
        request: UpdateCalendarSubscriptionRequest,
        ctx: RequestContext,
    ) -> UpdateCalendarSubscriptionResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        calendar_id = parse_uuid(request.calendar_id, "calendar_id")
        try:
            async with open_session() as session:
                refused: FeedCheckFailed | None = None
                try:
                    await CalendarSubscriptionOperations(session, self.search_indexer).update(
                        user_id,
                        organization_id,
                        calendar_id,
                        url=request.url if request.has_field("url") else None,
                        refresh_interval_minutes=(
                            request.refresh_interval_minutes
                            if request.has_field("refresh_interval_minutes")
                            else None
                        ),
                        counts_as_busy=(
                            request.counts_as_busy if request.has_field("counts_as_busy") else None
                        ),
                    )
                except FeedCheckFailed as failed:
                    refused = failed
                message = await _calendar_message(session, user_id, organization_id, calendar_id)
            if refused is not None:
                return UpdateCalendarSubscriptionResponse(
                    calendar=message,
                    check_error=failure_to_proto(refused.failure),
                    check_error_status=refused.status or 0,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_calendar_subscription", exc) from exc
        return UpdateCalendarSubscriptionResponse(calendar=message)

    async def refresh_calendar_subscription(
        self,
        request: RefreshCalendarSubscriptionRequest,
        ctx: RequestContext,
    ) -> RefreshCalendarSubscriptionResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        calendar_id = parse_uuid(request.calendar_id, "calendar_id")
        try:
            async with open_session() as session:
                await CalendarSubscriptionOperations(session, self.search_indexer).refresh_now(
                    user_id, organization_id, calendar_id
                )
                message = await _calendar_message(session, user_id, organization_id, calendar_id)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("refresh_calendar_subscription", exc) from exc
        return RefreshCalendarSubscriptionResponse(calendar=message)
