import pytest

from uniffy.tests.realtime_wire_frames import (
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
