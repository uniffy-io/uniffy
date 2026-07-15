"""Authentication context utilities for extracting user info from requests."""

import re
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uniffy.domains.auth.tokens import decode_access_token

logger = logger.bind(component="auth.context")


def get_user_id_from_context(ctx: RequestContext) -> UUID:
    """Extract user ID from an access-token bearer header.

    ``decode_access_token`` enforces ``type == "access"`` so refresh /
    mfa_challenge / enrollment_only tokens are rejected at the decoder
    rather than slipping through. Revocation is enforced once per RPC
    by ``AuthRevocationInterceptor``.
    """
    headers = ctx.request_headers()
    auth_header = headers.get("authorization", "")

    if not auth_header.startswith("Bearer "):
        raise ConnectError(
            Code.UNAUTHENTICATED,
            "Missing or invalid authorization header",
        )

    token = auth_header[7:]

    try:
        payload = decode_access_token(token)
        return UUID(payload["sub"])
    except Exception as e:
        logger.error(f"JWT decode error: {e}")
        raise ConnectError(Code.UNAUTHENTICATED, f"Invalid or expired token: {e}")


def get_user_id_from_enrollment_context(ctx: RequestContext) -> UUID:
    """Extract user ID from an MFA enrollment-only bearer token."""
    from uniffy.domains.auth.mfa.challenge import decode_enrollment_only_token

    headers = ctx.request_headers()
    auth_header = headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise ConnectError(
            Code.UNAUTHENTICATED,
            "Missing or invalid authorization header",
        )
    token = auth_header[7:]
    try:
        payload = decode_enrollment_only_token(token)
        return UUID(payload["sub"])
    except Exception as e:
        logger.debug(f"Enrollment token decode error: {e}")
        raise ConnectError(
            Code.UNAUTHENTICATED, "Invalid or expired enrollment token"
        )


def get_organization_id_from_enrollment_context(
    ctx: RequestContext,
) -> UUID | None:
    """Return the pending org carried in the enrollment-only token, if any."""
    from uniffy.domains.auth.mfa.challenge import decode_enrollment_only_token

    headers = ctx.request_headers()
    auth_header = headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    try:
        payload = decode_enrollment_only_token(token)
        org_id = payload.get("org_id")
        return UUID(org_id) if org_id else None
    except Exception:
        return None


def get_sender_info_from_context(ctx: RequestContext) -> tuple[str, str]:
    """Return `(full_name, avatar_key)` from JWT claims; empties when absent."""
    headers = ctx.request_headers()
    auth_header = headers.get("authorization", "")

    if not auth_header.startswith("Bearer "):
        return ("", "")

    token = auth_header[7:]

    try:
        payload = decode_access_token(token)
        return (payload.get("name", ""), payload.get("avk", ""))
    except Exception:
        return ("", "")


def get_organization_id_from_context(ctx: RequestContext) -> UUID | None:
    """Extract organization ID from the JWT, or None when absent."""
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
    """Extract session ID from the access token, or None when absent."""
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
    """Return the User-Agent header, or an empty string."""
    headers = ctx.request_headers()
    return headers.get("user-agent", "")


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

# Native app clients (the Uniffy mobile app) present no browser token, so the
# generic browser/OS pass below cannot label them. They send an explicit
# "Uniffy/<ver> (<platform> <ver>)" agent; match the platform inside the parens.
_APP_CLIENT_PATTERNS = [
    (re.compile(r"Uniffy/[\d.]+\s*\(\s*(?:iOS|iPadOS|iPhone|iPad|iPod)", re.I), "Uniffy for iOS"),
    (re.compile(r"Uniffy/[\d.]+\s*\(\s*Android", re.I), "Uniffy for Android"),
    (re.compile(r"Uniffy/[\d.]+", re.I), "Uniffy app"),
]


def parse_device_label(user_agent: str) -> str:
    """Parse a User-Agent into a label like "Chrome on macOS"."""
    if not user_agent:
        return "Unknown device"

    for pattern, label in _APP_CLIENT_PATTERNS:
        if pattern.search(user_agent):
            return label

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
