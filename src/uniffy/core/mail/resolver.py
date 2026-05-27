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

Caching
-------

Non-secret fields are cached in Valkey under
``mail:cfg:{org_id|"system"}`` for 60 seconds together with the
provenance of the password (``org`` / ``deployment`` / ``env`` /
``none``). The plaintext password is NEVER written to Valkey - on a
cache hit the password is re-resolved from PG (per-org row or
deployment row) through the matching cipher, or read from env. This
preserves the bulk of the PG-avoidance the cache exists for while
keeping decrypted secrets out of shared infra.

Writes through any of the three tiers call
``MailConfigResolver.invalidate`` (org_id for the org tier,
``invalidate_system`` for the deployment tier) so admin edits take
effect immediately.
"""

from __future__ import annotations

import os
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
_PASSWORD_SOURCE_KEY = "_password_source"


def _cache_key(scope: str) -> str:
    return f"mail:cfg:{scope}"


def _cache_tag(scope: str) -> str:
    return f"mail:cfg:scope:{scope}"


def _password_source_for(config: MailConfig) -> str:
    """Map an unresolved ``MailConfig`` to the tier its password lives in.

    Returned values: ``"org"`` / ``"deployment"`` / ``"env"`` / ``"none"``.
    A config with ``smtp_password=None`` records ``"none"`` so the
    cache hit short-circuits the re-resolve.
    """
    if config.smtp_password is None or config.smtp_password == "":
        return "none"
    return config.source


class MailConfigResolver:
    """Per-request resolver. Hold one instance per ``AsyncSession``."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def resolve(self, organization_id: UUID | None) -> MailConfig:
        """Return the effective config for ``organization_id`` or raise."""
        scope = str(organization_id) if organization_id is not None else "system"
        cached = await cache_get(_cache_key(scope))
        if cached is not CACHE_MISS and cached is not None:
            password_source = cached.pop(_PASSWORD_SOURCE_KEY, "none")
            config = MailConfig.model_validate(cached)
            return await self._rehydrate_password(
                config, organization_id, password_source
            )

        config = await self._load(organization_id)
        password_source = _password_source_for(config)
        payload = config.model_dump(mode="json")
        # Plaintext SMTP password must never enter Valkey. Strip it
        # and record where the cache hit should fetch it from.
        payload["smtp_password"] = None
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
        password_source: str,
    ) -> MailConfig:
        """Re-fetch the SMTP password for a cached config or raise.

        ``password_source`` is one of ``"org"``, ``"deployment"``,
        ``"env"``, ``"none"``. When the underlying row no longer exists
        (race with a concurrent edit that has already invalidated the
        cache key in a tight enough window) we fall through to a fresh
        ``_load`` so the caller never sees an inconsistent config.
        """
        if password_source == "none":
            return config
        if password_source == "env":
            env_password = os.getenv("SMTP_PASSWORD") or None
            return config.model_copy(update={"smtp_password": env_password})
        if password_source == "org" and organization_id is not None:
            password = await self._load_org_password(organization_id)
            if password is None:
                return await self._load(organization_id)
            return config.model_copy(update={"smtp_password": password})
        if password_source == "deployment":
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
                    OrgSetting.key == "smtp_password",
                )
            )
        ).scalar_one_or_none()
        if row is None or not row.value_encrypted:
            return None
        return await OrgCipher(self._session).decrypt(
            organization_id, row.value_encrypted
        )

    async def _load_deployment_password(self) -> str | None:
        row = (
            await self._session.execute(
                select(DeploymentSetting).where(
                    DeploymentSetting.namespace == MAIL_NAMESPACE,
                    DeploymentSetting.key == "smtp_password",
                )
            )
        ).scalar_one_or_none()
        if row is None or not row.value_encrypted:
            return None
        return await DeploymentCipher(self._session).decrypt(row.value_encrypted)

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
