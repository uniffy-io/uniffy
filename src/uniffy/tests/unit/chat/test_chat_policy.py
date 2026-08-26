"""Chat policy blob resolution: defaults win over malformed stored values."""

from uniffy.core.types import generate_id
from uniffy.domains.chat.policy import (
    DEFAULT_BROADCAST_CONFIRM_THRESHOLD,
    DEFAULT_EDIT_WINDOW_MINUTES,
    MAX_EDIT_WINDOW_MINUTES,
    BroadcastMinRole,
    EditHistoryVisibility,
    _from_blob,
)

ORG = generate_id()


class TestFromBlob:
    def test_empty_blob_resolves_to_defaults(self) -> None:
        policy = _from_blob(ORG, {})
        assert policy.broadcast_min_role is BroadcastMinRole.MEMBER
        assert policy.broadcast_confirm_threshold == DEFAULT_BROADCAST_CONFIRM_THRESHOLD

    def test_stored_values_round_trip(self) -> None:
        policy = _from_blob(
            ORG, {"broadcast_min_role": "admin", "broadcast_confirm_threshold": 100}
        )
        assert policy.broadcast_min_role is BroadcastMinRole.ADMIN
        assert policy.broadcast_confirm_threshold == 100

    def test_unknown_role_falls_back_to_default(self) -> None:
        policy = _from_blob(ORG, {"broadcast_min_role": "superuser"})
        assert policy.broadcast_min_role is BroadcastMinRole.MEMBER

    def test_malformed_threshold_falls_back_to_default(self) -> None:
        policy = _from_blob(ORG, {"broadcast_confirm_threshold": "lots"})
        assert policy.broadcast_confirm_threshold == DEFAULT_BROADCAST_CONFIRM_THRESHOLD

    def test_negative_threshold_clamps_to_zero(self) -> None:
        policy = _from_blob(ORG, {"broadcast_confirm_threshold": -5})
        assert policy.broadcast_confirm_threshold == 0

    def test_edit_fields_default_when_missing(self) -> None:
        policy = _from_blob(ORG, {})
        assert policy.edit_window_minutes == DEFAULT_EDIT_WINDOW_MINUTES
        assert policy.edit_history_visible_to is EditHistoryVisibility.ADMINS

    def test_null_edit_window_means_unlimited(self) -> None:
        policy = _from_blob(ORG, {"edit_window_minutes": None})
        assert policy.edit_window_minutes is None

    def test_malformed_edit_window_falls_back_to_default(self) -> None:
        policy = _from_blob(ORG, {"edit_window_minutes": "soon"})
        assert policy.edit_window_minutes == DEFAULT_EDIT_WINDOW_MINUTES

    def test_edit_window_clamps_to_bounds(self) -> None:
        assert _from_blob(ORG, {"edit_window_minutes": -5}).edit_window_minutes == 0
        assert (
            _from_blob(ORG, {"edit_window_minutes": 10**9}).edit_window_minutes
            == MAX_EDIT_WINDOW_MINUTES
        )

    def test_edit_history_visibility_round_trips(self) -> None:
        policy = _from_blob(ORG, {"edit_history_visible_to": "everyone"})
        assert policy.edit_history_visible_to is EditHistoryVisibility.EVERYONE

    def test_unknown_edit_history_visibility_falls_back(self) -> None:
        policy = _from_blob(ORG, {"edit_history_visible_to": "nobody"})
        assert policy.edit_history_visible_to is EditHistoryVisibility.ADMINS
