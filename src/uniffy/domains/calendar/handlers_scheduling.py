"""Free/busy and meeting-suggestion RPC handlers."""

from datetime import timedelta
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.cal.v1.calendar_pb2 import (
    BusyInterval as ProtoBusyInterval,
)
from uniffy_proto.cal.v1.calendar_pb2 import (
    GetFreeBusyRequest,
    GetFreeBusyResponse,
    MeetingTimeSuggestion,
    SuggestMeetingTimesRequest,
    SuggestMeetingTimesResponse,
    UserFreeBusy,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.converters.proto import timestamp_to_datetime
from uniffy.core.errors import ValidationError
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context, resolve_organization_id
from uniffy.domains.calendar.availability import BusyInterval, get_busy_intervals
from uniffy.domains.calendar.handlers import _map_domain_error
from uniffy.domains.calendar.scheduling import suggest_meeting_times
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.rooms.operations import RoomOperations
from uniffy.domains.rooms.queries import get_room_busy_intervals
from uniffy.domains.settings.operations import get_users_scheduling_context

logger = logger.bind(component="calendar.handlers_scheduling")

MIN_DURATION_MINUTES = 5
MAX_DURATION_MINUTES = 480


def _parse_user_ids(raw: list[str], field: str) -> list[UUID]:
    try:
        return list(dict.fromkeys(UUID(value) for value in raw))
    except ValueError:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid user ID in {field}")


def _busy_to_proto(interval: BusyInterval) -> ProtoBusyInterval:
    return ProtoBusyInterval(
        start_time=datetime_to_timestamp(interval.start),
        end_time=datetime_to_timestamp(interval.end),
        is_out_of_office=interval.out_of_office,
    )


async def _room_busy_for(session, user_id, organization_id, room_id_raw, window):
    """Booked spans for a room the caller can view; gates via the content path."""
    try:
        room_id = UUID(room_id_raw)
    except ValueError:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid room ID")
    await RoomOperations(session).get_by_id(user_id, organization_id, room_id)
    return await get_room_busy_intervals(session, organization_id, room_id, window[0], window[1])


class SchedulingHandlers:
    async def get_free_busy(
        self,
        request: GetFreeBusyRequest,
        ctx: RequestContext,
    ) -> GetFreeBusyResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = resolve_organization_id(ctx, request.organization_id)
        user_ids = _parse_user_ids(list(request.user_ids), "user_ids")
        window_start = timestamp_to_datetime(request.window_start)
        window_end = timestamp_to_datetime(request.window_end)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(user_id, organization_id)
                busy_by_user = await get_busy_intervals(
                    session, organization_id, user_ids, window_start, window_end
                )
                schedule_by_user = await get_users_scheduling_context(session, user_ids)
                room_busy = []
                if request.HasField("room_id"):
                    room_busy = await _room_busy_for(
                        session,
                        user_id,
                        organization_id,
                        request.room_id,
                        (window_start, window_end),
                    )
                return GetFreeBusyResponse(
                    users=[
                        UserFreeBusy(
                            user_id=str(uid),
                            intervals=[_busy_to_proto(i) for i in busy_by_user.get(uid, [])],
                            timezone=schedule_by_user[uid].timezone,
                            workday_start=schedule_by_user[uid].workday_start,
                            workday_end=schedule_by_user[uid].workday_end,
                            workdays=list(schedule_by_user[uid].workdays),
                        )
                        for uid in user_ids
                    ],
                    room_busy=[_busy_to_proto(BusyInterval(start, end)) for start, end in room_busy],
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("get_free_busy", exc) from exc

    async def suggest_meeting_times(
        self,
        request: SuggestMeetingTimesRequest,
        ctx: RequestContext,
    ) -> SuggestMeetingTimesResponse:
        user_id = get_user_id_from_context(ctx)
        organization_id = resolve_organization_id(ctx, request.organization_id)
        required_ids = _parse_user_ids(list(request.required_user_ids), "required_user_ids")
        optional_ids = [
            uid
            for uid in _parse_user_ids(list(request.optional_user_ids), "optional_user_ids")
            if uid not in set(required_ids)
        ]
        if not required_ids:
            raise ConnectError(Code.INVALID_ARGUMENT, "required_user_ids must not be empty")
        window_start = timestamp_to_datetime(request.window_start)
        window_end = timestamp_to_datetime(request.window_end)

        try:
            if not MIN_DURATION_MINUTES <= request.duration_minutes <= MAX_DURATION_MINUTES:
                raise ValidationError(
                    "duration_minutes",
                    f"Must be between {MIN_DURATION_MINUTES} and {MAX_DURATION_MINUTES} minutes",
                )
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(user_id, organization_id)
                all_ids = [*required_ids, *optional_ids]
                busy_by_user = await get_busy_intervals(
                    session, organization_id, all_ids, window_start, window_end
                )
                schedule_by_user = await get_users_scheduling_context(session, all_ids)
                room_busy = []
                if request.HasField("room_id"):
                    room_busy = await _room_busy_for(
                        session,
                        user_id,
                        organization_id,
                        request.room_id,
                        (window_start, window_end),
                    )
                suggestions = suggest_meeting_times(
                    busy_by_user,
                    schedule_by_user,
                    required_ids=required_ids,
                    optional_ids=optional_ids,
                    room_busy=room_busy,
                    window_start=window_start,
                    window_end=window_end,
                    duration=timedelta(minutes=request.duration_minutes),
                    max_results=request.max_results or 5,
                )
                return SuggestMeetingTimesResponse(
                    suggestions=[
                        MeetingTimeSuggestion(
                            start_time=datetime_to_timestamp(s.start),
                            end_time=datetime_to_timestamp(s.end),
                            unavailable_optional_user_ids=[
                                str(uid) for uid in s.unavailable_optional_ids
                            ],
                        )
                        for s in suggestions
                    ]
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("suggest_meeting_times", exc) from exc
