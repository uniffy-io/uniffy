"""Asset-read token type enforcement + cookie attribute resolution.

The asset cookie must be useless for anything but GET asset reads: the type-claim decoders reject it
on the access path and vice-versa, and the cookie attributes flip correctly between an HTTPS deploy
(Secure + __Secure- prefix) and a plain-http self-host (neither).
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

import jwt
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from uniffy.core.auth.cookies import (
    attach_asset_cookie,
    build_clear_cookie,
    build_set_cookie,
    resolve_asset_cookie_config,
)
from uniffy.core.auth.http import get_current_user_id
from uniffy.core.auth.tokens import (
    create_access_token,
    create_asset_read_token,
    decode_access_token,
    decode_asset_read_token,
    get_asset_token_expire_minutes,
)
from uniffy.core.types import generate_id

_TEST_SECRET = "test-32-byte-secret-padding-for-asset-cookie-01"


@pytest.fixture(autouse=True)
def _set_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", _TEST_SECRET)


def test_asset_read_token_roundtrips_with_its_claims() -> None:
    user_id = generate_id()
    org_id = generate_id()
    sid = generate_id()
    token = create_asset_read_token(user_id, org_id, token_version=7, session_id=sid)

    payload = decode_asset_read_token(token)
    assert payload["sub"] == str(user_id)
    assert payload["org_id"] == str(org_id)
    assert payload["sid"] == str(sid)
    assert payload["tkv"] == 7
    assert payload["type"] == "asset_read"


def test_access_token_is_rejected_on_the_asset_path() -> None:
    access = create_access_token(generate_id())
    with pytest.raises(jwt.InvalidTokenError):
        decode_asset_read_token(access)


def test_asset_read_token_is_rejected_on_the_access_path() -> None:
    asset = create_asset_read_token(generate_id())
    with pytest.raises(jwt.InvalidTokenError):
        decode_access_token(asset)


def test_asset_cookie_ttl_is_clamped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ASSET_COOKIE_TTL_MINUTES", "99999")
    assert get_asset_token_expire_minutes() == 240


def test_secure_deploy_uses_prefix_and_secure_attribute(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ASSET_COOKIE_SECURE", "true")
    config = resolve_asset_cookie_config()
    assert config.name.startswith("__Secure-")

    cookie = build_set_cookie(config, "the.jwt.value")
    assert "the.jwt.value" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=Strict" in cookie
    assert "Path=/api" in cookie
    assert "Secure" in cookie


def test_plain_http_deploy_drops_prefix_and_secure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ASSET_COOKIE_SECURE", "false")
    config = resolve_asset_cookie_config()
    assert not config.name.startswith("__Secure-")

    cookie = build_set_cookie(config, "the.jwt.value")
    assert "Secure" not in cookie


def test_secure_defaults_off_in_development_on_otherwise(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ASSET_COOKIE_SECURE", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "development")
    assert resolve_asset_cookie_config().secure is False
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert resolve_asset_cookie_config().secure is True


def test_clear_cookie_expires_immediately(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ASSET_COOKIE_SECURE", "true")
    cookie = build_clear_cookie(resolve_asset_cookie_config())
    assert "Max-Age=0" in cookie
    assert "Path=/api" in cookie


def _asset_route_client() -> TestClient:
    app = FastAPI()

    @app.get("/me")
    async def me(user_id: Annotated[UUID, Depends(get_current_user_id)]) -> dict[str, str]:
        return {"user_id": str(user_id)}

    return TestClient(app)


def test_cookie_authenticates_an_asset_route(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ASSET_COOKIE_SECURE", "false")
    user_id = generate_id()
    client = _asset_route_client()
    client.cookies.set("uniffy_asset", create_asset_read_token(user_id))

    resp = client.get("/me")
    assert resp.status_code == 200
    assert resp.json()["user_id"] == str(user_id)


def test_bearer_still_authenticates_an_asset_route() -> None:
    user_id = generate_id()
    client = _asset_route_client()

    resp = client.get("/me", headers={"Authorization": f"Bearer {create_access_token(user_id)}"})
    assert resp.status_code == 200
    assert resp.json()["user_id"] == str(user_id)


def test_asset_token_in_bearer_header_is_rejected() -> None:
    client = _asset_route_client()
    resp = client.get(
        "/me",
        headers={"Authorization": f"Bearer {create_asset_read_token(generate_id())}"},
    )
    assert resp.status_code == 401


def test_access_token_in_cookie_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ASSET_COOKIE_SECURE", "false")
    client = _asset_route_client()
    client.cookies.set("uniffy_asset", create_access_token(generate_id()))

    resp = client.get("/me")
    assert resp.status_code == 401


def test_no_credentials_is_rejected() -> None:
    resp = _asset_route_client().get("/me")
    assert resp.status_code == 401


def test_attach_asset_cookie_returns_the_pair_it_sets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ASSET_COOKIE_SECURE", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "development")

    headers: list[tuple[str, str]] = []

    class _Headers:
        def add(self, key: str, value: str) -> None:
            headers.append((key, value))

    class _Ctx:
        @property
        def response_headers(self) -> _Headers:
            return _Headers()

    user_id = generate_id()
    org_id = generate_id()
    sid = generate_id()
    access = create_access_token(user_id, org_id, token_version=3, session_id=sid)

    pair = attach_asset_cookie(
        _Ctx(),  # type: ignore[arg-type]
        access_token=access,
        user_id=user_id,
        organization_id=org_id,
        session_id=sid,
    )

    assert len(headers) == 1
    key, set_cookie = headers[0]
    assert key == "set-cookie"
    assert set_cookie.startswith(f"{pair}; ")

    name, _, token = pair.partition("=")
    assert name == resolve_asset_cookie_config().name
    payload = decode_asset_read_token(token)
    assert payload["sub"] == str(user_id)
    assert payload["org_id"] == str(org_id)
    assert payload["sid"] == str(sid)
    assert payload["tkv"] == 3
