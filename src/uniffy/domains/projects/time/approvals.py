"""Timesheet and period RPC handlers mixed into the projects service."""

from __future__ import annotations

from uuid import UUID

from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.projects.v1.time_pb import (
    ApproveTimesheetRequest,
    ApproveTimesheetResponse,
    ClosePeriodRequest,
    ClosePeriodResponse,
    GetTimesheetRequest,
    GetTimesheetResponse,
    GrantGraceRequest,
    GrantGraceResponse,
    ListPeriodsRequest,
    ListPeriodsResponse,
    ListReviewTimesheetsRequest,
    ListReviewTimesheetsResponse,
    RecallTimesheetRequest,
    RecallTimesheetResponse,
    RejectTimesheetRequest,
    RejectTimesheetResponse,
    ReopenPeriodRequest,
    ReopenPeriodResponse,
    SubmitTimesheetRequest,
    SubmitTimesheetResponse,
)

from uniffy.core.auth.principal import current_user_id
from uniffy.domains.projects.rpc import map_domain_error, parse_date, parse_uuid
from uniffy.domains.projects.time.closures import PeriodOperations
from uniffy.domains.projects.time.converters import (
    period_to_proto,
    review_row_to_proto,
    timesheet_status_from_proto,
    timesheet_to_proto,
)
from uniffy.domains.projects.time.review import TimesheetReview
from uniffy.domains.projects.time.submission import submit_timesheet
from uniffy.domains.projects.time.timesheets import TimesheetOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="projects.time.approvals")


def _optional_user(
    request: GetTimesheetRequest | SubmitTimesheetRequest | RecallTimesheetRequest,
) -> UUID | None:
    if request.has_field("user_id") and request.user_id:
        return parse_uuid(request.user_id, "user_id")
    return None


class TimesheetHandlers:
    async def get_timesheet(
        self, request: GetTimesheetRequest, ctx: RequestContext
    ) -> GetTimesheetResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        day = parse_date(request.period_start, "period_start")
        subject_id = _optional_user(request) or user_id
        try:
            async with open_session() as session:
                view = await TimesheetOperations(session).get(
                    user_id, organization_id, subject_id, day
                )
                return GetTimesheetResponse(timesheet=timesheet_to_proto(view))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_timesheet", exc) from exc

    async def submit_timesheet(
        self, request: SubmitTimesheetRequest, ctx: RequestContext
    ) -> SubmitTimesheetResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        day = parse_date(request.period_start, "period_start")
        try:
            async with open_session() as session:
                view = await submit_timesheet(
                    session,
                    user_id,
                    organization_id,
                    _optional_user(request),
                    day,
                    comment=request.comment,
                )
                return SubmitTimesheetResponse(timesheet=timesheet_to_proto(view))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("submit_timesheet", exc) from exc

    async def recall_timesheet(
        self, request: RecallTimesheetRequest, ctx: RequestContext
    ) -> RecallTimesheetResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        day = parse_date(request.period_start, "period_start")
        try:
            async with open_session() as session:
                view = await TimesheetOperations(session).recall(
                    user_id, organization_id, _optional_user(request), day
                )
                return RecallTimesheetResponse(timesheet=timesheet_to_proto(view))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("recall_timesheet", exc) from exc

    async def list_review_timesheets(
        self, request: ListReviewTimesheetsRequest, ctx: RequestContext
    ) -> ListReviewTimesheetsResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        day = parse_date(request.period_start, "period_start")
        team_id = (
            parse_uuid(request.team_id, "team_id")
            if request.has_field("team_id") and request.team_id
            else None
        )
        try:
            status = (
                timesheet_status_from_proto(request.status) if request.has_field("status") else None
            )
            async with open_session() as session:
                page = await TimesheetReview(session).list_for_reviewer(
                    user_id,
                    organization_id,
                    day,
                    status=status,
                    page_size=request.page_size,
                    page_token=request.page_token,
                    query=request.query,
                    team_id=team_id,
                )
                return ListReviewTimesheetsResponse(
                    rows=[review_row_to_proto(row) for row in page.rows],
                    next_page_token=page.next_page_token,
                    period=period_to_proto(page.period),
                    viewer_is_timekeeping_admin=page.viewer_is_timekeeping_admin,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_review_timesheets", exc) from exc

    async def approve_timesheet(
        self, request: ApproveTimesheetRequest, ctx: RequestContext
    ) -> ApproveTimesheetResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        timesheet_id = parse_uuid(request.timesheet_id, "timesheet_id")
        try:
            async with open_session() as session:
                view = await TimesheetOperations(session).approve(
                    user_id, organization_id, timesheet_id, comment=request.comment
                )
                return ApproveTimesheetResponse(timesheet=timesheet_to_proto(view))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("approve_timesheet", exc) from exc

    async def reject_timesheet(
        self, request: RejectTimesheetRequest, ctx: RequestContext
    ) -> RejectTimesheetResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        timesheet_id = parse_uuid(request.timesheet_id, "timesheet_id")
        try:
            async with open_session() as session:
                view = await TimesheetOperations(session).reject(
                    user_id, organization_id, timesheet_id, comment=request.comment
                )
                return RejectTimesheetResponse(timesheet=timesheet_to_proto(view))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("reject_timesheet", exc) from exc

    async def grant_grace(
        self, request: GrantGraceRequest, ctx: RequestContext
    ) -> GrantGraceResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        subject_id = parse_uuid(request.user_id, "user_id")
        day = parse_date(request.period_start, "period_start")
        try:
            async with open_session() as session:
                view = await TimesheetOperations(session).grant_grace(
                    user_id, organization_id, subject_id, day, hours=request.hours
                )
                return GrantGraceResponse(timesheet=timesheet_to_proto(view))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("grant_grace", exc) from exc

    async def close_period(
        self, request: ClosePeriodRequest, ctx: RequestContext
    ) -> ClosePeriodResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        day = parse_date(request.period_start, "period_start")
        try:
            async with open_session() as session:
                view = await PeriodOperations(session).close(user_id, organization_id, day)
                return ClosePeriodResponse(period=period_to_proto(view))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("close_period", exc) from exc

    async def reopen_period(
        self, request: ReopenPeriodRequest, ctx: RequestContext
    ) -> ReopenPeriodResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        day = parse_date(request.period_start, "period_start")
        try:
            async with open_session() as session:
                view = await PeriodOperations(session).reopen(user_id, organization_id, day)
                return ReopenPeriodResponse(period=period_to_proto(view))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("reopen_period", exc) from exc

    async def list_periods(
        self, request: ListPeriodsRequest, ctx: RequestContext
    ) -> ListPeriodsResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        from_date = parse_date(request.from_date, "from_date")
        to_date = parse_date(request.to_date, "to_date")
        try:
            async with open_session() as session:
                views = await PeriodOperations(session).list(
                    user_id, organization_id, from_date=from_date, to_date=to_date
                )
                return ListPeriodsResponse(periods=[period_to_proto(view) for view in views])
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_periods", exc) from exc
