"""WebSocket bearer-token extraction and close-code constants.

Browsers cannot set ``Authorization`` on ``new WebSocket(...)``, so the JWT
rides ``Sec-WebSocket-Protocol`` as a ``bearer.<urlencoded-jwt>`` entry
alongside the canonical ``uniffy.realtime.v1`` value. The server echoes ONLY
the canonical name back so the bearer never appears in ``WebSocket.protocol``.
Mobile clients can use the ``Authorization`` header instead.
"""

import os
from urllib.parse import unquote

_BEARER_PREFIX = "bearer."

WS_CLOSE_UNSUPPORTED_TYPE = 4400
WS_CLOSE_UNAUTHENTICATED = 4401
WS_CLOSE_FORBIDDEN = 4403
WS_CLOSE_NOT_FOUND = 4404
WS_CLOSE_IDLE = 4408
WS_CLOSE_TOKEN_REVOKED = 4410

# MUST NOT echo the bearer entry on accept - that would expose the token via JS.
CANONICAL_SUBPROTOCOL = "uniffy.realtime.v1"


def extract_bearer(subprotocol_header: str | None) -> str | None:
    """URL-decoded JWT from the first ``bearer.`` entry in the subprotocol header."""
    if not subprotocol_header:
        return None
    for raw in subprotocol_header.split(","):
        entry = raw.strip()
        if entry.startswith(_BEARER_PREFIX):
            return unquote(entry[len(_BEARER_PREFIX) :])
    return None


def extract_bearer_from_auth_header(authorization: str | None) -> str | None:
    """Fallback for clients that send ``Authorization: Bearer <token>``."""
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() == "bearer" and value:
        return value
    return None


def origin_is_allowed(origin: str | None, allowlist: list[str]) -> bool:
    """Reject WS upgrades from non-allowlisted origins; ``"*"`` is dev-only,
    missing ``Origin`` is accepted.
    """
    if origin is None:
        return True
    if "*" in allowlist:
        return True
    return origin in allowlist


def get_ws_origin_allowlist() -> list[str]:
    """WS origin allowlist from env (reuses ``CORS_ORIGINS``)."""
    raw = os.getenv("CORS_ORIGINS", "*")
    if raw == "*":
        return ["*"]
    return [entry.strip() for entry in raw.split(",") if entry.strip()]
