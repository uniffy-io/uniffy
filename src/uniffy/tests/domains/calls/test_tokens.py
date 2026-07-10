"""Unit tests for LiveKit token minting and webhook verification."""

import base64
import hashlib
import json
import time
import uuid

import jwt
import pytest

from uniffy.core.webhooks import WebhookVerificationError
from uniffy.domains.calls.config import LiveKitConfig
from uniffy.domains.calls.tokens import (
    USER_TOKEN_TTL_SECONDS,
    LiveKitTokenMinter,
    livekit_room_name,
    parse_room_call_id,
    participant_identity,
)

SECRET = "test-secret-with-enough-length-32ch"
API_KEY = "testkey"


@pytest.fixture
def minter() -> LiveKitTokenMinter:
    return LiveKitTokenMinter(
        LiveKitConfig(
            host="http://localhost:7880",
            api_key=API_KEY,
            api_secret=SECRET,
            ws_url="/livekit",
        )
    )


def _decode(token: str) -> dict:
    return jwt.decode(
        token,
        SECRET,
        algorithms=["HS256"],
        options={"verify_aud": False},
        leeway=600,
    )


def test_room_name_round_trip():
    org_id, call_id = uuid.uuid4(), uuid.uuid4()
    assert parse_room_call_id(livekit_room_name(org_id, call_id)) == call_id


def test_parse_room_rejects_foreign_names():
    assert parse_room_call_id("random-room") is None
    assert parse_room_call_id("org_x:call_not-a-uuid") is None
    assert parse_room_call_id("") is None


def test_user_token_grants(minter):
    org_id, call_id, user_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    minted = minter.mint_user_token(
        organization_id=org_id,
        call_id=call_id,
        user_id=user_id,
        device_id="dev1",
        display_name="Alice",
    )
    claims = _decode(minted.token)
    assert claims["sub"] == participant_identity(user_id, "dev1")
    assert claims["iss"] == API_KEY
    assert claims["jti"] == minted.jti
    assert claims["video"]["room"] == livekit_room_name(org_id, call_id)
    assert claims["video"]["roomJoin"] is True
    assert claims["video"]["canPublish"] is True
    assert "microphone" in claims["video"]["canPublishSources"]
    metadata = json.loads(claims["metadata"])
    assert metadata["user_id"] == str(user_id)
    assert metadata["jti"] == minted.jti
    assert claims["exp"] - time.time() == pytest.approx(USER_TOKEN_TTL_SECONDS, abs=30)


def test_user_token_listen_only(minter):
    minted = minter.mint_user_token(
        organization_id=uuid.uuid4(),
        call_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        device_id="dev1",
        display_name="Bob",
        can_publish=False,
    )
    claims = _decode(minted.token)
    assert claims["video"]["canPublish"] is False
    assert claims["video"]["canPublishSources"] == []


def test_admin_token_grants(minter):
    claims = _decode(minter.mint_admin_token(room="org_x:call_y"))
    assert claims["video"]["roomAdmin"] is True
    assert claims["video"]["room"] == "org_x:call_y"


def _webhook_auth(
    body: bytes, *, secret: str = SECRET, issuer: str = API_KEY, exp_offset: int = 300
) -> str:
    now = int(time.time())
    claims = {
        "iss": issuer,
        "nbf": now - 10,
        "exp": now + exp_offset,
        "sha256": base64.b64encode(hashlib.sha256(body).digest()).decode(),
    }
    return jwt.encode(claims, secret, algorithm="HS256")


def test_webhook_verify_accepts_valid(minter):
    body = json.dumps({"event": "participant_left", "room": {"name": "r"}}).encode()
    event = minter.verify_webhook(body, f"Bearer {_webhook_auth(body)}")
    assert event["event"] == "participant_left"


def test_webhook_verify_accepts_raw_token_header(minter):
    # LiveKit sends the bare JWT without a Bearer prefix.
    body = b"{}"
    assert minter.verify_webhook(body, _webhook_auth(body)) == {}


def test_webhook_verify_rejects_wrong_secret(minter):
    body = b"{}"
    with pytest.raises(WebhookVerificationError):
        minter.verify_webhook(body, _webhook_auth(body, secret="another-secret-another-secret-32"))


def test_webhook_verify_rejects_body_mutation(minter):
    body = b'{"event": "room_finished"}'
    header = _webhook_auth(body)
    with pytest.raises(WebhookVerificationError):
        minter.verify_webhook(b'{"event": "room_started"}', header)


def test_webhook_verify_rejects_expired(minter):
    body = b"{}"
    with pytest.raises(WebhookVerificationError):
        minter.verify_webhook(body, _webhook_auth(body, exp_offset=-3600))


def test_webhook_verify_rejects_missing_exp(minter):
    body = b"{}"
    claims = {
        "iss": API_KEY,
        "sha256": base64.b64encode(hashlib.sha256(body).digest()).decode(),
    }
    token = jwt.encode(claims, SECRET, algorithm="HS256")
    with pytest.raises(WebhookVerificationError):
        minter.verify_webhook(body, token)


def test_webhook_verify_rejects_wrong_issuer(minter):
    body = b"{}"
    with pytest.raises(WebhookVerificationError):
        minter.verify_webhook(body, _webhook_auth(body, issuer="otherkey"))


def test_webhook_verify_rejects_missing_header(minter):
    with pytest.raises(WebhookVerificationError):
        minter.verify_webhook(b"{}", "")
