"""Ephemeral TURN credential minting, config resolution, and response wiring."""

import time
from uuid import UUID

import pytest
from uniffy_proto.calls.v1.calls_pb2 import (
    ICE_TRANSPORT_POLICY_RELAY,
    ICE_TRANSPORT_POLICY_UNSPECIFIED,
    JoinCallResponse,
)

from uniffy.core.types import generate_id
from uniffy.domains.calls import config as calls_config
from uniffy.domains.calls.config import LiveKitConfigError, TurnConfig
from uniffy.domains.calls.handlers import _ice_fields
from uniffy.domains.calls.turn import mint_turn_credentials

TURN_URLS = (
    "turn:turnstaging.uniffy.io:3478?transport=udp",
    "turn:turnstaging.uniffy.io:3478?transport=tcp",
)


def _config(ttl: int = 86400) -> TurnConfig:
    return TurnConfig(
        server_urls=TURN_URLS,
        shared_secret="test-turn-shared-secret",
        credential_ttl_seconds=ttl,
    )


@pytest.fixture
def turn_env(monkeypatch):
    """Set the TURN env and reset the module config cache around the test."""

    def apply(urls: str, secret: str = "test-turn-shared-secret", ttl: str | None = None):
        monkeypatch.setattr(calls_config, "_turn_config", None)
        monkeypatch.setattr(calls_config, "_turn_config_loaded", False)
        monkeypatch.setenv("TURN_SERVER_URLS", urls)
        monkeypatch.setenv("TURN_SHARED_SECRET", secret)
        if ttl is None:
            monkeypatch.delenv("TURN_CREDENTIAL_TTL_SECONDS", raising=False)
        else:
            monkeypatch.setenv("TURN_CREDENTIAL_TTL_SECONDS", ttl)

    yield apply
    calls_config._turn_config = None
    calls_config._turn_config_loaded = False


def test_hmac_vector_pins_wire_format(monkeypatch):
    # Pinned vector: base64(HMAC-SHA1("test-turn-shared-secret",
    # "1700000000:8f4d7c3a-2b1e-4f6a-9c8d-5e7f01234567")). A refactor that
    # changes the derivation breaks live TURN auth, so it must fail here first.
    monkeypatch.setattr(time, "time", lambda: 1700000000 - 600)
    creds = mint_turn_credentials(
        UUID("8f4d7c3a-2b1e-4f6a-9c8d-5e7f01234567"), _config(ttl=600)
    )
    assert creds.username == "1700000000:8f4d7c3a-2b1e-4f6a-9c8d-5e7f01234567"
    assert creds.credential == "oyjjZ1FqhmBDnoehwGn4I07UeLM="


def test_single_credential_pair_covers_all_urls():
    creds = mint_turn_credentials(generate_id(), _config())
    assert creds.urls == TURN_URLS


def test_username_expiry_is_now_plus_ttl():
    user_id = generate_id()
    before = int(time.time())
    creds = mint_turn_credentials(user_id, _config(ttl=86400))
    after = int(time.time())
    expiry, _, embedded_user = creds.username.partition(":")
    assert embedded_user == str(user_id)
    assert before + 86400 <= int(expiry) <= after + 86400


def test_unset_urls_resolve_to_no_turn_config(turn_env):
    turn_env("")
    assert calls_config.get_turn_config() is None


def test_urls_without_secret_raise_typed_error(turn_env):
    turn_env("turn:host:3478", secret="")
    with pytest.raises(LiveKitConfigError):
        calls_config.get_turn_config()


def test_ttl_defaults_to_8h(turn_env):
    turn_env("turn:a:3478, turn:b:3478")
    config = calls_config.get_turn_config()
    assert config is not None
    assert config.credential_ttl_seconds == 28800
    assert config.server_urls == ("turn:a:3478", "turn:b:3478")


def test_malformed_ttl_raises_typed_error(turn_env):
    turn_env("turn:host:3478", ttl="8h")
    with pytest.raises(LiveKitConfigError):
        calls_config.get_turn_config()


def test_nonpositive_ttl_raises_typed_error(turn_env):
    turn_env("turn:host:3478", ttl="0")
    with pytest.raises(LiveKitConfigError):
        calls_config.get_turn_config()


def test_join_response_carries_ice_servers_when_turn_configured(turn_env):
    turn_env("turn:a:3478,turn:b:3478")
    user_id = generate_id()
    response = JoinCallResponse(livekit_token="tok", **_ice_fields(user_id))
    assert response.ice_transport_policy == ICE_TRANSPORT_POLICY_RELAY
    assert len(response.ice_servers) == 1
    server = response.ice_servers[0]
    assert list(server.urls) == ["turn:a:3478", "turn:b:3478"]
    assert server.username.endswith(f":{user_id}")
    assert server.credential


def test_join_response_has_no_ice_servers_in_direct_mode(turn_env):
    turn_env("")
    response = JoinCallResponse(livekit_token="tok", **_ice_fields(generate_id()))
    assert len(response.ice_servers) == 0
    assert response.ice_transport_policy == ICE_TRANSPORT_POLICY_UNSPECIFIED
