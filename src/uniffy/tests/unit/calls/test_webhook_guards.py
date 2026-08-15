"""Stale-session detection for at-least-once, out-of-order LiveKit webhooks."""

from uniffy.core.json_codec import dumps_str
from uniffy.domains.calls.webhook import _is_stale_session_event, _participant_jti


def _participant(jti: str | None) -> dict:
    metadata = dumps_str({"jti": jti}) if jti is not None else ""
    return {"identity": "u1:d1", "metadata": metadata}


def test_participant_jti_extracts_from_metadata():
    assert _participant_jti(_participant("abc")) == "abc"


def test_participant_jti_tolerates_missing_or_bad_metadata():
    assert _participant_jti({}) == ""
    assert _participant_jti({"metadata": "not json"}) == ""


def test_event_from_replaced_session_is_stale():
    assert _is_stale_session_event(_participant("old-jti"), "new-jti") is True


def test_event_from_current_session_is_not_stale():
    assert _is_stale_session_event(_participant("same-jti"), "same-jti") is False


def test_missing_jti_on_either_side_is_not_stale():
    # Fail open: without both jtis there is nothing to compare, and dropping
    # real leave events is worse than processing a rare duplicate.
    assert _is_stale_session_event(_participant(None), "row-jti") is False
    assert _is_stale_session_event(_participant("event-jti"), None) is False
