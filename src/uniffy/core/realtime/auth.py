"""WebSocket subprotocol-carried bearer token extraction + close-code constants.

Browsers cannot set ``Authorization`` on ``new WebSocket(...)``; the only
carrier reachable from JS is ``Sec-WebSocket-Protocol``. The client sends
two protocol values - the canonical ``uniffy.realtime.v1`` and a
``bearer.<urlencoded-jwt>`` entry. The server echoes only the canonical
name back so the bearer never appears in ``WebSocket.protocol``.

Mobile (React Native) clients can set ``Authorization`` directly; either
carrier is accepted, subprotocol taking priority.
"""

import os
from urllib.parse import unquote

_BEARER_PREFIX = "bearer."

# Close codes (4xxx range = application-defined per RFC 6455).
WS_CLOSE_UNSUPPORTED_TYPE = 4400
WS_CLOSE_UNAUTHENTICATED = 4401
WS_CLOSE_FORBIDDEN = 4403
WS_CLOSE_NOT_FOUND = 4404
WS_CLOSE_IDLE = 4408
WS_CLOSE_TOKEN_REVOKED = 4410

# MUST NOT include the bearer entry on accept - that would expose the
# token via the ``WebSocket.protocol`` JS field.
CANONICAL_SUBPROTOCOL = "uniffy.realtime.v1"


def extract_bearer(subprotocol_header: str | None) -> str | None:
    """Pull the JWT out of a ``Sec-WebSocket-Protocol`` header value.

    Returns the URL-decoded token from the first comma-separated entry
    starting with ``bearer.``, or ``None``.
    """
    if not subprotocol_header:
        return None
    for raw in subprotocol_header.split(","):
        entry = raw.strip()
        if entry.startswith(_BEARER_PREFIX):
            return unquote(entry[len(_BEARER_PREFIX) :])
    return None


def extract_bearer_from_auth_header(authorization: str | None) -> str | None:
    """Fallback for clients (mobile) that send ``Authorization: Bearer <token>``.

    Scheme matching is case-insensitive per RFC 7235.
    """
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() == "bearer" and value:
        return value
    return None


def origin_is_allowed(origin: str | None, allowlist: list[str]) -> bool:
    """Reject WebSocket upgrades from origins outside the app's allowlist.

    The WS spec does NOT enforce same-origin; a tab on attacker.com
    can open a socket against this backend. ``"*"`` in ``allowlist``
    matches everything (dev only). A missing ``Origin`` header (non-
    browser client) is accepted because RFC 6455 only mandates the
    header for browsers.
    """
    if origin is None:
        return True
    if "*" in allowlist:
        return True
    return origin in allowlist


def get_ws_origin_allowlist() -> list[str]:
    """Read the WS origin allowlist from env (reuses ``CORS_ORIGINS``)."""
    raw = os.getenv("CORS_ORIGINS", "*")
    if raw == "*":
        return ["*"]
    return [entry.strip() for entry in raw.split(",") if entry.strip()]
