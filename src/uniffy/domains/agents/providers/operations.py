"""LLM provider key operations."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.permissions import resolve_access_policy
from uniffy.core.content.members import register_content_loader
from uniffy.core.crypto import decrypt_value, encrypt_value
from uniffy.core.errors import ConflictError, NotFoundError, ValidationError
from uniffy.core.llm_providers.cache import (
    get_provider_lru,
    record_lru_hit,
    record_lru_miss,
)
from uniffy.core.models.agents.provider_key import ProviderKey
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    SubjectType,
)
from uniffy.domains.agents.cache import (
    get_cached_provider_metadata,
    invalidate_provider_metadata,
    set_cached_provider_metadata,
)
from uniffy.domains.agents.providers.base import LLMProvider, ModelInfo
from uniffy.domains.agents.providers.registry import get_provider_registry
from uniffy.domains.agents.providers.utils import build_key_hint
from uniffy.domains.organizations.operations import OrganizationOperations


class ProviderOperations:
    """Operations for managing LLM provider credentials."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialize provider operations."""
        self._session = session
        self._org_ops = OrganizationOperations(session)

    async def add_key(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        provider: str,
        credential_type: str,
        label: str,
        credential: str,
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
    ) -> ProviderKey:
        """Add a new provider key (encrypted at rest)."""
        access_mode, baseline_role = await resolve_access_policy(
            self._session,
            organization_id,
            ContentType.PROVIDER_KEY,
            access_mode,
            baseline_role,
        )

        if access_mode == AccessMode.OWNER_ONLY:
            await self._org_ops.require_org_member(user_id, organization_id)
        else:
            await self._org_ops.require_org_admin(user_id, organization_id)

        if not label or not label.strip():
            raise ValidationError("label", "Label cannot be empty")
        label = label.strip()

        credential = credential.strip()
        get_provider_registry().validate_credential(provider, credential, credential_type)

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

        encrypted = encrypt_value(credential)
        hint = build_key_hint(credential)

        key = ProviderKey(
            organization_id=organization_id,
            provider=provider,
            credential_type=credential_type,
            label=label,
            encrypted_credential=encrypted,
            key_hint=hint,
            is_valid=True,
            access_mode=access_mode,
            baseline_role=baseline_role,
            created_by=user_id,
        )
        self._session.add(key)

        try:
            llm = get_provider_registry().create_provider(provider, credential, credential_type)
            is_valid, error = await llm.validate()
            key.is_valid = is_valid
            key.last_validated_at = datetime.now(UTC)
            if error:
                key.last_error = error
        except Exception as e:
            key.is_valid = False
            key.last_validated_at = datetime.now(UTC)
            key.last_error = str(e)

        await self._session.commit()
        await self._session.refresh(key)

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.AGENT_PROVIDER_KEY_ADDED,
            resource_type="provider_key",
            resource_id=key.id,
            details={
                "provider": provider,
                "credential_type": credential_type,
                "label": label,
                "key_hint": key.key_hint,
            },
        )
        await self._session.commit()

        await invalidate_provider_metadata(key.id)

        return key

    async def list_keys(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        provider: str | None = None,
    ) -> list[ProviderKey]:
        """List provider keys visible to the user.

        A user can see a key when any of the following holds:
        - The key is ``OPEN_TO_ORG`` (visible to every org member).
        - The user created the key (``created_by == user_id``).
        - The user has an explicit non-blocked ``ContentMember`` row on
          the key (directly, or via a group membership).
        """
        await self._org_ops.require_org_member(user_id, organization_id)

        now = datetime.now(UTC)
        user_groups_subq = select(GroupMember.group_id).where(
            GroupMember.user_id == user_id,
            GroupMember.is_active == True,  # noqa: E712
        )
        shared_key_ids_subq = select(ContentMember.content_id).where(
            ContentMember.organization_id == organization_id,
            ContentMember.content_type == ContentType.PROVIDER_KEY,
            ContentMember.role != ContentRole.BLOCKED,
            or_(
                ContentMember.expires_at.is_(None),
                ContentMember.expires_at > now,
            ),
            or_(
                and_(
                    ContentMember.subject_type == SubjectType.USER,
                    ContentMember.subject_id == user_id,
                ),
                and_(
                    ContentMember.subject_type == SubjectType.GROUP,
                    ContentMember.subject_id.in_(user_groups_subq),
                ),
            ),
        )

        stmt = select(ProviderKey).where(
            ProviderKey.organization_id == organization_id,
            or_(
                ProviderKey.access_mode == AccessMode.OPEN_TO_ORG,
                ProviderKey.created_by == user_id,
                ProviderKey.id.in_(shared_key_ids_subq),
            ),
        )
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

        if key.created_by != user_id:
            await self._org_ops.require_org_admin(user_id, organization_id)

        key_label = key.label
        key_provider = key.provider
        await self._session.delete(key)
        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.AGENT_PROVIDER_KEY_DELETED,
            resource_type="provider_key",
            resource_id=key_id,
            details={"provider": key_provider, "label": key_label},
        )
        await self._session.commit()

        await invalidate_provider_metadata(key_id)

    async def validate_key(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        key_id: UUID,
    ) -> tuple[bool, str | None]:
        """Validate a stored provider key against the provider API."""
        await self._org_ops.require_org_member(user_id, organization_id)

        result = await self._session.execute(
            select(ProviderKey).where(
                ProviderKey.id == key_id,
                ProviderKey.organization_id == organization_id,
            )
        )
        key = result.scalar_one_or_none()
        if not key:
            raise NotFoundError("ProviderKey", str(key_id))

        credential = decrypt_value(key.encrypted_credential)
        llm = get_provider_registry().create_provider(key.provider, credential, key.credential_type)
        is_valid, error = await llm.validate()

        key.is_valid = is_valid
        key.last_validated_at = datetime.now(UTC)
        key.last_error = error
        key.updated_at = datetime.now(UTC)

        await self._session.commit()
        await invalidate_provider_metadata(key_id)
        return is_valid, error

    async def list_available_models(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        provider: str | None = None,
        force_refresh: bool = False,
    ) -> list[ModelInfo]:
        """List models exposed by all valid, enabled keys in the org."""
        await self._org_ops.require_org_member(user_id, organization_id)

        stmt = (
            select(ProviderKey)
            .where(
                ProviderKey.organization_id == organization_id,
                ProviderKey.is_valid == True,  # noqa: E712
                ProviderKey.is_enabled == True,  # noqa: E712
            )
            .order_by(ProviderKey.created_at)
        )
        if provider:
            stmt = stmt.where(ProviderKey.provider == provider)

        result = await self._session.execute(stmt)
        keys = result.scalars().all()

        seen_providers: set[str] = set()
        models: list[ModelInfo] = []
        registry = get_provider_registry()
        for key in keys:
            if key.provider in seen_providers:
                continue
            seen_providers.add(key.provider)
            credential = decrypt_value(key.encrypted_credential)
            llm = registry.create_provider(
                key.provider,
                credential,
                key.credential_type,
            )
            models.extend(
                await llm.get_available_models(
                    force_refresh=force_refresh,
                ),
            )

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

        credential = decrypt_value(key.encrypted_credential)

        key.last_used_at = datetime.now(UTC)
        await self._session.commit()

        return get_provider_registry().create_provider(provider, credential, key.credential_type)

    async def get_provider_for_model(
        self,
        *,
        organization_id: UUID,
        model_id: str,
    ) -> LLMProvider:
        """Return the provider that serves a specific ``model_id``.

        Routing metadata is read from Valkey when available so we can
        skip the per-key decrypt + provider catalog round-trip until we
        find the key that actually owns ``model_id``. The in-process
        LRU caches the decrypted credential + constructed client so a
        match against the same key reuses the warm httpx pool.
        """
        result = await self._session.execute(
            select(ProviderKey)
            .where(
                ProviderKey.organization_id == organization_id,
                ProviderKey.is_valid == True,  # noqa: E712
                ProviderKey.is_enabled == True,  # noqa: E712
            )
            .order_by(ProviderKey.created_at)
        )
        keys = list(result.scalars().all())

        seen_providers: set[str] = set()
        registry = get_provider_registry()
        lru = get_provider_lru()

        for key in keys:
            if key.provider in seen_providers:
                continue
            seen_providers.add(key.provider)

            metadata = await get_cached_provider_metadata(key.id)
            if metadata is not None:
                cached_models = metadata.get("model_ids") or []
                if model_id not in cached_models:
                    continue
                llm = await self._resolve_or_build_provider(lru, key, registry)
                key.last_used_at = datetime.now(UTC)
                await self._session.commit()
                return llm

            llm = await self._resolve_or_build_provider(lru, key, registry)
            models = await llm.get_available_models()
            await set_cached_provider_metadata(
                key.id,
                provider=key.provider,
                credential_type=key.credential_type,
                is_valid=key.is_valid,
                is_enabled=key.is_enabled,
                model_ids=[m.id for m in models],
            )

            if any(m.id == model_id for m in models):
                key.last_used_at = datetime.now(UTC)
                await self._session.commit()
                return llm

        raise NotFoundError(
            "ProviderKey",
            f"No configured provider has model '{model_id}' available",
        )

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
        credential = decrypt_value(key.encrypted_credential)
        provider = registry.create_provider(
            key.provider, credential, key.credential_type
        )
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

        if await get_cached_provider_metadata(key.id) is None:
            try:
                models = await provider.get_available_models()
                await set_cached_provider_metadata(
                    key.id,
                    provider=key.provider,
                    credential_type=key.credential_type,
                    is_valid=key.is_valid,
                    is_enabled=key.is_enabled,
                    model_ids=[m.id for m in models],
                )
            except Exception:
                logger.warning(
                    f"Failed to populate provider metadata cache for {key.id}",
                )

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
        """Resolve ``model_id`` to its (provider client, key row).

        Mirrors ``get_provider_for_model`` but also returns the
        ``ProviderKey`` so callers (failover loop, run-log writer) can
        track which credential is now active. Returns ``None`` when no
        configured key advertises the model.
        """
        result = await self._session.execute(
            select(ProviderKey)
            .where(
                ProviderKey.organization_id == organization_id,
                ProviderKey.is_valid == True,  # noqa: E712
                ProviderKey.is_enabled == True,  # noqa: E712
            )
            .order_by(ProviderKey.created_at)
        )
        keys = list(result.scalars().all())

        seen_providers: set[str] = set()
        registry = get_provider_registry()
        lru = get_provider_lru()

        for key in keys:
            if key.provider in seen_providers:
                continue
            seen_providers.add(key.provider)

            metadata = await get_cached_provider_metadata(key.id)
            if metadata is not None:
                cached_models = metadata.get("model_ids") or []
                if model_id not in cached_models:
                    continue
                llm = await self._resolve_or_build_provider(lru, key, registry)
                key.last_used_at = datetime.now(UTC)
                await self._session.commit()
                return llm, key

            llm = await self._resolve_or_build_provider(lru, key, registry)
            models = await llm.get_available_models()
            await set_cached_provider_metadata(
                key.id,
                provider=key.provider,
                credential_type=key.credential_type,
                is_valid=key.is_valid,
                is_enabled=key.is_enabled,
                model_ids=[m.id for m in models],
            )
            if any(m.id == model_id for m in models):
                key.last_used_at = datetime.now(UTC)
                await self._session.commit()
                return llm, key

        return None

    async def list_models_for_key(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        key_id: UUID,
        force_refresh: bool = False,
    ) -> list[ModelInfo]:
        """List models exposed by a specific provider key."""
        await self._org_ops.require_org_member(user_id, organization_id)

        result = await self._session.execute(
            select(ProviderKey).where(
                ProviderKey.id == key_id,
                ProviderKey.organization_id == organization_id,
            )
        )
        key = result.scalar_one_or_none()
        if not key:
            raise NotFoundError("ProviderKey", str(key_id))

        credential = decrypt_value(key.encrypted_credential)
        llm = get_provider_registry().create_provider(
            key.provider,
            credential,
            key.credential_type,
        )
        return await llm.get_available_models(force_refresh=force_refresh)

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

        if key.created_by != user_id:
            await self._org_ops.require_org_admin(user_id, organization_id)

        key.is_enabled = enabled
        key.updated_at = datetime.now(UTC)
        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.AGENT_PROVIDER_KEY_TOGGLED,
            resource_type="provider_key",
            resource_id=key_id,
            details={"enabled": enabled},
        )
        await self._session.commit()
        await self._session.refresh(key)
        await invalidate_provider_metadata(key_id)
        return key


# Content loader registration


async def _load_provider_key(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> ProviderKey | None:
    """Loader used by ``ContentMembersOperations`` to fetch a provider key."""
    result = await session.execute(
        select(ProviderKey).where(
            ProviderKey.id == content_id,
            ProviderKey.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


register_content_loader(ContentType.PROVIDER_KEY, _load_provider_key)
