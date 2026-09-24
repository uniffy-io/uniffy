"""Stale-session detection for at-least-once, out-of-order LiveKit webhooks."""

import pytest

from uniffy.core.json_codec import dumps_str
from uniffy.domains.calls.admission import (
    is_stale_session_event,
    matches_media_session,
    participant_jti,
)


def _participant(jti: str | None) -> dict:
    metadata = dumps_str({"jti": jti}) if jti is not None else ""
    return {"identity": "u1:d1", "metadata": metadata}


def test_participant_jti_extracts_from_metadata():
    assert participant_jti(_participant("abc")) == "abc"


def test_participant_jti_tolerates_missing_or_bad_metadata():
    assert participant_jti({}) == ""
    assert participant_jti({"metadata": "not json"}) == ""


@pytest.mark.parametrize("metadata", ["", "not json", "null", "[]", "1", '{"jti": 123}'])
def test_media_admission_rejects_missing_or_invalid_generation(metadata):
    assert matches_media_session({"metadata": metadata}, "issued", "connected") is False


def test_media_admission_preserves_connected_session_after_token_refresh():
    assert matches_media_session(_participant("connected"), "refreshed", "connected") is True
    assert matches_media_session(_participant("refreshed"), "refreshed", "connected") is True
    assert matches_media_session(_participant("revoked"), "refreshed", "connected") is False
    assert matches_media_session(_participant("connected"), None, None) is False


def test_event_from_replaced_session_is_stale():
    assert is_stale_session_event(_participant("old-jti"), "new-jti") is True


def test_event_from_current_session_is_not_stale():
    assert is_stale_session_event(_participant("same-jti"), "same-jti") is False


def test_missing_jti_on_either_side_is_not_stale():
    # Fail open: without both jtis there is nothing to compare, and dropping
    # real leave events is worse than processing a rare duplicate.
    assert is_stale_session_event(_participant(None), "row-jti") is False
    assert is_stale_session_event(_participant("event-jti"), None) is False
