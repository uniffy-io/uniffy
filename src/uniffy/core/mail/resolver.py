"""Resolve the effective ``MailConfig`` for a given organization.

Lookup order:

1. ``org_settings`` rows for ``organization_id`` under
   ``namespace='mail'``. If the assembled config satisfies the
   required keys (``from_address`` + ``smtp_host``), use it.
2. ``MailConfig.from_env()`` (system env default).
3. ``MailNotConfiguredError``.

Resolved configs are cached in Valkey under ``mail:cfg:{org_id|"system"}``
for 60 seconds. Decrypted SMTP passwords therefore land in Valkey under
that key for the cache lifetime -- the trade-off is throughput vs blast
radius (deliberate; see plan). Writes through the org-settings ops call
``MailConfigResolver.invalidate(org_id)`` so admin edits take effect
immediately.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto import OrgCipher
from uniffy.core.mail.config import MAIL_NAMESPACE, MailConfig
from uniffy.core.mail.errors import MailNotConfiguredError
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.core.valkey.cache import (
    CACHE_MISS,
    cache_delete,
    cache_get,
    cache_set,
)

_CACHE_TTL_SECONDS = 60


def _cache_key(scope: str) -> str:
    return f"mail:cfg:{scope}"


def _cache_tag(scope: str) -> str:
    return f"mail:cfg:scope:{scope}"


class MailConfigResolver:
    """Per-request resolver. Hold one instance per ``AsyncSession``."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def resolve(self, organization_id: UUID | None) -> MailConfig:
        """Return the effective config for ``organization_id`` or raise."""
        scope = str(organization_id) if organization_id is not None else "system"
        cached = await cache_get(_cache_key(scope))
        if cached is not CACHE_MISS and cached is not None:
            return MailConfig.model_validate(cached)

        config = await self._load(organization_id)
        await cache_set(
            _cache_key(scope),
            config.model_dump(mode="json"),
            ttl=_CACHE_TTL_SECONDS,
            tags=[_cache_tag(scope)],
        )
        return config

    async def _load(self, organization_id: UUID | None) -> MailConfig:
        if organization_id is not None:
            rows = (
                await self._session.execute(
                    select(OrgSetting).where(
                        OrgSetting.organization_id == organization_id,
                        OrgSetting.namespace == MAIL_NAMESPACE,
                    )
                )
            ).scalars().all()
            if rows:
                cipher = OrgCipher(self._session)

                async def _decrypt(ciphertext: str) -> str:
                    return await cipher.decrypt(organization_id, ciphertext)

                settings_map = {row.key: row for row in rows}
                config = await MailConfig.from_org_settings(settings_map, _decrypt)
                if config is not None:
                    return config

        env_config = MailConfig.from_env()
        if env_config is None:
            raise MailNotConfiguredError(
                "No org_settings mail rows and no MAIL_FROM_ADDRESS / SMTP_HOST in env",
                details={
                    "organization_id": str(organization_id) if organization_id else None,
                },
            )
        return env_config

    @staticmethod
    async def invalidate(organization_id: UUID | None) -> None:
        """Drop the cached entry so the next resolve hits the DB.

        Call after every write to ``org_settings`` under the ``mail``
        namespace so the new value is visible cluster-wide within one
        Valkey round-trip.
        """
        scope = str(organization_id) if organization_id is not None else "system"
        await cache_delete(_cache_key(scope))


__all__ = ["MailConfigResolver"]
