"""Calendar RPC handlers; sharing rides permissions.v1.MembersService."""

from collections.abc import Sequence

from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.cal.v1.calendar_pb import Calendar as ProtoCalendar
from uniffy_proto.cal.v1.calendar_pb import (
    CalendarEventDisposition,
    CreateCalendarRequest,
    CreateCalendarResponse,
    DeleteCalendarRequest,
    DeleteCalendarResponse,
    GetCalendarRequest,
    GetCalendarResponse,
    ListCalendarsRequest,
    ListCalendarsResponse,
    SetCalendarVisibilityRequest,
    SetCalendarVisibilityResponse,
    UpdateCalendarRequest,
    UpdateCalendarResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters.common_proto import access_mode_from_proto, content_role_from_proto
from uniffy.core.errors import ValidationError
from uniffy.core.models.login.user import User
from uniffy.core.search import SearchIndexer
from uniffy.core.types import ContentType
from uniffy.domains.permissions.access import ResourceAccessResolver, ResourceKey
from uniffy.domains.scheduling.calendar import queries
from uniffy.domains.scheduling.calendar.calendars.converters import (
    calendar_to_proto,
    calendar_type_from_proto,
)
from uniffy.domains.scheduling.calendar.calendars.operations import CalendarOperations
from uniffy.domains.scheduling.calendar.calendars.reader import CalendarListing, CalendarReader
from uniffy.domains.scheduling.calendar.rpc.support import map_domain_error, parse_uuid
from uniffy.infrastructure.database import open_session


class CalendarManagementHandlers:
    search_indexer: SearchIndexer

    async def list_calendars(
        self,
        request: ListCalendarsRequest,
        ctx: RequestContext,
    ) -> ListCalendarsResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        try:
            async with open_session() as session:
                # Every member has somewhere to put an event, even before their first one.
                await queries.ensure_default_calendar(session, organization_id, user_id)
                listings = await CalendarReader(session).list_calendars(user_id, organization_id)
                calendars = await _to_proto(session, user_id, organization_id, listings)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_calendars", exc) from exc
        return ListCalendarsResponse(calendars=calendars)

    async def get_calendar(
        self,
        request: GetCalendarRequest,
        ctx: RequestContext,
    ) -> GetCalendarResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        calendar_id = parse_uuid(request.calendar_id, "calendar_id")
        try:
            async with open_session() as session:
                listing = await CalendarReader(session).get_listing(
                    user_id, organization_id, calendar_id
                )
                (calendar,) = await _to_proto(session, user_id, organization_id, [listing])
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_calendar", exc) from exc
        return GetCalendarResponse(calendar=calendar)

    async def create_calendar(
        self,
        request: CreateCalendarRequest,
        ctx: RequestContext,
    ) -> CreateCalendarResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        admin_user_ids = [parse_uuid(value, "admin_user_ids") for value in request.admin_user_ids]
        admin_group_ids = [parse_uuid(value, "admin_group_ids") for value in request.admin_group_ids]
        try:
            async with open_session() as session:
                operations = CalendarOperations(session, self.search_indexer)
                calendar = await operations.create_calendar(
                    user_id=user_id,
                    organization_id=organization_id,
                    name=request.name,
                    color=request.color,
                    description=request.description if request.has_field("description") else "",
                    calendar_type=calendar_type_from_proto(request.calendar_type),
                    access_mode=(
                        access_mode_from_proto(request.access_mode)
                        if request.has_field("access_mode")
                        else None
                    ),
                    baseline_role=(
                        content_role_from_proto(request.baseline_role)
                        if request.has_field("baseline_role")
                        else None
                    ),
                    admin_user_ids=admin_user_ids,
                    admin_group_ids=admin_group_ids,
                )
                listing = await operations.get_listing(user_id, organization_id, calendar.id)
                (message,) = await _to_proto(session, user_id, organization_id, [listing])
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_calendar", exc) from exc
        return CreateCalendarResponse(calendar=message)

    async def update_calendar(
        self,
        request: UpdateCalendarRequest,
        ctx: RequestContext,
    ) -> UpdateCalendarResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        calendar_id = parse_uuid(request.calendar_id, "calendar_id")
        try:
            async with open_session() as session:
                operations = CalendarOperations(session, self.search_indexer)
                await operations.update_calendar(
                    user_id,
                    organization_id,
                    calendar_id,
                    name=request.name if request.has_field("name") else None,
                    description=request.description if request.has_field("description") else None,
                    color=request.color if request.has_field("color") else None,
                )
                listing = await operations.get_listing(user_id, organization_id, calendar_id)
                (message,) = await _to_proto(session, user_id, organization_id, [listing])
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_calendar", exc) from exc
        return UpdateCalendarResponse(calendar=message)

    async def delete_calendar(
        self,
        request: DeleteCalendarRequest,
        ctx: RequestContext,
    ) -> DeleteCalendarResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        calendar_id = parse_uuid(request.calendar_id, "calendar_id")
        try:
            if request.disposition == CalendarEventDisposition.MOVE:
                if not request.has_field("target_calendar_id"):
                    raise ValidationError(
                        "target_calendar_id", "Choose the calendar that receives the events."
                    )
                target = parse_uuid(request.target_calendar_id, "target_calendar_id")
            elif request.disposition == CalendarEventDisposition.DELETE:
                target = None
            else:
                raise ValidationError(
                    "disposition", "Choose whether the events move or are deleted."
                )
            async with open_session() as session:
                result = await CalendarOperations(session, self.search_indexer).delete_calendar(
                    user_id, organization_id, calendar_id, target_calendar_id=target
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_calendar", exc) from exc
        return DeleteCalendarResponse(
            events_moved=result.events_moved,
            events_deleted=result.events_deleted,
        )

    async def set_calendar_visibility(
        self,
        request: SetCalendarVisibilityRequest,
        ctx: RequestContext,
    ) -> SetCalendarVisibilityResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        calendar_id = parse_uuid(request.calendar_id, "calendar_id")
        try:
            async with open_session() as session:
                listing = await CalendarOperations(session, self.search_indexer).set_visibility(
                    user_id, organization_id, calendar_id, request.hidden
                )
                (message,) = await _to_proto(session, user_id, organization_id, [listing])
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("set_calendar_visibility", exc) from exc
        return SetCalendarVisibilityResponse(calendar=message)


async def _to_proto(
    session: AsyncSession,
    user_id,
    organization_id,
    listings: Sequence[CalendarListing],
) -> list[ProtoCalendar]:
    keys = [ResourceKey(ContentType.CALENDAR, listing.calendar.id) for listing in listings]
    decisions = await ResourceAccessResolver(session).resolve_page(
        actor_id=user_id,
        organization_id=organization_id,
        keys=keys,
    )
    owner_ids = {listing.calendar.owner_id for listing in listings}
    owners = {
        row.id: row.full_name or row.email
        for row in (
            await session.execute(
                select(User.id, User.full_name, User.email).where(User.id.in_(owner_ids))
            )
        ).all()
    }
    return [
        calendar_to_proto(listing, decisions[key].role, owners.get(listing.calendar.owner_id, ""))
        for listing, key in zip(listings, keys, strict=True)
    ]
