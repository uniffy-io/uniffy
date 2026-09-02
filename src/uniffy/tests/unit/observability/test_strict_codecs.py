import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.auth.v1.auth_pb2 import LoginRequest

from uniffy.transport.rpc import strict_request_codecs


def _codec(name: str):
    codec = next((c for c in strict_request_codecs() if c.name() == name), None)
    assert codec is not None
    return codec


def test_registry_covers_the_default_codec_names() -> None:
    names = {codec.name() for codec in strict_request_codecs()}
    assert names == {"proto", "json", "json; charset=utf-8"}


@pytest.mark.parametrize(
    ("name", "body"),
    [
        ("json", b"{not json"),
        ("json", b'{"unknown_field": 1}'),
        ("json; charset=utf-8", b'{"unknown_field": 1}'),
        ("proto", b"\xff\xfe\xfd"),
    ],
)
def test_decode_failure_is_invalid_argument_without_parser_text(name: str, body: bytes) -> None:
    with pytest.raises(ConnectError) as exc_info:
        _codec(name).decode(body, LoginRequest())

    assert exc_info.value.code == Code.INVALID_ARGUMENT
    assert exc_info.value.message == "Malformed request body"


def test_well_formed_bodies_round_trip() -> None:
    request = LoginRequest(email="a@b.c", password="pw")
    for name in ("json", "proto"):
        codec = _codec(name)
        decoded = codec.decode(codec.encode(request), LoginRequest())
        assert decoded.email == "a@b.c"
        assert decoded.password == "pw"
