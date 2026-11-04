import pytest
from uniffy_proto.settings.v1.settings_pb import AppearanceSettings

from uniffy.core.errors import ValidationError
from uniffy.domains.settings.converters import appearance_dict_to_proto, appearance_from_proto
from uniffy.domains.settings.defaults import get_effective_appearance
from uniffy.domains.settings.operations import _validate_appearance


def test_absent_preference_opens_modal() -> None:
    assert get_effective_appearance(None)["task_open_view"] == "modal"


@pytest.mark.parametrize("view", ["panel", "modal", "page"])
def test_task_view_survives_settings_round_trip(view: str) -> None:
    appearance = {"task_open_view": view}
    _validate_appearance(appearance)
    assert appearance_from_proto(appearance_dict_to_proto(appearance)) == appearance
    assert get_effective_appearance(appearance)["task_open_view"] == view


@pytest.mark.parametrize("view", ["", "sidebar", "unknown", 1, [], {}])
def test_invalid_task_view_is_rejected(view: object) -> None:
    with pytest.raises(ValidationError):
        _validate_appearance({"task_open_view": view})


def test_other_appearance_updates_leave_task_view_unset() -> None:
    assert appearance_from_proto(AppearanceSettings(theme="dark")) == {"theme": "dark"}
