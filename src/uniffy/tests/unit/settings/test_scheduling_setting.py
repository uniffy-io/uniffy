"""The scheduling section: defaults, validation, proto round trip, batch resolver."""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from uniffy_proto.settings.v1.settings_pb import SchedulingSettings

from uniffy.core.errors import ValidationError
from uniffy.domains.settings.converters import (
    scheduling_dict_to_proto,
    scheduling_from_proto,
)
from uniffy.domains.settings.defaults import get_effective_scheduling
from uniffy.domains.settings.operations import (
    _validate_scheduling,
    get_users_scheduling_context,
)


def test_defaults_are_weekday_nine_to_six() -> None:
    effective = get_effective_scheduling(None)
    assert effective["workday_start"] == "09:00"
    assert effective["workday_end"] == "18:00"
    assert effective["workdays"] == ["monday", "tuesday", "wednesday", "thursday", "friday"]


def test_override_merges_into_effective() -> None:
    effective = get_effective_scheduling({"workday_start": "07:30"})
    assert effective["workday_start"] == "07:30"
    assert effective["workday_end"] == "18:00"


def test_validate_accepts_absent_and_valid() -> None:
    _validate_scheduling(None)
    _validate_scheduling({})
    _validate_scheduling({
        "workday_start": "08:00",
        "workday_end": "16:30",
        "workdays": ["monday", "saturday"],
    })


def test_validate_rejects_bad_clock() -> None:
    with pytest.raises(ValidationError):
        _validate_scheduling({"workday_start": "25:00"})
    with pytest.raises(ValidationError):
        _validate_scheduling({"workday_end": "9am"})


def test_validate_rejects_inverted_hours() -> None:
    with pytest.raises(ValidationError):
        _validate_scheduling({"workday_start": "18:00", "workday_end": "09:00"})


def test_validate_rejects_unknown_or_empty_workdays() -> None:
    with pytest.raises(ValidationError):
        _validate_scheduling({"workdays": ["funday"]})
    with pytest.raises(ValidationError):
        _validate_scheduling({"workdays": []})


def test_proto_round_trip_is_sparse() -> None:
    assert scheduling_from_proto(SchedulingSettings()) is None
    proto = SchedulingSettings(workday_start="10:00", workdays=["tuesday"])
    parsed = scheduling_from_proto(proto)
    assert parsed == {"workday_start": "10:00", "workdays": ["tuesday"]}
    back = scheduling_dict_to_proto(parsed)
    assert back.workday_start == "10:00"
    assert not back.has_field("workday_end")
    assert list(back.workdays) == ["tuesday"]


def _resolver_session(profile_rows: list, people_rows: list) -> MagicMock:
    session = MagicMock()
    profiles = MagicMock(all=MagicMock(return_value=profile_rows))
    people = MagicMock(all=MagicMock(return_value=people_rows))
    session.execute = AsyncMock(side_effect=[profiles, people])
    return session


def _row(**kwargs) -> MagicMock:
    row = MagicMock()
    for key, value in kwargs.items():
        setattr(row, key, value)
    return row


async def test_batch_resolver_fills_defaults_for_every_id() -> None:
    known, unknown = uuid4(), uuid4()
    session = _resolver_session(
        [
            _row(
                user_id=known,
                appearance={"timezone": "Europe/Sofia"},
                scheduling={"workday_start": "10:00"},
            )
        ],
        [],
    )
    contexts = await get_users_scheduling_context(session, [known, unknown])
    assert contexts[known].timezone == "Europe/Sofia"
    assert contexts[known].workday_start == "10:00"
    assert contexts[known].workday_end == "18:00"
    assert contexts[unknown].timezone == "UTC"
    assert contexts[unknown].workdays == ("monday", "tuesday", "wednesday", "thursday", "friday")


async def test_batch_resolver_falls_back_to_people_profile_timezone() -> None:
    uid = uuid4()
    session = _resolver_session(
        [_row(user_id=uid, appearance=None, scheduling=None)],
        [_row(user_id=uid, timezone="America/New_York")],
    )
    contexts = await get_users_scheduling_context(session, [uid])
    assert contexts[uid].timezone == "America/New_York"


async def test_batch_resolver_private_preference_wins_over_people_profile() -> None:
    uid = uuid4()
    session = _resolver_session(
        [_row(user_id=uid, appearance={"timezone": "Asia/Tokyo"}, scheduling=None)],
        [_row(user_id=uid, timezone="America/New_York")],
    )
    contexts = await get_users_scheduling_context(session, [uid])
    assert contexts[uid].timezone == "Asia/Tokyo"


async def test_batch_resolver_empty_input_is_free() -> None:
    session = MagicMock()
    assert await get_users_scheduling_context(session, []) == {}
    session.execute.assert_not_called()
