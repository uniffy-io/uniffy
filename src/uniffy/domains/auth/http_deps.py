"""Shared HTTP auth for asset GET routes (non-ConnectRPC).

Accepts a Bearer access token (mobile / non-browser clients) OR the read-only `asset_read` cookie
(browsers, which cannot set headers on `<img>`/`<video>`). Both ride the same Valkey revocation
watermark, so a force-logout / suspension / demotion takes effect cluster-wide within a round-trip.
The type-claim decoders keep the paths separate - an access token in the cookie, or an asset_read
token in the header, is rejected. Mutating RPCs never use this; they stay Bearer-only.
"""

from typing import Annotated, Any
from uuid import UUID

from fastapi import Header, HTTPException, Request, status
from loguru import logger

from uniffy.domains.auth.cookies import resolve_asset_cookie_config
from uniffy.domains.auth.revocation import (
    is_access_token_revoked,
    is_session_revoked,
)
from uniffy.domains.auth.tokens import (
    decode_access_token,
    decode_asset_read_token,
)

logger = logger.bind(component="auth.http_deps")

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Missing or invalid credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


async def _validate(payload: dict[str, Any]) -> UUID:
    user_id = UUID(payload["sub"])
    if await is_access_token_revoked(user_id, payload.get("tkv")):
        raise _UNAUTHORIZED
    sid_raw = payload.get("sid")
    if sid_raw:
        try:
            session_id: UUID | None = UUID(sid_raw)
        except (TypeError, ValueError):
            session_id = None
        if session_id is not None and await is_session_revoked(session_id):
            raise _UNAUTHORIZED
    return user_id


async def get_current_user_id(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> UUID:
    """Resolve the user id from a Bearer access token, else the asset_read cookie. 401 if neither."""
    if authorization and authorization.startswith("Bearer "):
        token, decode = authorization[7:], decode_access_token
    else:
        token = request.cookies.get(resolve_asset_cookie_config().name) or ""
        decode = decode_asset_read_token

    if not token:
        raise _UNAUTHORIZED

    try:
        payload = decode(token)
    except Exception as e:
        logger.debug(f"asset auth decode error: {e}")
        raise _UNAUTHORIZED

    return await _validate(payload)
