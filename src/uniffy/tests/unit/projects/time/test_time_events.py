from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from uniffy.core.models.projects.timesheet import Timesheet, TimesheetStatus
from uniffy.domains.projects.time.events import notify_submitted

MODULE = "uniffy.domains.projects.time.events"
ORG, WORKER, MANAGER, LEAD = uuid4(), uuid4(), uuid4(), uuid4()


def _sheet(submitted_to=None) -> Timesheet:  # noqa: ANN001
    return Timesheet(
        organization_id=ORG,
        user_id=WORKER,
        period_start=date(2026, 10, 19),
        period_end=date(2026, 10, 25),
        status=TimesheetStatus.SUBMITTED,
        submitted_to_user_id=submitted_to,
    )


async def _recipients(sheet: Timesheet) -> list[list]:
    access = MagicMock()
    access.review_recipients = AsyncMock(return_value={MANAGER, LEAD})
    emit = AsyncMock()
    with (
        patch(f"{MODULE}.TimeAccess", return_value=access),
        patch(f"{MODULE}.emit_notification", new=emit),
        patch(f"{MODULE}.display_name", new=AsyncMock(return_value="Bob")),
    ):
        await notify_submitted(MagicMock(), sheet, WORKER)
    return [call.args[0].target_user_ids for call in emit.await_args_list]


async def test_a_sheet_sent_to_one_reviewer_notifies_only_them() -> None:
    assert await _recipients(_sheet(submitted_to=LEAD)) == [[LEAD]]


async def test_a_sheet_sent_to_nobody_in_particular_notifies_every_reviewer() -> None:
    assert await _recipients(_sheet()) == [sorted({MANAGER, LEAD})]
