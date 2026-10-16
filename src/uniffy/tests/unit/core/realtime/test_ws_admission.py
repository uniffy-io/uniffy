import pytest

from uniffy.core.realtime.auth import CANONICAL_SUBPROTOCOL, offered_subprotocols


@pytest.mark.parametrize(
    ("header", "offered"),
    [
        (None, []),
        ("", []),
        (f"bearer.token, {CANONICAL_SUBPROTOCOL}", [CANONICAL_SUBPROTOCOL]),
        (" uniffy.realtime.v1 ,bearer.a%2Cb, x ", ["uniffy.realtime.v1", "x"]),
        ("bearer.token", []),
    ],
)
def test_offered_subprotocols_never_include_the_bearer_entry(
    header: str | None, offered: list[str]
) -> None:
    assert offered_subprotocols(header) == offered
