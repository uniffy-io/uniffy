"""Free/busy and meeting suggestions refuse a lost membership with the typed reason."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.cal.v1.calendar_pb import GetFreeBusyRequest, SuggestMeetingTimesRequest

from uniffy.core.types import generate_id
from uniffy.domains.scheduling.calendar.rpc.scheduling import SchedulingHandlers
from uniffy.transport.rpc import MEMBERSHIP_REQUIRED_REASON, error_info_detail, with_domain_details

_MODULE = "uniffy.domains.scheduling.calendar.rpc.scheduling"
_REASON = error_info_detail(MEMBERSHIP_REQUIRED_REASON)


@asynccontextmanager
async def _rpc() -> AsyncIterator[AsyncMock]:
    @asynccontextmanager
    async def open_session() -> AsyncIterator[MagicMock]:
        yield MagicMock()

    busy = AsyncMock(return_value={})
    with (
        patch(f"{_MODULE}.current_user_id", MagicMock(return_value=generate_id())),
        patch(f"{_MODULE}.resolve_organization_id", MagicMock(return_value=generate_id())),
        patch(f"{_MODULE}.open_session", open_session),
        patch(f"{_MODULE}.get_active_membership", AsyncMock(return_value=None)),
        patch(f"{_MODULE}.get_busy_intervals", busy),
    ):
        yield busy


@pytest.mark.parametrize(
    ("method", "request_message"),
    [
        ("get_free_busy", GetFreeBusyRequest(user_ids=[str(generate_id())])),
        (
            "suggest_meeting_times",
            SuggestMeetingTimesRequest(required_user_ids=[str(generate_id())], duration_minutes=30),
        ),
    ],
)
async def test_a_lost_membership_answers_with_the_typed_reason(
    method: str, request_message: object
) -> None:
    async with _rpc() as busy:
        with pytest.raises(ConnectError) as refused:
            await getattr(SchedulingHandlers(), method)(request_message, MagicMock())

    details = with_domain_details(refused.value).details
    assert refused.value.code is Code.PERMISSION_DENIED
    assert [(d.type_name, d.message_bytes) for d in details] == [
        (_REASON.type_name, _REASON.message_bytes)
    ]
    busy.assert_not_awaited()
