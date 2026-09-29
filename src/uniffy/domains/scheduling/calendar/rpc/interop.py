"""Calendar interop RPC handlers."""

import re

from connectrpc.request import RequestContext
from sqlalchemy import select
from uniffy_proto.cal.v1.calendar_pb import (
    ApplyCalendarImportRequest,
    ApplyCalendarImportResponse,
    ExportCalendarRequest,
    ExportCalendarResponse,
    ExportEventRequest,
    ExportEventResponse,
    GetCalendarFeedUrlRequest,
    GetCalendarFeedUrlResponse,
    ImportedEventPreview,
    PreviewCalendarImportRequest,
    PreviewCalendarImportResponse,
    RegenerateCalendarFeedRequest,
    RegenerateCalendarFeedResponse,
    RevokeCalendarFeedRequest,
    RevokeCalendarFeedResponse,
    SkippedImportEntry,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters.proto import datetime_to_timestamp, timestamp_to_datetime
from uniffy.core.errors import ValidationError
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.types import RecurrencePattern
from uniffy.domains.scheduling.calendar import queries
from uniffy.domains.scheduling.calendar.calendars.access import require_calendar_view
from uniffy.domains.scheduling.calendar.events.reader import CalendarEventReader
from uniffy.domains.scheduling.calendar.ical.assemble import build_exports
from uniffy.domains.scheduling.calendar.ical.emit import serialize_events
from uniffy.domains.scheduling.calendar.ical.feed import (
    feed_url,
    issue_feed,
    read_feed,
    revoke_feed,
)
from uniffy.domains.scheduling.calendar.ical.ingest import apply_import, preview_import
from uniffy.domains.scheduling.calendar.ical.parse import SkippedEntry
from uniffy.domains.scheduling.calendar.rpc.support import (
    map_domain_error,
    parse_event_id,
    parse_uuid,
)
from uniffy.domains.scheduling.calendar.search import CalendarEventProjection
from uniffy.infrastructure.database import open_session

# A whole-calendar export is a single response body, so it is bounded rather
# than paged; past this the caller narrows the window instead.
MAX_EXPORT_EVENTS = 1000

_UNSAFE_FILENAME = re.compile(r"[^A-Za-z0-9._-]+")
_FILENAME_LIMIT = 60
_FALLBACK_FILENAME = "calendar"
ICS_SUFFIX = ".ics"


class InteropHandlers:
    async def export_event(
        self,
        request: ExportEventRequest,
        ctx: RequestContext,
    ) -> ExportEventResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        event_id = parse_event_id(request.event_id)

        try:
            async with open_session() as session:
                reader = CalendarEventReader(session)
                event = await reader.get_by_id(user_id, organization_id, event_id)
                # A moved occurrence is meaningless without the series it
                # belongs to, so an override id exports its master instead.
                if event.recurrence_id is not None:
                    event = await reader.get_by_id(user_id, organization_id, event.recurrence_id)

                exports = await build_exports(
                    session,
                    [event],
                    viewer_id=user_id,
                    organization_id=organization_id,
                )
                content = serialize_events(exports)
                # A busy block names nothing, and neither may the file it
                # arrives in.
                hidden = any(export.details_hidden for export in exports)
        except Exception as exc:
            raise map_domain_error("export_event", exc) from exc

        return ExportEventResponse(
            content=content,
            filename=_filename(_FALLBACK_FILENAME if hidden else event.title),
        )

    async def export_calendar(
        self,
        request: ExportCalendarRequest,
        ctx: RequestContext,
    ) -> ExportCalendarResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        start_time = (
            timestamp_to_datetime(request.start_time) if request.has_field("start_time") else None
        )
        end_time = timestamp_to_datetime(request.end_time) if request.has_field("end_time") else None
        try:
            if start_time and end_time and end_time < start_time:
                raise ValidationError("range", "Range end precedes its start")

            async with open_session() as session:
                calendar_id = await _resolve_calendar_id(
                    session, request.calendar_id, user_id, organization_id
                )
                # The file carries the calendar's name, so the calendar itself is gated.
                await require_calendar_view(session, user_id, organization_id, calendar_id)
                reader = CalendarEventReader(session)
                events, total = await reader.list_events_in_window(
                    user_id,
                    organization_id,
                    calendar_id=calendar_id,
                    start_date=start_time,
                    end_date=end_time,
                    limit=MAX_EXPORT_EVENTS,
                )
                if total > MAX_EXPORT_EVENTS:
                    raise ValidationError(
                        "calendar_id",
                        "This window exceeds the export limit of "
                        f"{MAX_EXPORT_EVENTS}. Narrow the window and export again.",
                    )

                name = await session.scalar(
                    select(Calendar.name).where(
                        Calendar.id == calendar_id,
                        Calendar.organization_id == organization_id,
                    )
                )
                exports = await build_exports(
                    session,
                    events,
                    viewer_id=user_id,
                    organization_id=organization_id,
                )
                content = serialize_events(exports)
        except Exception as exc:
            raise map_domain_error("export_calendar", exc) from exc

        return ExportCalendarResponse(
            content=content,
            filename=_filename(name or _FALLBACK_FILENAME),
            event_count=len(exports),
        )

    async def preview_calendar_import(
        self,
        request: PreviewCalendarImportRequest,
        ctx: RequestContext,
    ) -> PreviewCalendarImportResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                calendar_id = await _resolve_calendar_id(
                    session, request.calendar_id, user_id, organization_id
                )
                preview = await preview_import(
                    session,
                    user_id=user_id,
                    organization_id=organization_id,
                    calendar_id=calendar_id,
                    payload=request.content,
                )
        except Exception as exc:
            raise map_domain_error("preview_calendar_import", exc) from exc

        return PreviewCalendarImportResponse(
            creatable=[_preview_entry(parsed) for parsed in preview.creatable],
            duplicate_count=len(preview.duplicates),
            skipped=[_skipped_entry(entry) for entry in preview.skipped],
        )

    async def apply_calendar_import(
        self,
        request: ApplyCalendarImportRequest,
        ctx: RequestContext,
    ) -> ApplyCalendarImportResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                calendar_id = await _resolve_calendar_id(
                    session, request.calendar_id, user_id, organization_id
                )
                outcome = await apply_import(
                    session,
                    user_id=user_id,
                    organization_id=organization_id,
                    calendar_id=calendar_id,
                    payload=request.content,
                    projection=CalendarEventProjection(session, self.search_indexer),
                )
        except Exception as exc:
            raise map_domain_error("apply_calendar_import", exc) from exc

        return ApplyCalendarImportResponse(
            created_count=len(outcome.created_ids),
            duplicate_count=outcome.duplicate_count,
            skipped=[_skipped_entry(entry) for entry in outcome.skipped],
        )

    async def get_calendar_feed_url(
        self,
        request: GetCalendarFeedUrlRequest,
        ctx: RequestContext,
    ) -> GetCalendarFeedUrlResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                calendar_id = await _resolve_calendar_id(
                    session, request.calendar_id, user_id, organization_id
                )
                existing = await read_feed(
                    session,
                    user_id=user_id,
                    organization_id=organization_id,
                    calendar_id=calendar_id,
                )
        except Exception as exc:
            raise map_domain_error("get_calendar_feed_url", exc) from exc

        if existing is None:
            return GetCalendarFeedUrlResponse()

        raw_token, row = existing
        response = GetCalendarFeedUrlResponse(url=feed_url(raw_token))
        response.created_at = datetime_to_timestamp(row.created_at)
        if row.last_used_at is not None:
            response.last_used_at = datetime_to_timestamp(row.last_used_at)
        return response

    async def regenerate_calendar_feed(
        self,
        request: RegenerateCalendarFeedRequest,
        ctx: RequestContext,
    ) -> RegenerateCalendarFeedResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                calendar_id = await _resolve_calendar_id(
                    session, request.calendar_id, user_id, organization_id
                )
                raw_token, row = await issue_feed(
                    session,
                    user_id=user_id,
                    organization_id=organization_id,
                    calendar_id=calendar_id,
                )
                created_at = row.created_at
        except Exception as exc:
            raise map_domain_error("regenerate_calendar_feed", exc) from exc

        response = RegenerateCalendarFeedResponse(url=feed_url(raw_token))
        response.created_at = datetime_to_timestamp(created_at)
        return response

    async def revoke_calendar_feed(
        self,
        request: RevokeCalendarFeedRequest,
        ctx: RequestContext,
    ) -> RevokeCalendarFeedResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                calendar_id = await _resolve_calendar_id(
                    session, request.calendar_id, user_id, organization_id
                )
                revoked = await revoke_feed(
                    session,
                    user_id=user_id,
                    organization_id=organization_id,
                    calendar_id=calendar_id,
                )
        except Exception as exc:
            raise map_domain_error("revoke_calendar_feed", exc) from exc

        return RevokeCalendarFeedResponse(revoked=revoked)


async def _resolve_calendar_id(
    session,
    requested: str,
    user_id,
    organization_id,
):
    """The calendar a request names, or the caller's default when it names none."""
    if requested:
        return parse_uuid(requested, "calendar_id")
    default_calendar = await queries.ensure_default_calendar(session, organization_id, user_id)
    return default_calendar.id


def _preview_entry(parsed) -> ImportedEventPreview:
    return ImportedEventPreview(
        title=parsed.title,
        start_time=datetime_to_timestamp(parsed.start_time),
        end_time=datetime_to_timestamp(parsed.end_time),
        is_all_day=parsed.is_all_day,
        repeats=parsed.recurrence_pattern != RecurrencePattern.NONE,
    )


def _skipped_entry(entry: SkippedEntry) -> SkippedImportEntry:
    return SkippedImportEntry(label=entry.label, reason=entry.message)


def _filename(label: str) -> str:
    """A downloadable name derived from the title, safe on every filesystem."""
    cleaned = _UNSAFE_FILENAME.sub("-", label).strip("-.")[:_FILENAME_LIMIT]
    return f"{cleaned or _FALLBACK_FILENAME}{ICS_SUFFIX}"
