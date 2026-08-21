"""Chat policy blob resolution: defaults win over malformed stored values."""

from uniffy.core.types import generate_id
from uniffy.domains.chat.policy import (
    DEFAULT_BROADCAST_CONFIRM_THRESHOLD,
    BroadcastMinRole,
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
