import pytest

from uniffy.core.realtime.session import UNAVAILABLE_REASON, UPDATE_CONFLICT_REASON
from uniffy.core.realtime.wire import create_auth_denied_message
from uniffy.tests.realtime_wire_frames import (
    DENIALS,
    MALFORMED_CASES,
    SEQUENCE_FRAMES,
    UNENCODABLE_CASES,
    VALID_CASES,
    case_id,
    decode,
    encode,
    frame_bytes,
)

FRAMES = VALID_CASES + SEQUENCE_FRAMES


@pytest.mark.parametrize("case", FRAMES, ids=case_id)
def test_encoder_produces_corpus_bytes(case):
    assert encode(case) == frame_bytes(case)


@pytest.mark.parametrize("case", FRAMES, ids=case_id)
def test_decoder_recovers_corpus_fields(case):
    assert decode(case) == case["fields"]


@pytest.mark.parametrize("case", MALFORMED_CASES, ids=case_id)
def test_malformed_frame_is_rejected(case):
    with pytest.raises(ValueError):
        decode(case)


@pytest.mark.parametrize("case", UNENCODABLE_CASES, ids=case_id)
def test_out_of_contract_fields_cannot_be_encoded(case):
    with pytest.raises(ValueError):
        encode(case)


@pytest.mark.parametrize(
    ("name", "reason"),
    [("denial_unavailable", UNAVAILABLE_REASON), ("denial_update_conflict", UPDATE_CONFLICT_REASON)],
)
def test_server_denial_reasons_produce_the_corpus_bytes(name, reason):
    assert create_auth_denied_message(reason) == frame_bytes(DENIALS[name])
