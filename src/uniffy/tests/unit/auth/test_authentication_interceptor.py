"""Default-deny authentication across every ConnectRPC method.

Authentication used to be opt-in per handler, so a forgotten
``current_user_id`` left an RPC reachable with no credentials.
These tests pin the inverse: a method is private unless it appears in
``PUBLIC_METHODS``, and every entry in that allowlist names a method that
actually exists.
"""

import pathlib
import re
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.method import IdempotencyLevel, MethodInfo
from connectrpc.request import Headers, RequestContext

from uniffy.core.auth.principal import current_principal
from uniffy.core.auth.tokens import create_access_token, create_refresh_token, decode_access_token
from uniffy.core.search import SearchIndexer, WorkspaceSearch
from uniffy.core.search.engine import SearchEngine
from uniffy.core.storage import ObjectStorage
from uniffy.core.streaming.disconnect import StreamDisconnectMiddleware
from uniffy.core.streaming.middleware import StreamRevokeWatchMiddleware
from uniffy.core.types import generate_id
from uniffy.domains.auth.interceptors import PUBLIC_METHODS, AuthenticationInterceptor
from uniffy.factory import _create_api_dispatcher

_GEN_ROOT = pathlib.Path("src/proto/gen/python/src/uniffy_proto")
_METHOD_RE = re.compile(
    r'MethodInfo\(\s*name="(?P<name>[^"]+)",\s*service_name="(?P<service>[^"]+)"',
    re.S,
)


def _all_generated_methods() -> set[str]:
    found: set[str] = set()
    for path in _GEN_ROOT.rglob("*_connect.py"):
        for m in _METHOD_RE.finditer(path.read_text()):
            found.add(f"{m.group('service')}/{m.group('name')}")
    return found


def _ctx(qualified: str, *, bearer: str | None = None) -> RequestContext:
    service, name = qualified.split("/")
    headers = Headers()
    if bearer is not None:
        headers["authorization"] = f"Bearer {bearer}"
    return RequestContext(
        method=MethodInfo(
            name=name,
            service_name=service,
            input=object,
            output=object,
            idempotency_level=IdempotencyLevel.UNKNOWN,
        ),
        http_method="POST",
        request_headers=headers,
    )


def test_the_generated_registry_is_discoverable() -> None:
    """Guards the two tests below from silently passing on an empty set."""
    methods = _all_generated_methods()
    assert len(methods) > 400, len(methods)


def test_every_public_method_exists() -> None:
    """A typo or a renamed RPC would otherwise leave a method quietly private."""
    missing = sorted(PUBLIC_METHODS - _all_generated_methods())
    assert missing == []


@pytest.mark.parametrize("qualified", sorted(PUBLIC_METHODS))
async def test_public_methods_pass_without_a_token(qualified: str) -> None:
    await AuthenticationInterceptor().on_start(_ctx(qualified))


async def test_every_other_method_is_denied_without_a_token() -> None:
    interceptor = AuthenticationInterceptor()
    private = sorted(_all_generated_methods() - PUBLIC_METHODS)
    assert private, "no private methods discovered"

    for qualified in private:
        with pytest.raises(ConnectError) as exc_info:
            await interceptor.on_start(_ctx(qualified))
        assert exc_info.value.code is Code.UNAUTHENTICATED, qualified


@pytest.mark.parametrize(
    "bearer",
    ["", "not-a-jwt", "a.b.c"],
    ids=["empty", "garbage", "jwt-shaped-garbage"],
)
async def test_malformed_tokens_are_denied(bearer: str) -> None:
    with pytest.raises(ConnectError):
        await AuthenticationInterceptor().on_start(
            _ctx("notes.v1.NotesService/ListNotes", bearer=bearer)
        )


def test_every_mounted_service_carries_the_authentication_interceptor() -> None:
    search = WorkspaceSearch(MagicMock(spec=SearchEngine))
    dispatcher = _create_api_dispatcher(
        MagicMock(spec=ObjectStorage),
        search,
        SearchIndexer(search),
    )

    unguarded: list[str] = []
    discovered: list[str] = []
    for prefix, application in dispatcher.services:
        while isinstance(application, (StreamDisconnectMiddleware, StreamRevokeWatchMiddleware)):
            application = application.app
        if not hasattr(application, "_endpoints"):
            continue
        discovered.append(prefix)
        if not any(
            isinstance(interceptor, AuthenticationInterceptor)
            for interceptor in application._interceptors
        ):
            unguarded.append(prefix)

    assert discovered
    assert unguarded == []


