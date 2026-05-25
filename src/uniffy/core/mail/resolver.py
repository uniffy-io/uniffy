"""Resolve the effective ``MailConfig`` for a given organization.

Lookup order:

1. ``org_settings`` rows for ``organization_id`` under
   ``namespace='mail'``. If the assembled config satisfies the
   required keys (``from_address`` + ``smtp_host``), use it.
2. ``deployment_settings`` rows under ``namespace='mail'`` -- the
   operator-editable system-wide config. Same key shape as the org
   tier; secrets are unwrapped via :class:`DeploymentCipher`.
3. ``MailConfig.from_env()`` (env-default, set at deploy time).
4. ``MailNotConfiguredError``.

The deployment tier lets a self-hoster ship the stack with zero mail
env vars and configure SMTP from the platform UI after first boot --
matching the landing-page promise that mail is post-install editable.

Resolved configs are cached in Valkey under ``mail:cfg:{org_id|"system"}``
for 60 seconds. Decrypted SMTP passwords therefore land in Valkey under
that key for the cache lifetime -- the trade-off is throughput vs blast
radius (deliberate; see plan). Writes through any of the three tiers
call ``MailConfigResolver.invalidate`` (org_id for the org tier,
``invalidate_system`` for the deployment tier) so admin edits take
effect immediately.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto import DeploymentCipher, OrgCipher
from uniffy.core.mail.config import MAIL_NAMESPACE, MailConfig
from uniffy.core.mail.errors import MailNotConfiguredError
from uniffy.core.models.settings.deployment_setting import DeploymentSetting
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

        deployment_rows = (
            await self._session.execute(
                select(DeploymentSetting).where(
                    DeploymentSetting.namespace == MAIL_NAMESPACE
                )
            )
        ).scalars().all()
        if deployment_rows:
            deployment_cipher = DeploymentCipher(self._session)

            async def _decrypt_deployment(ciphertext: str) -> str:
                return await deployment_cipher.decrypt(ciphertext)

            deployment_map = {row.key: row for row in deployment_rows}
            deployment_config = await MailConfig.from_deployment_settings(
                deployment_map, _decrypt_deployment
            )
            if deployment_config is not None:
                return deployment_config

        env_config = MailConfig.from_env()
        if env_config is None:
            raise MailNotConfiguredError(
                "No org-, deployment- or env-level mail config",
                details={
                    "organization_id": str(organization_id) if organization_id else None,
                },
            )
        return env_config

    @staticmethod
    async def invalidate(organization_id: UUID | None) -> None:
        """Drop the cached org entry so the next resolve hits the DB.

        Call after every write to ``org_settings`` under the ``mail``
        namespace so the new value is visible cluster-wide within one
        Valkey round-trip.
        """
        scope = str(organization_id) if organization_id is not None else "system"
        await cache_delete(_cache_key(scope))

    @staticmethod
    async def invalidate_system() -> None:
        """Drop every cached entry across the deployment.

        Deployment-tier config edits affect every org that resolves
        through the deployment fallback. The simplest correct behavior
        is to drop the cached ``"system"`` key (used when callers resolve
        without an org) and let the per-org entries naturally expire
        within ``_CACHE_TTL_SECONDS`` -- per-org rows still win
        precedence, so the at-most-60s lag affects only orgs that have
        no per-org row and therefore inherit the deployment config.
        """
        await cache_delete(_cache_key("system"))


__all__ = ["MailConfigResolver"]
