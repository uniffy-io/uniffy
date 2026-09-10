"""Calendar event mutation RPC handlers."""

import contextlib
from datetime import date as date_type
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.cal.v1.calendar_pb2 import (
    CreateEventRequest,
    CreateEventResponse,
    DeleteEventRequest,
    DeleteEventResponse,
    UpdateEventRequest,
    UpdateEventResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters.proto import timestamp_to_datetime
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType, RecurrencePattern
from uniffy.domains.scheduling.calendar import queries
from uniffy.domains.scheduling.calendar.converters import (
    attendee_role_from_proto,
    event_status_from_proto,
    event_to_proto,
    event_transparency_from_proto,
    event_visibility_from_proto,
    recurrence_config_from_proto,
    recurrence_edit_scope_from_proto,
    recurrence_from_proto,
)
from uniffy.domains.scheduling.calendar.events.operations import CalendarEventOperations
from uniffy.domains.scheduling.calendar.recurrence import OCCURRENCE_ID_SEPARATOR
from uniffy.domains.scheduling.calendar.rpc.support import (
    hydrate_event_tags,
    map_domain_error,
    parse_reminders,
    parse_tag_id_list,
    parse_uuid,
)
from uniffy.domains.scheduling.rooms.projection import get_event_room_info
from uniffy.infrastructure.database import open_session


class EventMutationHandlers:
    async def create_event(
        self,
        request: CreateEventRequest,
        ctx: RequestContext,
    ) -> CreateEventResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        category_id = None
        if request.HasField("category_id"):
            category_id = parse_uuid(request.category_id, "category_id")

        recurrence_config = None
        recurrence_pattern = RecurrencePattern.NONE
        if request.HasField("recurrence"):
            recurrence_config = recurrence_config_from_proto(request.recurrence)
            recurrence_pattern = recurrence_from_proto(request.recurrence.pattern)

        attendee_ids = None
        if request.attendee_ids:
            attendee_ids = [parse_uuid(value, "attendee_id") for value in request.attendee_ids]

        attendee_roles = None
        if request.attendees:
            attendee_roles = {}
            merged_ids = list(attendee_ids or [])
            for entry in request.attendees:
                entry_id = parse_uuid(entry.user_id, "attendee_id")
                attendee_roles[entry_id] = attendee_role_from_proto(entry.role)
                if entry_id not in merged_ids:
                    merged_ids.append(entry_id)
            attendee_ids = merged_ids

        linked_resources = None
        if request.linked_resource_urns:
            linked_resources = [
                {"id": urn, "type": "NOTE", "name": ""} for urn in request.linked_resource_urns
            ]

        room_id = None
        if request.HasField("room_id") and request.room_id:
            room_id = parse_uuid(request.room_id, "room_id")

        channel_id = None
        if request.HasField("channel_id") and request.channel_id:
            channel_id = parse_uuid(request.channel_id, "channel_id")

        tag_ids = parse_tag_id_list(request.tag_ids) if request.tag_ids else None

        try:
            async with open_session() as session:
                operations = CalendarEventOperations(session, self.search_indexer)

                calendar_id = None
                if request.calendar_id:
                    with contextlib.suppress(ValueError):
                        calendar_id = UUID(request.calendar_id)

                if not calendar_id:
                    default_calendar = await queries.ensure_default_calendar(
                        session, organization_id, user_id
                    )
                    calendar_id = default_calendar.id

                event = await operations.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    title=request.title,
                    start_time=timestamp_to_datetime(request.start_time),
                    end_time=timestamp_to_datetime(request.end_time),
                    calendar_id=calendar_id,
                    description=request.description if request.HasField("description") else "",
                    is_all_day=request.is_all_day,
                    timezone=request.timezone if request.HasField("timezone") else "UTC",
                    location=request.location if request.HasField("location") else "",
                    meeting_url=request.meeting_url if request.HasField("meeting_url") else None,
                    category_id=category_id,
                    attendee_ids=attendee_ids,
                    attendee_roles=attendee_roles,
                    recurrence_pattern=recurrence_pattern,
                    recurrence_config=recurrence_config,
                    is_focus_time=request.is_focus_time,
                    tag_ids=tag_ids,
                    linked_resources=linked_resources,
                    reminders=parse_reminders(
                        request.reminders, explicit_empty=request.no_reminders
                    ),
                    room_id=room_id,
                    channel_id=channel_id,
                    channel_auto_created=request.channel_auto_created,
                    status=event_status_from_proto(request.status),
                    visibility=event_visibility_from_proto(request.visibility),
                    transparency=event_transparency_from_proto(request.transparency),
                    is_out_of_office=request.is_out_of_office,
                )

                attendees = await queries.get_event_attendees(session, event.id)
                room_info = await get_event_room_info(session, event.id)
                tags_by_urn = await hydrate_event_tags(session, organization_id, [event.id])
                return CreateEventResponse(
                    event=event_to_proto(
                        event,
                        attendees,
                        tags=tags_by_urn.get(
                            build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                            [],
                        ),
                        user_role=await operations._resolve_role(user_id, organization_id, event),
                        **room_info,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_event", exc) from exc

    async def update_event(
        self,
        request: UpdateEventRequest,
        ctx: RequestContext,
    ) -> UpdateEventResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        try:
            event_id = UUID(request.event_id.split(OCCURRENCE_ID_SEPARATOR)[0])
        except ValueError as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid event_id: {exc}") from exc

        kwargs: dict = {}
        optional_fields = (
            "title",
            "description",
            "is_all_day",
            "timezone",
            "location",
            "meeting_url",
            "is_focus_time",
            "room_id",
            "channel_id",
            "channel_auto_created",
            "is_out_of_office",
        )
        for field in optional_fields:
            if request.HasField(field):
                kwargs[field] = getattr(request, field)
        for field in ("start_time", "end_time"):
            if request.HasField(field):
                kwargs[field] = timestamp_to_datetime(getattr(request, field))
        if request.HasField("calendar_id"):
            kwargs["calendar_id"] = parse_uuid(request.calendar_id, "calendar_id")
        if request.HasField("category_id"):
            kwargs["category_id"] = (
                parse_uuid(request.category_id, "category_id") if request.category_id else None
            )
        if request.HasField("recurrence"):
            kwargs["recurrence_config"] = recurrence_config_from_proto(request.recurrence)
        if request.HasField("tag_ids"):
            kwargs["tag_ids"] = parse_tag_id_list(request.tag_ids.ids)
        if request.linked_resource_urns:
            kwargs["linked_resources"] = [
                {"id": urn, "type": "NOTE", "name": ""} for urn in request.linked_resource_urns
            ]
        if request.attendee_ids:
            kwargs["attendee_ids"] = [
                parse_uuid(value, "attendee_id") for value in request.attendee_ids
            ]
        reminders = parse_reminders(request.reminders, explicit_empty=request.clear_reminders)
        if reminders is not None:
            kwargs["reminders"] = reminders
        if request.HasField("recurrence_edit_scope"):
            kwargs["recurrence_edit_scope"] = recurrence_edit_scope_from_proto(
                request.recurrence_edit_scope
            )
        if request.HasField("occurrence_date"):
            try:
                kwargs["occurrence_date"] = date_type.fromisoformat(request.occurrence_date)
            except ValueError as exc:
                raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid occurrence_date: {exc}") from exc
        if request.HasField("status"):
            kwargs["status"] = event_status_from_proto(request.status)
        if request.HasField("visibility"):
            kwargs["visibility"] = event_visibility_from_proto(request.visibility)
        if request.HasField("transparency"):
            kwargs["transparency"] = event_transparency_from_proto(request.transparency)

        try:
            async with open_session() as session:
                operations = CalendarEventOperations(session, self.search_indexer)
                event = await operations.update(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    **kwargs,
                    call_lifecycle=self.call_lifecycle,
                )
                attendees = await queries.get_event_attendees(session, event.id)
                room_info = await get_event_room_info(session, event.id)
                tags_by_urn = await hydrate_event_tags(session, organization_id, [event.id])
                return UpdateEventResponse(
                    event=event_to_proto(
                        event,
                        attendees,
                        tags=tags_by_urn.get(
                            build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                            [],
                        ),
                        user_role=await operations._resolve_role(user_id, organization_id, event),
                        **room_info,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_event", exc) from exc

    async def delete_event(
        self,
        request: DeleteEventRequest,
        ctx: RequestContext,
    ) -> DeleteEventResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        event_id = parse_uuid(request.event_id.split(OCCURRENCE_ID_SEPARATOR)[0], "event_id")

        edit_scope = None
        occurrence_date = None
        if request.HasField("recurrence_edit_scope"):
            edit_scope = recurrence_edit_scope_from_proto(request.recurrence_edit_scope)
        if request.HasField("occurrence_date"):
            try:
                occurrence_date = date_type.fromisoformat(request.occurrence_date)
            except ValueError as exc:
                raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid occurrence_date: {exc}") from exc

        try:
            async with open_session() as session:
                await CalendarEventOperations(session, self.search_indexer).delete(
                    user_id=user_id,
                    organization_id=organization_id,
                    event_id=event_id,
                    permanent=request.permanent,
                    recurrence_edit_scope=edit_scope,
                    occurrence_date=occurrence_date,
                )
                message = "Event permanently deleted" if request.permanent else "Event deleted"
                return DeleteEventResponse(success=True, message=message)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_event", exc) from exc