async def test_a_refresh_token_does_not_authenticate_a_private_method(monkeypatch) -> None:
    """``current_user_id`` pins ``type == "access"``; refresh and
    access tokens share a secret, so only the type claim separates them.
    """
    monkeypatch.setenv("JWT_SECRET_KEY", "unit-test-secret-of-at-least-32-bytes")
    token = create_refresh_token(generate_id())
    with pytest.raises(ConnectError):
        await AuthenticationInterceptor().on_start(
            _ctx("notes.v1.NotesService/ListNotes", bearer=token)
        )


async def test_private_request_publishes_one_decoded_principal(monkeypatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", "unit-test-secret-of-at-least-32-bytes")
    user_id = generate_id()
    organization_id = generate_id()
    session_id = generate_id()
    full_name = "Ada Lovelace"
    avatar_key = "avatars/ada.png"
    bearer = create_access_token(
        user_id,
        organization_id,
        token_version=7,
        session_id=session_id,
        full_name=full_name,
        avatar_key=avatar_key,
    )
    interceptor = AuthenticationInterceptor()
    ctx = _ctx("notes.v1.NotesService/ListNotes", bearer=bearer)

    with (
        patch(
            "uniffy.domains.auth.interceptors.is_access_token_revoked",
            AsyncMock(return_value=False),
        ),
        patch(
            "uniffy.domains.auth.interceptors.is_session_revoked",
            AsyncMock(return_value=False),
        ),
        patch(
            "uniffy.core.auth.principal.decode_access_token",
            wraps=decode_access_token,
        ) as decode,
    ):
        reset_token = await interceptor.on_start(ctx)
        try:
            principal = current_principal()
            assert principal.user_id == user_id
            assert principal.organization_id == organization_id
            assert principal.session_id == session_id
            assert principal.token_version == 7
            assert principal.full_name == full_name
            assert principal.avatar_key == avatar_key
            assert decode.call_count == 1
        finally:
            await interceptor.on_end(reset_token, ctx, None)

    with pytest.raises(ConnectError):
        current_principal()


async def test_public_wrong_kind_token_still_obeys_revocation(monkeypatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", "unit-test-secret-of-at-least-32-bytes")
    token = create_refresh_token(generate_id(), token_version=2)

    with (
        patch(
            "uniffy.domains.auth.interceptors.is_access_token_revoked",
            AsyncMock(return_value=True),
        ),
        pytest.raises(ConnectError) as exc_info,
    ):
        await AuthenticationInterceptor().on_start(
            _ctx("auth.v1.AuthService/RefreshToken", bearer=token)
        )

    assert exc_info.value.code is Code.UNAUTHENTICATED


async def test_revoked_session_never_publishes_a_principal(monkeypatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", "unit-test-secret-of-at-least-32-bytes")
    bearer = create_access_token(generate_id(), session_id=generate_id())

    with (
        patch(
            "uniffy.domains.auth.interceptors.is_access_token_revoked",
            AsyncMock(return_value=False),
        ),
        patch(
            "uniffy.domains.auth.interceptors.is_session_revoked",
            AsyncMock(return_value=True),
        ),
        pytest.raises(ConnectError) as exc_info,
    ):
        await AuthenticationInterceptor().on_start(
            _ctx("notes.v1.NotesService/ListNotes", bearer=bearer)
        )

    assert exc_info.value.code is Code.UNAUTHENTICATED
    with pytest.raises(ConnectError):
        current_principal()


async def test_public_enrollment_rpc_accepts_an_access_principal(monkeypatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", "unit-test-secret-of-at-least-32-bytes")
    user_id = generate_id()
    bearer = create_access_token(user_id)
    interceptor = AuthenticationInterceptor()
    ctx = _ctx("auth.v1.MfaService/BeginEnrollment", bearer=bearer)

    with (
        patch(
            "uniffy.domains.auth.interceptors.is_access_token_revoked",
            AsyncMock(return_value=False),
        ),
        patch(
            "uniffy.domains.auth.interceptors.is_session_revoked",
            AsyncMock(return_value=False),
        ),
    ):
        reset_token = await interceptor.on_start(ctx)
        try:
            assert current_principal().user_id == user_id
        finally:
            await interceptor.on_end(reset_token, ctx, None)
