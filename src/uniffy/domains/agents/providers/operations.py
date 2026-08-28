"""LLM provider key operations."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.crypto import OrgCipher, ReEncryptingConsumer, register_consumer
from uniffy.core.errors import ConflictError, NotFoundError, ValidationError
from uniffy.core.models.agents.provider_key import ProviderKey
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.domains.agents.cache import publish_provider_key_invalidation
from uniffy.domains.agents.providers.base import LLMProvider, ModelInfo
from uniffy.domains.agents.providers.catalog import provider_for_model
from uniffy.domains.agents.providers.clients import (
    get_provider_lru,
    record_lru_hit,
    record_lru_miss,
)
from uniffy.domains.agents.providers.registry import get_provider_registry
from uniffy.domains.agents.providers.utils import build_key_hint
from uniffy.domains.organizations.operations import OrganizationOperations

logger = logger.bind(component="agents.providers.operations")


class ProviderOperations:
    """Operations for managing LLM provider credentials."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialize provider operations."""
        self._session = session
        self._org_ops = OrganizationOperations(session)
        self._org_cipher = OrgCipher(session)

    async def add_key(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        provider: str,
        label: str,
        credential: str,
    ) -> ProviderKey:
        """Add a new provider key (encrypted at rest).

        The pasted credential is never format-checked: the only signal we
        trust is the live probe below, which asks the provider for its
        model list and records the failure on the row.
        """
        await self._org_ops.require_org_admin(user_id, organization_id)

        if not label or not label.strip():
            raise ValidationError("label", "Label cannot be empty")
        label = label.strip()

        credential = credential.strip()
        if not credential:
            raise ValidationError("credential", "Credential cannot be empty")
        get_provider_registry().require_known(provider)

        existing = await self._session.execute(
            select(ProviderKey).where(
                ProviderKey.organization_id == organization_id,
                ProviderKey.provider == provider,
                ProviderKey.label == label,
            )
        )
        if existing.scalar_one_or_none():
            raise ConflictError(
                "ProviderKey",
                f"A key with label '{label}' already exists for provider '{provider}'",
            )

        encrypted = await self._org_cipher.encrypt(organization_id, credential)
        hint = build_key_hint(credential)

        key = ProviderKey(
            organization_id=organization_id,
            provider=provider,
            label=label,
            encrypted_credential=encrypted,
            key_hint=hint,
            is_valid=True,
            created_by=user_id,
        )
        self._session.add(key)

        try:
            llm = get_provider_registry().create_provider(provider, credential)
            is_valid, error = await llm.validate()
            key.is_valid = is_valid
            key.last_validated_at = datetime.now(UTC)
            if error:
                key.last_error = error
        except Exception as e:
            key.is_valid = False
            key.last_validated_at = datetime.now(UTC)
            key.last_error = str(e)

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.AGENT_PROVIDER_KEY_ADDED,
            resource_type=AuditResourceType.PROVIDER_KEY,
            resource_id=key.id,
            details={
                "provider": provider,
                "label": label,
                "key_hint": key.key_hint,
            },
        )
        try:
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            raise
        await self._session.refresh(key)

        try:
            await publish_provider_key_invalidation(key.id)
        except Exception:
            logger.opt(exception=True).warning(
                "Provider key created with stale cache state",
                key_id=str(key.id),
            )

        return key

    async def list_keys(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        provider: str | None = None,
    ) -> list[ProviderKey]:
        """List the org's provider keys.

        Keys are org-wide and admin-managed; every member can read the list
        because the chat model pickers need it.
        """
        await self._org_ops.require_org_member(user_id, organization_id)

        stmt = select(ProviderKey).where(ProviderKey.organization_id == organization_id)
        if provider:
            stmt = stmt.where(ProviderKey.provider == provider)
        stmt = stmt.order_by(ProviderKey.created_at)

        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def remove_key(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        key_id: UUID,
    ) -> None:
        """Remove a provider key."""
        result = await self._session.execute(
            select(ProviderKey).where(
                ProviderKey.id == key_id,
                ProviderKey.organization_id == organization_id,
            )
        )
        key = result.scalar_one_or_none()
        if not key:
            raise NotFoundError("ProviderKey", str(key_id))

        await self._org_ops.require_org_admin(user_id, organization_id)

        key_label = key.label
        key_provider = key.provider
        await self._session.delete(key)
        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.AGENT_PROVIDER_KEY_DELETED,
            resource_type=AuditResourceType.PROVIDER_KEY,
            resource_id=key_id,
            details={"provider": key_provider, "label": key_label},
        )
        await self._session.commit()

        await publish_provider_key_invalidation(key_id)

    async def validate_key(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        key_id: UUID,
    ) -> tuple[bool, str | None]:
        """Validate a stored provider key against the provider API."""
        await self._org_ops.require_org_admin(user_id, organization_id)

        result = await self._session.execute(
            select(ProviderKey).where(
                ProviderKey.id == key_id,
                ProviderKey.organization_id == organization_id,
            )
        )
        key = result.scalar_one_or_none()
        if not key:
            raise NotFoundError("ProviderKey", str(key_id))

        credential = await self._org_cipher.decrypt(key.organization_id, key.encrypted_credential)
        llm = get_provider_registry().create_provider(key.provider, credential)
        is_valid, error = await llm.validate()

        key.is_valid = is_valid
        key.last_validated_at = datetime.now(UTC)
        key.last_error = error
        key.updated_at = datetime.now(UTC)

        await self._session.commit()
        await publish_provider_key_invalidation(key_id)
        return is_valid, error

    async def list_available_models(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        provider: str | None = None,
    ) -> list[ModelInfo]:
        """List models exposed by all valid, enabled keys in the org.

        The model list is a projection of the local catalog keyed by PROVIDER,
        so this path reads the provider column only: no credential decrypt, no
        SDK client, no provider round trip. Model pickers hit it on every chat
        and builder surface, so it stays a single indexed SELECT.
        """
        await self._org_ops.require_org_member(user_id, organization_id)

        stmt = (
            select(ProviderKey.provider)
            .where(
                ProviderKey.organization_id == organization_id,
                ProviderKey.is_valid == True,  # noqa: E712
                ProviderKey.is_enabled == True,  # noqa: E712
            )
            .distinct()
            .order_by(ProviderKey.provider)
        )
        if provider:
            stmt = stmt.where(ProviderKey.provider == provider)

        result = await self._session.execute(stmt)
        registry = get_provider_registry()
        models: list[ModelInfo] = []
        for provider_name in result.scalars().all():
            models.extend(registry.get_models_for_provider(provider_name))

        return models

    async def get_active_provider(
        self,
        *,
        organization_id: UUID,
        provider: str = "anthropic",
    ) -> LLMProvider:
        """Return a configured LLM provider for the org."""
        result = await self._session.execute(
            select(ProviderKey)
            .where(
                ProviderKey.organization_id == organization_id,
                ProviderKey.provider == provider,
                ProviderKey.is_valid == True,  # noqa: E712
                ProviderKey.is_enabled == True,  # noqa: E712
            )
            .order_by(ProviderKey.created_at)
        )
        key = result.scalars().first()
        if not key:
            raise NotFoundError(
                "ProviderKey",
                f"No valid {provider} key configured for this organization",
            )

        credential = await self._org_cipher.decrypt(key.organization_id, key.encrypted_credential)

        key.last_used_at = datetime.now(UTC)
        await self._session.commit()

        return get_provider_registry().create_provider(provider, credential)

    async def _get_key_for_model(
        self,
        organization_id: UUID,
        model_id: str,
    ) -> tuple[LLMProvider, ProviderKey] | None:
        """Resolve ``model_id`` to (client, key) via the catalog, or ``None``.

        The catalog owns model->provider routing, so we map the model to its
        provider and pick the org's oldest enabled key for that provider - no
        live model-list lookup. The LRU reuses the decrypted credential and
        warm httpx pool across calls.
        """
        provider_name = provider_for_model(model_id)
        if provider_name is None:
            return None

        result = await self._session.execute(
            select(ProviderKey)
            .where(
                ProviderKey.organization_id == organization_id,
                ProviderKey.provider == provider_name,
                ProviderKey.is_valid == True,  # noqa: E712
                ProviderKey.is_enabled == True,  # noqa: E712
            )
            .order_by(ProviderKey.created_at)
        )
        key = result.scalars().first()
        if key is None:
            return None

        llm = await self._resolve_or_build_provider(get_provider_lru(), key, get_provider_registry())
        key.last_used_at = datetime.now(UTC)
        await self._session.commit()
        return llm, key

    async def get_provider_for_model(
        self,
        *,
        organization_id: UUID,
        model_id: str,
    ) -> LLMProvider:
        """Return a provider client for the key that serves ``model_id``."""
        resolved = await self._get_key_for_model(organization_id, model_id)
        if resolved is None:
            raise NotFoundError(
                "ProviderKey",
                f"No enabled provider key serves model '{model_id}'",
            )
        llm, _key = resolved
        return llm

    async def _resolve_or_build_provider(
        self,
        lru,
        key: ProviderKey,
        registry,
    ) -> LLMProvider:
        """LRU-aware provider construction.

        On hit: skip the Fernet decrypt and the SDK constructor, return
        the cached client. On miss: decrypt, construct, populate cache.
        """
        cached = await lru.get(key.id)
        if cached is not None:
            record_lru_hit()
            _credential, provider = cached
            return provider

        record_lru_miss()
        credential = await self._org_cipher.decrypt(key.organization_id, key.encrypted_credential)
        provider = registry.create_provider(key.provider, credential)
        await lru.set(key.id, credential, provider)
        return provider

    async def get_provider_for_key(
        self,
        *,
        organization_id: UUID,
        key_id: UUID,
    ) -> tuple[LLMProvider, ProviderKey]:
        """Return a configured provider for a specific key.

        The encrypted credential lives in PG so the row SELECT is still
        required (also drives ``last_used_at`` tracking). The in-process
        LRU short-circuits the Fernet decrypt and the SDK construction
        once the key has been seen this hour.
        """
        result = await self._session.execute(
            select(ProviderKey).where(
                ProviderKey.id == key_id,
                ProviderKey.organization_id == organization_id,
                ProviderKey.is_valid == True,  # noqa: E712
                ProviderKey.is_enabled == True,  # noqa: E712
            )
        )
        key = result.scalar_one_or_none()
        if not key:
            raise NotFoundError(
                "ProviderKey",
                f"Provider key '{key_id}' not found, invalid, or disabled",
            )

        provider = await self._resolve_or_build_provider(
            get_provider_lru(), key, get_provider_registry()
        )
        key.last_used_at = datetime.now(UTC)
        await self._session.commit()

        return provider, key

    async def list_enabled_keys_for_provider(
        self,
        *,
        organization_id: UUID,
        provider: str,
    ) -> list[ProviderKey]:
        """Return every enabled, valid key for a single provider, oldest first.

        Used by the failover candidate iterator so it can swap to a
        sibling credential without re-walking the heterogeneous key
        list.
        """
        result = await self._session.execute(
            select(ProviderKey)
            .where(
                ProviderKey.organization_id == organization_id,
                ProviderKey.provider == provider,
                ProviderKey.is_valid == True,  # noqa: E712
                ProviderKey.is_enabled == True,  # noqa: E712
            )
            .order_by(ProviderKey.created_at)
        )
        return list(result.scalars().all())

    async def get_key_and_provider_for_model(
        self,
        *,
        organization_id: UUID,
        model_id: str,
    ) -> tuple[LLMProvider, ProviderKey] | None:
        """Resolve ``model_id`` to its (provider client, key row), or ``None``.

        Like ``get_provider_for_model`` but also returns the ``ProviderKey`` so
        callers (failover loop, run-log writer) can track which credential is
        active. Routing is catalog-driven.
        """
        return await self._get_key_for_model(organization_id, model_id)

    async def list_models_for_key(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        key_id: UUID,
    ) -> list[ModelInfo]:
        """List models exposed by a specific provider key.

        Catalog-driven like ``list_available_models``: only the key's provider
        column decides the list, so the credential stays encrypted at rest.
        """
        await self._org_ops.require_org_member(user_id, organization_id)

        result = await self._session.execute(
            select(ProviderKey.provider).where(
                ProviderKey.id == key_id,
                ProviderKey.organization_id == organization_id,
            )
        )
        provider = result.scalar_one_or_none()
        if not provider:
            raise NotFoundError("ProviderKey", str(key_id))

        return get_provider_registry().get_models_for_provider(provider)

    async def toggle_key(
        self,
        user_id: UUID,
        organization_id: UUID,
        key_id: UUID,
        enabled: bool,
    ) -> ProviderKey:
        """Enable or disable a provider key."""
        result = await self._session.execute(
            select(ProviderKey).where(
                ProviderKey.id == key_id,
                ProviderKey.organization_id == organization_id,
            )
        )
        key = result.scalar_one_or_none()
        if not key:
            raise NotFoundError("ProviderKey", str(key_id))

        await self._org_ops.require_org_admin(user_id, organization_id)

        key.is_enabled = enabled
        key.updated_at = datetime.now(UTC)
        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.AGENT_PROVIDER_KEY_TOGGLED,
            resource_type=AuditResourceType.PROVIDER_KEY,
            resource_id=key_id,
            details={"enabled": enabled},
        )
        await self._session.commit()
        await self._session.refresh(key)
        await publish_provider_key_invalidation(key_id)
        return key


async def _list_provider_keys_for_org(
    session: AsyncSession,
    organization_id: UUID,
):
    """Yield every ``ProviderKey`` row owned by an organization.

    Used by per-org DEK rotation to re-encrypt each row under the fresh
    DEK. Rows are yielded one-at-a-time so the rotation loop can commit
    in batches without holding every row in memory.
    """
    result = await session.execute(
        select(ProviderKey).where(ProviderKey.organization_id == organization_id)
    )
    for row in result.scalars():
        yield row


def _provider_key_set_ciphertext(row: ProviderKey, ciphertext: str) -> None:
    row.encrypted_credential = ciphertext


register_consumer(
    ReEncryptingConsumer(
        name="agents_provider_keys",
        table_name="agents_provider_keys",
        list_rows=_list_provider_keys_for_org,
        get_ciphertext=lambda row: row.encrypted_credential,
        set_ciphertext=_provider_key_set_ciphertext,
    )
)
