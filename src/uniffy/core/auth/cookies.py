"""Configuration and issuance for the read-only asset cookie."""

import os
from dataclasses import dataclass
from uuid import UUID

from connectrpc.request import RequestContext

from uniffy.core.auth.tokens import (
    create_asset_read_token,
    decode_token_unsafe,
    get_asset_token_expire_minutes,
)


@dataclass(frozen=True, slots=True)
class AssetCookieConfig:
    name: str
    secure: bool
    samesite: str
    path: str
    max_age: int


def _secure_enabled() -> bool:
    override = os.getenv("ASSET_COOKIE_SECURE")
    if override is not None:
        return override.strip().lower() in ("1", "true", "yes", "on")
    return os.getenv("ENVIRONMENT", "development").lower() != "development"  # noqa: PLR2004


def resolve_asset_cookie_config() -> AssetCookieConfig:
    secure = _secure_enabled()
    base = os.getenv("ASSET_COOKIE_NAME", "uniffy_asset")
    # The __Secure- prefix is only honoured by browsers when the Secure attribute is set, so it is
    # dropped on plain-http self-host deploys (where Secure cookies would never be stored anyway).
    name = f"__Secure-{base}" if secure else base
    return AssetCookieConfig(
        name=name,
        secure=secure,
        samesite=os.getenv("ASSET_COOKIE_SAMESITE", "Strict"),
        path=os.getenv("ASSET_COOKIE_PATH", "/api"),
        max_age=get_asset_token_expire_minutes() * 60,
    )


def build_set_cookie(config: AssetCookieConfig, token: str) -> str:
    parts = [
        f"{config.name}={token}",
        f"Path={config.path}",
        f"Max-Age={config.max_age}",
        "HttpOnly",
        f"SameSite={config.samesite}",
    ]
    if config.secure:
        parts.append("Secure")
    return "; ".join(parts)


def attach_asset_cookie(
    ctx: RequestContext,
    *,
    access_token: str,
    user_id: UUID,
    organization_id: UUID | None,
    session_id: UUID | None,
) -> str:
    """Carry the access token's revocation watermark into the asset credential."""
    tkv = decode_token_unsafe(access_token).get("tkv")
    token = create_asset_read_token(
        user_id=user_id,
        organization_id=organization_id,
        token_version=tkv,
        session_id=session_id,
    )
    config = resolve_asset_cookie_config()
    ctx.response_headers().add("set-cookie", build_set_cookie(config, token))
    return f"{config.name}={token}"


def build_clear_cookie(config: AssetCookieConfig) -> str:
    parts = [
        f"{config.name}=",
        f"Path={config.path}",
        "Max-Age=0",
        "HttpOnly",
        f"SameSite={config.samesite}",
    ]
    if config.secure:
        parts.append("Secure")
    return "; ".join(parts)
