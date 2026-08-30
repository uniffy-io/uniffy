"""Resolve the effective ``MailConfig`` for an organization.

Lookup order: per-org ``org_settings`` -> deployment ``deployment_settings`` ->
``MailConfig.from_env()`` -> ``MailNotConfiguredError``.

Non-secret fields are cached in Valkey under ``mail:cfg:{org_id|"system"}`` for
60 seconds with the password's provenance. The plaintext password is NEVER
written to Valkey - on a cache hit it is re-resolved from PG (org or deployment
row) through the matching cipher, or read from env.
"""

from __future__ import annotations

import os
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.cache.operations import (
    CACHE_MISS,
    cache_delete,
    cache_get,
    cache_set,
)
from uniffy.core.crypto import DeploymentCipher, OrgCipher
from uniffy.core.mail.config import (
    MAIL_NAMESPACE,
    MAIL_PASSWORD_KEY,
    MailConfig,
    MailConfigSource,
)
from uniffy.core.mail.errors import MailNotConfiguredError
from uniffy.core.models.settings.deployment_setting import DeploymentSetting
from uniffy.core.models.settings.org_setting import OrgSetting

_CACHE_TTL_SECONDS = 60
_PASSWORD_SOURCE_KEY = "_password_source"


def _cache_key(scope: str) -> str:
    return f"mail:cfg:{scope}"


def _cache_tag(scope: str) -> str:
    return f"mail:cfg:scope:{scope}"


def _password_source_for(config: MailConfig) -> MailConfigSource:
    """Tier the password lives in: ``"org"`` / ``"deployment"`` / ``"env"`` / ``"none"``."""
    if config.smtp_password is None or config.smtp_password == "":
        return MailConfigSource.NONE
    return config.source


class MailConfigResolver:
    """Per-request resolver. One instance per ``AsyncSession``."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def resolve(self, organization_id: UUID | None) -> MailConfig:
        """Effective config for ``organization_id`` or raise."""
        scope = str(organization_id) if organization_id is not None else "system"
        cached = await cache_get(_cache_key(scope))
        if cached is not CACHE_MISS and cached is not None:
            password_source = MailConfigSource(
                cached.pop(_PASSWORD_SOURCE_KEY, MailConfigSource.NONE)
            )
            config = MailConfig.model_validate(cached)
            return await self._rehydrate_password(config, organization_id, password_source)

        config = await self._load(organization_id)
        password_source = _password_source_for(config)
        payload = config.model_dump(mode="json")
        # Plaintext SMTP password must never enter Valkey.
        payload[MAIL_PASSWORD_KEY] = None
        payload[_PASSWORD_SOURCE_KEY] = password_source
        await cache_set(
            _cache_key(scope),
            payload,
            ttl=_CACHE_TTL_SECONDS,
            tags=[_cache_tag(scope)],
        )
        return config

    async def _rehydrate_password(
        self,
        config: MailConfig,
        organization_id: UUID | None,
        password_source: MailConfigSource,
    ) -> MailConfig:
        """Re-fetch the SMTP password for a cached config; fall through to ``_load`` on row miss."""
        if password_source is MailConfigSource.NONE:
            return config
        if password_source is MailConfigSource.ENV:
            env_password = os.getenv("SMTP_PASSWORD") or None
            return config.model_copy(update={"smtp_password": env_password})
        if password_source is MailConfigSource.ORGANIZATION and organization_id is not None:
            password = await self._load_org_password(organization_id)
            if password is None:
                return await self._load(organization_id)
            return config.model_copy(update={"smtp_password": password})
        if password_source is MailConfigSource.DEPLOYMENT:
            password = await self._load_deployment_password()
            if password is None:
                return await self._load(organization_id)
            return config.model_copy(update={"smtp_password": password})
        return config

    async def _load_org_password(self, organization_id: UUID) -> str | None:
        row = (
            await self._session.execute(
                select(OrgSetting).where(
                    OrgSetting.organization_id == organization_id,
                    OrgSetting.namespace == MAIL_NAMESPACE,
                    OrgSetting.key == MAIL_PASSWORD_KEY,
                )
            )
        ).scalar_one_or_none()
        if row is None or not row.value_encrypted:
            return None
        return await OrgCipher(self._session).decrypt(organization_id, row.value_encrypted)

    async def _load_deployment_password(self) -> str | None:
        row = (
            await self._session.execute(
                select(DeploymentSetting).where(
                    DeploymentSetting.namespace == MAIL_NAMESPACE,
                    DeploymentSetting.key == MAIL_PASSWORD_KEY,
                )
            )
        ).scalar_one_or_none()
        if row is None or not row.value_encrypted:
            return None
        return await DeploymentCipher(self._session).decrypt(row.value_encrypted)

    async def _load(self, organization_id: UUID | None) -> MailConfig:
        if organization_id is not None:
            rows = (
                (
                    await self._session.execute(
                        select(OrgSetting).where(
                            OrgSetting.organization_id == organization_id,
                            OrgSetting.namespace == MAIL_NAMESPACE,
                        )
                    )
                )
                .scalars()
                .all()
            )
            if rows:
                cipher = OrgCipher(self._session)

                async def _decrypt(ciphertext: str) -> str:
                    return await cipher.decrypt(organization_id, ciphertext)

                settings_map = {row.key: row for row in rows}
                config = await MailConfig.from_org_settings(settings_map, _decrypt)
                if config is not None:
                    return config

        deployment_rows = (
            (
                await self._session.execute(
                    select(DeploymentSetting).where(DeploymentSetting.namespace == MAIL_NAMESPACE)
                )
            )
            .scalars()
            .all()
        )
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
        """Drop the cached org entry. Call after every org-tier mail-settings write."""
        scope = str(organization_id) if organization_id is not None else "system"
        await cache_delete(_cache_key(scope))

    @staticmethod
    async def invalidate_system() -> None:
        """Drop the cached ``"system"`` entry. Per-org entries expire within
        ``_CACHE_TTL_SECONDS``.
        """
        await cache_delete(_cache_key("system"))


__all__ = ["MailConfigResolver"]
