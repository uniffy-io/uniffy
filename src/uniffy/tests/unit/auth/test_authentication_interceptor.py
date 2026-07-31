"""Default-deny authentication across every ConnectRPC method.

Authentication used to be opt-in per handler, so a forgotten
``get_user_id_from_context`` left an RPC reachable with no credentials.
These tests pin the inverse: a method is private unless it appears in
``PUBLIC_METHODS``, and every entry in that allowlist names a method that
actually exists.
"""

import pathlib
import re

import pytest
from connectrpc.errors import ConnectError
from connectrpc.method import IdempotencyLevel, MethodInfo
from connectrpc.request import Headers, RequestContext

from uniffy.domains.auth.interceptors import PUBLIC_METHODS, AuthenticationInterceptor

_GEN_ROOT = pathlib.Path("src/gen/python/src/uniffy_proto")
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
        assert exc_info.value.code.name == "UNAUTHENTICATED", qualified


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


def test_every_mounted_service_carries_the_interceptors() -> None:
    """The gate is per-service, so a service mounted without the interceptor
    list would be authentication-free no matter what the allowlist says.
    """
    source = pathlib.Path("src/uniffy/factory.py").read_text()
    calls = re.findall(
        r'dispatcher\.add_service\(\s*"([^"]+)",\s*\w+\((.*?)\)\s*,?\s*\)', source, re.S
    )
    assert len(calls) > 30, len(calls)
    unguarded = [path for path, args in calls if "interceptors=interceptors" not in args]
    assert unguarded == []


async def test_a_refresh_token_does_not_authenticate_a_private_method(monkeypatch) -> None:
    """``get_user_id_from_context`` pins ``type == "access"``; refresh and
    access tokens share a secret, so only the type claim separates them.
    """
    from uniffy.core.types import generate_id
    from uniffy.domains.auth.tokens import create_refresh_token

    # The unit tier signs its own token: it must not depend on a developer's .env.
    monkeypatch.setenv("JWT_SECRET_KEY", "unit-test-secret-of-at-least-32-bytes")
    token = create_refresh_token(generate_id())
    with pytest.raises(ConnectError):
        await AuthenticationInterceptor().on_start(
            _ctx("notes.v1.NotesService/ListNotes", bearer=token)
        )
