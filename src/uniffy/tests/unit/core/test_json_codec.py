from datetime import UTC, datetime

import pytest

from uniffy.core.json_codec import OPTION_INDENT_2, dumps_bytes, dumps_str, loads


def test_json_codec_roundtrip_supports_text_and_bytes() -> None:
    payload = {
        "message": "Zażółć gęślą jaźń",
        "created_at": datetime(2026, 8, 15, 12, 30, tzinfo=UTC),
    }

    encoded_bytes = dumps_bytes(payload)
    encoded_text = dumps_str(payload)

    assert encoded_bytes == encoded_text.encode()
    assert loads(encoded_bytes) == loads(encoded_text) == {
        "message": payload["message"],
        "created_at": "2026-08-15T12:30:00+00:00",
    }


def test_json_codec_supports_default_and_options() -> None:
    class Unserializable:
        def __str__(self) -> str:
            return "fallback"

    assert dumps_str({"value": Unserializable()}, default=str) == '{"value":"fallback"}'
    assert dumps_str({"value": 1}, option=OPTION_INDENT_2) == '{\n  "value": 1\n}'


def test_json_codec_rejects_non_string_keys() -> None:
    with pytest.raises(TypeError):
        dumps_bytes({1: "value"})
