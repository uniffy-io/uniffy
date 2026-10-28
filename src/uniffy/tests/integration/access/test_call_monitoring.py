import pytest

from uniffy.core.models.calls import CallEndReason
from uniffy.domains.calls.jobs.monitoring import _snapshot
from uniffy.domains.calls.metrics import LIVE_CALLS, LIVE_PARTICIPANTS, SNAPSHOT_TIME
from uniffy.domains.calls.operations import CallOperations
from uniffy.tests.integration.access.calls import _call
from uniffy.tests.integration.access.calls import livekit as livekit
from uniffy.tests.integration.access.calls import call_publication as call_publication

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_snapshot_tracks_committed_live_rows(session, access, livekit, call_publication):
    await _snapshot()
    before_calls = LIVE_CALLS._value.get()
    before_participants = LIVE_PARTICIPANTS._value.get()
    call = await _call(session, access)
    await _snapshot()
    assert LIVE_CALLS._value.get() == before_calls + 1
    assert LIVE_PARTICIPANTS._value.get() == before_participants + 1
    assert SNAPSHOT_TIME._value.get() > 0
    await CallOperations(session).end_call_internal(call, CallEndReason.HOST_ENDED)
    await _snapshot()
    assert LIVE_CALLS._value.get() == before_calls
    assert LIVE_PARTICIPANTS._value.get() == before_participants
