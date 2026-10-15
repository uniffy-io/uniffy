"""Bearer-or-cookie authentication for read-only asset HTTP routes."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import Header, HTTPException, Request, status
from loguru import logger

from uniffy.core.auth.cookies import resolve_asset_cookie_config
from uniffy.core.auth.revocation import (
    RevocationUnavailableError,
    token_revocation,
)
from uniffy.core.auth.tokens import (
    decode_access_token,
    decode_asset_read_token,
)

logger = logger.bind(component="core.auth.http")

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Missing or invalid credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


async def _validate(payload: dict[str, Any]) -> UUID:
    user_id = UUID(payload["sub"])
    sid_raw = payload.get("sid")
    session_id = UUID(sid_raw) if sid_raw is not None else None
    if await token_revocation(user_id, payload.get("tkv"), session_id) is not None:
        raise _UNAUTHORIZED
    return user_id


async def get_current_user_id(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> UUID:
    if authorization and authorization.startswith("Bearer "):
        token, decode = authorization[7:], decode_access_token
    else:
        token = request.cookies.get(resolve_asset_cookie_config().name) or ""
        decode = decode_asset_read_token

    if not token:
        raise _UNAUTHORIZED

    try:
        payload = decode(token)
        return await _validate(payload)
    except RevocationUnavailableError as exc:
        raise HTTPException(
            status_code=503, detail="Authentication temporarily unavailable"
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.debug("Rejected asset credential", error_type=type(exc).__name__)
        raise _UNAUTHORIZED
