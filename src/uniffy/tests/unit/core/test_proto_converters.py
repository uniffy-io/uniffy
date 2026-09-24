from datetime import UTC, datetime, timedelta, timezone

import pytest
from protobuf import Oneof
from protobuf.wkt import Timestamp
from uniffy_proto.auth.v1.auth_pb import AuthResult, LoginResponse, MfaChallenge
from uniffy_proto.files.v1.files_pb import FilterCriteria
from uniffy_proto.notes.v1.notes_pb import UpdateNoteRequest
from uniffy_proto.projects.v1.projects_pb import TaskFieldRef, TaskPseudoField
from uniffy_proto.settings.v1.settings_pb import NotificationsSettings

from uniffy.core.converters.proto import datetime_to_timestamp, timestamp_to_datetime


@pytest.mark.parametrize(
    "value",
    [
        datetime(1969, 12, 31, 23, 59, 59, 999999, tzinfo=UTC),
        datetime(1970, 1, 1, tzinfo=UTC),
        datetime(2026, 9, 24, 18, 5, 22, 123456),
        datetime(2026, 9, 24, 18, 5, 22, 123456, tzinfo=timezone(timedelta(hours=5, minutes=30))),
        datetime(9999, 12, 31, 23, 59, 59, 999999, tzinfo=UTC),
    ],
)
def test_timestamp_round_trip_preserves_utc_microseconds(value: datetime) -> None:
    expected = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    assert timestamp_to_datetime(datetime_to_timestamp(value)) == expected


@pytest.mark.parametrize("seconds", [-1, 0, 1790278501])
@pytest.mark.parametrize("nanos", [1, 999, 1500, 999999999])
def test_timestamp_discards_submicroseconds_without_rounding(seconds: int, nanos: int) -> None:
    result = timestamp_to_datetime(Timestamp(seconds=seconds, nanos=nanos))
    assert result == datetime.fromtimestamp(seconds, UTC).replace(microsecond=nanos // 1000)


def test_note_update_wire_preserves_clear_and_omitted_fields() -> None:
    # Frozen bytes from the independent Google client preserve the public wire contract.
    wire = bytes.fromhex("0a016e12016f1a003a0c0a036b6579120576616c75654a00")
    request = UpdateNoteRequest.from_binary(wire)
    assert request.note_id == "n"
    assert request.organization_id == "o"
    assert request.title == "" and request.has_field("title")
    assert not request.has_field("content")
    assert request.tag_ids is not None and list(request.tag_ids.ids) == []
    assert request.icon is None
    assert dict(request.metadata) == {"key": "value"}
    assert request.to_binary() == wire
    assert UpdateNoteRequest.from_json(request.to_json()) == request


@pytest.mark.parametrize(
    ("wire", "expected"),
    [
        (
            "0a0a0a047465737442020102",
            Oneof(
                field="auth_result",
                value=AuthResult(access_token="test", domain_admin_domains=[1, 2]),
            ),
        ),
        (
            "120c0a04746573741204746f7470",
            Oneof(
                field="mfa_challenge", value=MfaChallenge(challenge_token="test", methods=["totp"])
            ),
        ),
    ],
)
def test_login_variants_match_frozen_wire(wire: str, expected: Oneof) -> None:
    payload = bytes.fromhex(wire)
    result = LoginResponse.from_binary(payload)
    assert result.result == expected
    assert result.to_binary() == payload
    assert LoginResponse.from_json(result.to_json()) == result


def test_optional_defaults_and_zero_oneof_retain_presence() -> None:
    criteria = FilterCriteria.from_binary(bytes.fromhex("2800"))
    assert criteria.size_min_bytes == 0 and criteria.has_field("size_min_bytes")
    assert not FilterCriteria().has_field("size_min_bytes")
    assert criteria.to_binary() == bytes.fromhex("2800")
    ref = TaskFieldRef.from_binary(bytes.fromhex("1000"))
    assert ref.ref == Oneof(field="pseudo", value=TaskPseudoField.UNSPECIFIED)
    assert ref.to_binary() == bytes.fromhex("1000")
    notifications = NotificationsSettings.from_binary(bytes.fromhex("0800"))
    assert notifications.browser_enabled is False
    assert notifications.has_field("browser_enabled")
    assert not notifications.has_field("email_enabled")
    assert notifications.to_binary() == bytes.fromhex("0800")
    assert NotificationsSettings.from_json(notifications.to_json()) == notifications


def test_unknown_binary_field_does_not_hide_known_fields() -> None:
    request = UpdateNoteRequest.from_binary(bytes.fromhex("0a016e1a00a00601"))
    assert request.note_id == "n"
    assert request.has_field("title") and request.title == ""
