"""The read-only asset cookie: config resolved from env, built here, set by the auth handlers.

Env tier only - cookie transport is a deployment property, not a per-tenant one. Knobs:
``ASSET_COOKIE_SECURE`` (default on outside development; off for plain-http LAN self-host),
``ASSET_COOKIE_SAMESITE`` (``Strict``), ``ASSET_COOKIE_NAME`` (``uniffy_asset``),
``ASSET_COOKIE_PATH`` (``/api``), ``ASSET_COOKIE_TTL_MINUTES`` (clamped in ``tokens.py``).
"""

import os
from dataclasses import dataclass

from uniffy.domains.auth.tokens import get_asset_token_expire_minutes


@dataclass(frozen=True)
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
    return os.getenv("ENVIRONMENT", "development").lower() != "development"


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
