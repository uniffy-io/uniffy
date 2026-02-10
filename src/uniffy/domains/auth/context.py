"""Authentication context utilities for extracting user info from requests."""

import re
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uniffy.domains.auth.tokens import decode_access_token


def get_user_id_from_context(ctx: RequestContext) -> UUID:
    """
    Extract user ID from request context.

    Extracts and validates the JWT token from the Authorization header,
    then returns the user ID from the token payload.

    Parameters
    ----------
    ctx : RequestContext
        RPC request context.

    Returns
    -------
    UUID
        User ID from the JWT token.

    Raises
    ------
    ConnectError
        If authorization token is missing, invalid, or expired.

    """
    headers = ctx.request_headers()
    auth_header = headers.get("authorization", "")

    if not auth_header.startswith("Bearer "):
        raise ConnectError(
            Code.UNAUTHENTICATED,
            "Missing or invalid authorization header",
        )

    token = auth_header[7:]  # Remove "Bearer " prefix

    try:
        payload = decode_access_token(token)
        user_id = UUID(payload["sub"])
        return user_id
    except Exception as e:
        logger.error(f"JWT decode error: {e}")
        raise ConnectError(Code.UNAUTHENTICATED, f"Invalid or expired token: {e}")


def get_organization_id_from_context(ctx: RequestContext) -> UUID | None:
    """
    Extract organization ID from request context if present.

    Parameters
    ----------
    ctx : RequestContext
        RPC request context.

    Returns
    -------
    UUID | None
        Organization ID from the JWT token, or None if not present.

    """
    headers = ctx.request_headers()
    auth_header = headers.get("authorization", "")

    if not auth_header.startswith("Bearer "):
        return None

    token = auth_header[7:]

    try:
        payload = decode_access_token(token)
        org_id = payload.get("org_id")
        return UUID(org_id) if org_id else None
    except Exception:
        return None


def get_session_id_from_context(ctx: RequestContext) -> UUID | None:
    """
    Extract session ID from the access token in request context.

    Parameters
    ----------
    ctx : RequestContext
        RPC request context.

    Returns
    -------
    UUID | None
        Session ID from the JWT token, or None if not present (old tokens).

    """
    headers = ctx.request_headers()
    auth_header = headers.get("authorization", "")

    if not auth_header.startswith("Bearer "):
        return None

    token = auth_header[7:]

    try:
        payload = decode_access_token(token)
        sid = payload.get("sid")
        return UUID(sid) if sid else None
    except Exception:
        return None


def get_user_agent_from_context(ctx: RequestContext) -> str:
    """
    Extract User-Agent header from request context.

    Parameters
    ----------
    ctx : RequestContext
        RPC request context.

    Returns
    -------
    str
        User-Agent string, or empty string if not present.

    """
    headers = ctx.request_headers()
    return headers.get("user-agent", "")


# Pre-compiled patterns for device label parsing
_BROWSER_PATTERNS = [
    (re.compile(r"Edg(?:e)?/([\d.]+)"), "Edge"),
    (re.compile(r"OPR/([\d.]+)"), "Opera"),
    (re.compile(r"Chrome/([\d.]+)"), "Chrome"),
    (re.compile(r"Firefox/([\d.]+)"), "Firefox"),
    (re.compile(r"Safari/([\d.]+)"), "Safari"),
]

_OS_PATTERNS = [
    (re.compile(r"Android"), "Android"),
    (re.compile(r"iPhone|iPad|iPod"), "iOS"),
    (re.compile(r"CrOS"), "ChromeOS"),
    (re.compile(r"Windows NT"), "Windows"),
    (re.compile(r"Macintosh|Mac OS X"), "macOS"),
    (re.compile(r"Linux"), "Linux"),
]


def parse_device_label(user_agent: str) -> str:
    """
    Parse User-Agent string into a human-readable device label.

    Parameters
    ----------
    user_agent : str
        Raw User-Agent header value.

    Returns
    -------
    str
        Human-readable label like "Chrome on macOS", or "Unknown device"
        if the UA cannot be parsed.

    """
    if not user_agent:
        return "Unknown device"

    browser = "Unknown browser"
    for pattern, name in _BROWSER_PATTERNS:
        if pattern.search(user_agent):
            browser = name
            break

    os_name = "Unknown OS"
    for pattern, name in _OS_PATTERNS:
        if pattern.search(user_agent):
            os_name = name
            break

    if browser == "Unknown browser" and os_name == "Unknown OS":
        return "Unknown device"

    return f"{browser} on {os_name}"
