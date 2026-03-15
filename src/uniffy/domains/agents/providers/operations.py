"""Business logic for LLM provider key management."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto import decrypt_value, encrypt_value
from uniffy.core.errors import ConflictError, NotFoundError, ValidationError
from uniffy.core.models import ContentPermission
from uniffy.core.models.agents.provider_key import ProviderKey
from uniffy.core.models.shared import ContentType, SubjectType
from uniffy.core.types import VisibilityScope
from uniffy.domains.agents.audit import create_audit_log
from uniffy.domains.agents.providers.base import LLMProvider, ModelInfo
from uniffy.domains.agents.providers.registry import get_provider_registry
from uniffy.domains.agents.providers.utils import build_key_hint
from uniffy.domains.organizations.operations import OrganizationOperations


class ProviderOperations:
    """Operations for managing LLM provider credentials.

    Parameters
    ----------
    session : AsyncSession
        Database session.

    """

    def __init__(self, session: AsyncSession) -> None:
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
        visibility: VisibilityScope = VisibilityScope.ORGANIZATION,
    ) -> ProviderKey:
        """Add a new provider key.

        Validates the credential format, encrypts it, and stores it.
        Runs an initial validation against the provider API.

        Parameters
        ----------
        user_id : UUID
            The user adding the key.
        organization_id : UUID
            Organization to add the key to.
        provider : str
            Provider name (e.g. "anthropic").
        credential_type : str
            "api_key" or "setup_token".
        label : str
            User-friendly label.
        credential : str
            The raw credential.
        visibility : VisibilityScope
            Visibility scope for the key.

        Returns
        -------
        ProviderKey
            The created provider key record.

        Raises
        ------
        ValidationError
            If the credential format is invalid.
        PermissionDeniedError
            If the user is not an org admin.
        ConflictError
            If a key with the same provider+label already exists.

        """
        # Org admins can create any key; members can only create PRIVATE keys
        if visibility == VisibilityScope.PRIVATE:
            await self._org_ops.require_org_member(user_id, organization_id)
        else:
            await self._org_ops.require_org_admin(user_id, organization_id)

        # Validate label
        if not label or not label.strip():
            raise ValidationError("label", "Label cannot be empty")
        label = label.strip()

        # Validate credential format
        credential = credential.strip()
        get_provider_registry().validate_credential(provider, credential, credential_type)

        # Check for duplicate
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

        # Encrypt and store
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
            visibility=visibility,
            created_by=user_id,
        )
        self._session.add(key)

        # Run initial validation
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

        await create_audit_log(
            self._session,
            organization_id=organization_id,
            user_id=user_id,
            action="provider_key.add",
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

        return key

    async def list_keys(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        provider: str | None = None,
    ) -> list[ProviderKey]:
        """List provider keys for an organization.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization ID.
        provider : str | None
            Optional provider filter.

        Returns
        -------
        list[ProviderKey]
            List of provider keys (encrypted_credential is never exposed).

        Raises
        ------
        PermissionDeniedError
            If the user is not an org member.

        """
        await self._org_ops.require_org_member(user_id, organization_id)

        # Keys the user can see:
        # 1. ORGANIZATION-scoped keys (visible to everyone)
        # 2. PRIVATE keys the user created
        # 3. PRIVATE keys shared with the user via ContentPermission
        shared_key_ids = select(ContentPermission.content_id).where(
            ContentPermission.organization_id == organization_id,
            ContentPermission.content_type == ContentType.PROVIDER_KEY,
            ContentPermission.subject_type == SubjectType.USER,
            ContentPermission.subject_id == user_id,
        )

        stmt = select(ProviderKey).where(
            ProviderKey.organization_id == organization_id,
            or_(
                ProviderKey.visibility == VisibilityScope.ORGANIZATION,
                ProviderKey.created_by == user_id,
                ProviderKey.id.in_(shared_key_ids),
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
        """Remove a provider key.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization ID.
        key_id : UUID
            Key to remove.

        Raises
        ------
        PermissionDeniedError
            If the user is not an org admin.
        NotFoundError
            If the key does not exist.

        """
        result = await self._session.execute(
            select(ProviderKey).where(
                ProviderKey.id == key_id,
                ProviderKey.organization_id == organization_id,
            )
        )
        key = result.scalar_one_or_none()
        if not key:
            raise NotFoundError("ProviderKey", str(key_id))

        # Owner can delete their own key; org admin can delete any key
        if key.created_by != user_id:
            await self._org_ops.require_org_admin(user_id, organization_id)

        key_label = key.label
        key_provider = key.provider
        await self._session.delete(key)
        await create_audit_log(
            self._session,
            organization_id=organization_id,
            user_id=user_id,
            action="provider_key.remove",
            resource_type="provider_key",
            resource_id=key_id,
            details={"provider": key_provider, "label": key_label},
        )
        await self._session.commit()

    async def validate_key(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        key_id: UUID,
    ) -> tuple[bool, str | None]:
        """Validate a stored provider key against the provider API.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization ID.
        key_id : UUID
            Key to validate.

        Returns
        -------
        tuple[bool, str | None]
            (is_valid, error_message).

        Raises
        ------
        PermissionDeniedError
            If the user is not an org member.
        NotFoundError
            If the key does not exist.

        """
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

        # Decrypt and validate
        credential = decrypt_value(key.encrypted_credential)
        llm = get_provider_registry().create_provider(key.provider, credential, key.credential_type)
        is_valid, error = await llm.validate()

        # Update status
        key.is_valid = is_valid
        key.last_validated_at = datetime.now(UTC)
        key.last_error = error
        key.updated_at = datetime.now(UTC)

        await self._session.commit()
        return is_valid, error

    async def list_available_models(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        provider: str | None = None,
        force_refresh: bool = False,
    ) -> list[ModelInfo]:
        """List models available based on configured provider keys.

        For each provider that has at least one valid key, creates a
        provider instance and fetches the model list from the provider
        API (with static capability enrichment and caching).

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization ID.
        provider : str | None
            Optional provider filter.
        force_refresh : bool
            When True, bypass the cached model list and fetch fresh
            from the provider API.

        Returns
        -------
        list[ModelInfo]
            Available models.

        Raises
        ------
        PermissionDeniedError
            If the user is not an org member.

        """
        await self._org_ops.require_org_member(user_id, organization_id)

        # Find first valid, enabled key per provider
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

        # Deduplicate: one key per provider is enough to fetch the catalog
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
        """Get an active LLM provider instance for the organization.

        Finds the first valid key for the given provider, decrypts it,
        and returns a configured provider instance.

        Parameters
        ----------
        organization_id : UUID
            Organization ID.
        provider : str
            Provider name.

        Returns
        -------
        LLMProvider
            Configured provider instance ready for API calls.

        Raises
        ------
        NotFoundError
            If no valid key is found for the provider.

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
        key = result.scalars().first()
        if not key:
            raise NotFoundError(
                "ProviderKey",
                f"No valid {provider} key configured for this organization",
            )

        credential = decrypt_value(key.encrypted_credential)

        # Update last_used_at
        key.last_used_at = datetime.now(UTC)
        await self._session.commit()

        return get_provider_registry().create_provider(provider, credential, key.credential_type)

    async def get_provider_for_model(
        self,
        *,
        organization_id: UUID,
        model_id: str,
    ) -> LLMProvider:
        """Get the correct LLM provider for a specific model.

        Checks all valid, enabled provider keys for the organization,
        fetches their model catalogs, and returns the provider whose
        catalog contains the requested model.

        Parameters
        ----------
        organization_id : UUID
            Organization ID.
        model_id : str
            The model identifier to find a provider for.

        Returns
        -------
        LLMProvider
            Provider instance that serves the requested model.

        Raises
        ------
        NotFoundError
            If no provider has the requested model available.

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

        for key in keys:
            if key.provider in seen_providers:
                continue
            seen_providers.add(key.provider)

            credential = decrypt_value(key.encrypted_credential)
            llm = registry.create_provider(key.provider, credential, key.credential_type)
            models = await llm.get_available_models()

            if any(m.id == model_id for m in models):
                key.last_used_at = datetime.now(UTC)
                await self._session.commit()
                return llm

        raise NotFoundError(
            "ProviderKey",
            f"No configured provider has model '{model_id}' available",
        )

    async def get_provider_for_key(
        self,
        *,
        organization_id: UUID,
        key_id: UUID,
    ) -> tuple[LLMProvider, ProviderKey]:
        """Get an LLM provider instance using a specific provider key.

        Parameters
        ----------
        organization_id : UUID
            Organization context.
        key_id : UUID
            The specific provider key to use.

        Returns
        -------
        tuple[LLMProvider, ProviderKey]
            Configured provider instance and the key record.

        Raises
        ------
        NotFoundError
            If the key does not exist, is invalid, or is disabled.

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

        credential = decrypt_value(key.encrypted_credential)
        key.last_used_at = datetime.now(UTC)
        await self._session.commit()

        provider = get_provider_registry().create_provider(
            key.provider,
            credential,
            key.credential_type,
        )
        return provider, key

    async def list_models_for_key(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        key_id: UUID,
        force_refresh: bool = False,
    ) -> list[ModelInfo]:
        """List models available through a specific provider key.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization ID.
        key_id : UUID
            Provider key to fetch models for.
        force_refresh : bool
            Bypass cache and fetch fresh from provider API.

        Returns
        -------
        list[ModelInfo]
            Available models for this key's provider.

        Raises
        ------
        PermissionDeniedError
            If the user is not an org member.
        NotFoundError
            If the key does not exist.

        """
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
        """Enable or disable a provider key.

        Parameters
        ----------
        user_id : UUID
            Requesting user (must be org admin).
        organization_id : UUID
            Organization context.
        key_id : UUID
            Key to toggle.
        enabled : bool
            True to enable, False to disable.

        Returns
        -------
        ProviderKey
            Updated key.

        Raises
        ------
        NotFoundError
            If the key does not exist.

        """
        result = await self._session.execute(
            select(ProviderKey).where(
                ProviderKey.id == key_id,
                ProviderKey.organization_id == organization_id,
            )
        )
        key = result.scalar_one_or_none()
        if not key:
            raise NotFoundError("ProviderKey", str(key_id))

        # Owner can toggle their own key; org admin can toggle any key
        if key.created_by != user_id:
            await self._org_ops.require_org_admin(user_id, organization_id)

        key.is_enabled = enabled
        key.updated_at = datetime.now(UTC)
        await create_audit_log(
            self._session,
            organization_id=organization_id,
            user_id=user_id,
            action="provider_key.toggle",
            resource_type="provider_key",
            resource_id=key_id,
            details={"enabled": enabled},
        )
        await self._session.commit()
        await self._session.refresh(key)
        return key
