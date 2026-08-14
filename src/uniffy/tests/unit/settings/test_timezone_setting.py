"""The timezone appearance key: defaults, validation, proto round trip."""

import pytest
from uniffy_proto.settings.v1.settings_pb2 import AppearanceSettings

from uniffy.core.errors import ValidationError
from uniffy.domains.settings.converters import (
    appearance_dict_to_proto,
    appearance_from_proto,
)
from uniffy.domains.settings.defaults import get_effective_appearance
from uniffy.domains.settings.operations import _validate_appearance


def test_default_is_automatic() -> None:
    effective = get_effective_appearance(None)
    assert effective["timezone"] is None


def test_override_merges_into_effective() -> None:
    effective = get_effective_appearance({"timezone": "Europe/Sofia"})
    assert effective["timezone"] == "Europe/Sofia"


def test_validate_accepts_iana_zone() -> None:
    _validate_appearance({"timezone": "Pacific/Auckland"})


def test_validate_accepts_absent_and_empty() -> None:
    _validate_appearance(None)
    _validate_appearance({})
    _validate_appearance({"timezone": ""})
    _validate_appearance({"timezone": None})


def test_validate_rejects_unknown_zone() -> None:
    with pytest.raises(ValidationError):
        _validate_appearance({"timezone": "Not/AZone"})


def test_week_start_defaults_to_monday() -> None:
    effective = get_effective_appearance(None)
    assert effective["week_start"] == "monday"


def test_validate_accepts_week_start_values() -> None:
    for value in ("monday", "saturday", "sunday"):
        _validate_appearance({"week_start": value})


def test_validate_rejects_unknown_week_start() -> None:
    with pytest.raises(ValidationError):
        _validate_appearance({"week_start": "friday"})


def test_week_start_proto_round_trip() -> None:
    proto = appearance_dict_to_proto({"week_start": "sunday"})
    assert proto.week_start == "sunday"
    assert appearance_from_proto(proto)["week_start"] == "sunday"


def test_proto_round_trip() -> None:
    proto = appearance_dict_to_proto({"timezone": "Asia/Kolkata"})
    assert proto.timezone == "Asia/Kolkata"
    assert appearance_from_proto(proto)["timezone"] == "Asia/Kolkata"


def test_empty_string_clears_to_automatic() -> None:
    proto = AppearanceSettings()
    proto.timezone = ""
    result = appearance_from_proto(proto)
    assert result is not None
    assert result["timezone"] is None
