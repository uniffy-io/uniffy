"""Resolved SMTP configuration. One instance describes either the env default
or a per-org override.

Recognised ``mail.*`` keys (``from_address`` and ``smtp_host`` required, the rest optional):
``from_name``, ``reply_to``, ``smtp_port`` (587), ``smtp_username``, ``smtp_password``
(``is_secret=true``), ``smtp_use_tls`` (true), ``rate_limit_per_min`` (100).
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from typing import Any, Literal

from pydantic import BaseModel

MAIL_NAMESPACE = "mail"

SECRET_KEYS: frozenset[str] = frozenset({"smtp_password"})


class MailConfig(BaseModel):
    """SMTP delivery configuration plus envelope metadata."""

    from_address: str
    from_name: str = "Uniffy"
    reply_to: str | None = None
    smtp_host: str
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool = True
    rate_limit_per_min: int = 100
    source: Literal["env", "deployment", "org"] = "env"

    @classmethod
    def from_env(cls) -> MailConfig | None:
        """System-default config from env. Returns ``None`` when
        ``MAIL_FROM_ADDRESS``/``SMTP_HOST`` are unset so dev boots without mail.
        """
        from_address = os.getenv("MAIL_FROM_ADDRESS")
        smtp_host = os.getenv("SMTP_HOST")
        if not from_address or not smtp_host:
            return None
        return cls(
            from_address=from_address,
            from_name=os.getenv("MAIL_FROM_NAME", "Uniffy"),
            reply_to=os.getenv("MAIL_REPLY_TO") or None,
            smtp_host=smtp_host,
            smtp_port=int(os.getenv("SMTP_PORT", "587")),
            smtp_username=os.getenv("SMTP_USERNAME") or None,
            smtp_password=os.getenv("SMTP_PASSWORD") or None,
            smtp_use_tls=os.getenv("SMTP_USE_TLS", "true").lower() in ("1", "true", "yes"),
            rate_limit_per_min=int(os.getenv("MAIL_RATE_LIMIT_PER_MIN", "100")),
            source="env",
        )

    @classmethod
    async def from_deployment_settings(
        cls,
        settings: dict[str, OrgSettingRow],
        decryptor: Callable[[str], Awaitable[str]],
    ) -> MailConfig | None:
        """Deployment-scope config from ``deployment_settings`` rows;
        decryptor is :class:`DeploymentCipher`.
        """
        from_address = _plain(settings.get("from_address"))
        smtp_host = _plain(settings.get("smtp_host"))
        if not from_address or not smtp_host:
            return None

        password: str | None = None
        password_row = settings.get("smtp_password")
        if password_row is not None and password_row.value_encrypted:
            password = await decryptor(password_row.value_encrypted)

        return cls(
            from_address=str(from_address),
            from_name=str(_plain(settings.get("from_name")) or "Uniffy"),
            reply_to=_str_or_none(_plain(settings.get("reply_to"))),
            smtp_host=str(smtp_host),
            smtp_port=int(_plain(settings.get("smtp_port")) or 587),
            smtp_username=_str_or_none(_plain(settings.get("smtp_username"))),
            smtp_password=password,
            smtp_use_tls=_bool(_plain(settings.get("smtp_use_tls")), default=True),
            rate_limit_per_min=int(_plain(settings.get("rate_limit_per_min")) or 100),
            source="deployment",
        )

    @classmethod
    async def from_org_settings(
        cls,
        settings: dict[str, OrgSettingRow],
        decryptor: Callable[[str], Awaitable[str]],
    ) -> MailConfig | None:
        """Per-org config from ``org_settings`` rows; ``decryptor`` is
        typically a closure over ``OrgCipher.decrypt``.
        """
        from_address = _plain(settings.get("from_address"))
        smtp_host = _plain(settings.get("smtp_host"))
        if not from_address or not smtp_host:
            return None

        password: str | None = None
        password_row = settings.get("smtp_password")
        if password_row is not None and password_row.value_encrypted:
            password = await decryptor(password_row.value_encrypted)

        return cls(
            from_address=str(from_address),
            from_name=str(_plain(settings.get("from_name")) or "Uniffy"),
            reply_to=_str_or_none(_plain(settings.get("reply_to"))),
            smtp_host=str(smtp_host),
            smtp_port=int(_plain(settings.get("smtp_port")) or 587),
            smtp_username=_str_or_none(_plain(settings.get("smtp_username"))),
            smtp_password=password,
            smtp_use_tls=_bool(_plain(settings.get("smtp_use_tls")), default=True),
            rate_limit_per_min=int(_plain(settings.get("rate_limit_per_min")) or 100),
            source="org",
        )


class OrgSettingRow:
    """Minimal protocol for ``OrgSetting`` rows fed into ``from_org_settings``."""

    value: Any
    value_encrypted: str | None
    is_secret: bool


def _plain(row: OrgSettingRow | None) -> Any:
    """Plain JSON value of a row, ``None`` if absent or secret."""
    if row is None or row.is_secret:
        return None
    return row.value


def _str_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text or None


def _bool(value: Any, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, str):
        return value.lower() in ("1", "true", "yes")
    return bool(value)
