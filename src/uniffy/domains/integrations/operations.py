"""Integration connection operations."""

from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.crypto import OrgCipher, ReEncryptingConsumer, register_consumer
from uniffy.core.errors import ConflictError, NotFoundError, ValidationError
from uniffy.core.models.integrations.connection import IntegrationConnection
from uniffy.domains.agents.providers.utils import build_key_hint
from uniffy.domains.integrations.base import IntegrationProvider
from uniffy.domains.integrations.cache import (
    get_org_connections_meta,
    invalidate_org_connections_meta,
    publish_connection_invalidation,
)
from uniffy.domains.integrations.registry import get_integration_registry
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.observability.metrics import INTEGRATION_CONNECTION_VALIDATIONS_TOTAL

logger = logger.bind(component="integrations.operations")

_LAST_USED_THROTTLE = timedelta(minutes=5)
_UNSET: Any = object()


def _normalize_base_url(raw: str | None) -> str | None:
    """Validate an admin-written API base URL; ``None`` means the provider default."""
    if raw is None:
        return None
    raw = raw.strip()
    if not raw:
        return None
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https"):
        raise ValidationError("base_url", "Base URL must use http or https")
    if not parts.hostname:
        raise ValidationError("base_url", "Base URL must include a host")
    if parts.username or parts.password:
        raise ValidationError("base_url", "Base URL must not embed credentials")
    if parts.query or parts.fragment:
        raise ValidationError("base_url", "Base URL must not include a query or fragment")
    return raw.rstrip("/")


class ConnectionOperations:
    """CRUD, validation, and executor-side resolution for integration connections."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._org_ops = OrganizationOperations(session)
        self._org_cipher = OrgCipher(session)

    async def _load_connection(
        self, connection_id: UUID, organization_id: UUID
    ) -> IntegrationConnection:
        result = await self._session.execute(
            select(IntegrationConnection).where(
                IntegrationConnection.id == connection_id,
                IntegrationConnection.organization_id == organization_id,
            )
        )
        row = result.scalar_one_or_none()
        if not row:
            raise NotFoundError("IntegrationConnection", str(connection_id))
        return row

    async def _name_taken(
        self,
        organization_id: UUID,
        provider: str,
        name: str,
        *,
        exclude_id: UUID | None = None,
    ) -> bool:
        stmt = select(IntegrationConnection.id).where(
            IntegrationConnection.organization_id == organization_id,
            IntegrationConnection.provider == provider,
            IntegrationConnection.name == name,
        )
        if exclude_id is not None:
            stmt = stmt.where(IntegrationConnection.id != exclude_id)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def _run_probe(
        self,
        row: IntegrationConnection,
        provider: IntegrationProvider,
        credential: str,
    ) -> None:
        """Probe the credential and store the outcome on the row, never raising."""
        row.last_validated_at = datetime.now(UTC)
        try:
            probe = await provider.validate(credential, row.base_url)
            row.is_valid = probe.is_valid
            row.last_error = probe.error
            if probe.account_login:
                row.account_login = probe.account_login
            outcome = "valid" if probe.is_valid else "invalid"
        except Exception as exc:
            row.is_valid = False
            row.last_error = str(exc)
            outcome = "error"
        INTEGRATION_CONNECTION_VALIDATIONS_TOTAL.labels(
            provider=row.provider, outcome=outcome
        ).inc()

    async def add_connection(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        provider: str,
        name: str,
        credential: str,
        base_url: str | None = None,
        allow_writes: bool = False,
    ) -> IntegrationConnection:
        """Add a connection; the probe stores its outcome on the row, never raising."""
        await self._org_ops.require_org_admin(user_id, organization_id)

        if not name or not name.strip():
            raise ValidationError("name", "Name cannot be empty")
        name = name.strip()

        credential = credential.strip()
        if not credential:
            raise ValidationError("credential", "Credential cannot be empty")

        provider_obj = get_integration_registry().require_known(provider)
        base_url = _normalize_base_url(base_url)
        if base_url and not provider_obj.descriptor.supports_base_url_override:
            raise ValidationError(
                "base_url",
                f"{provider_obj.descriptor.label} does not support a custom base URL",
            )

        if await self._name_taken(organization_id, provider, name):
            raise ConflictError(
                "IntegrationConnection",
                f"A connection named '{name}' already exists for provider '{provider}'",
            )

        encrypted = await self._org_cipher.encrypt(organization_id, credential)

        row = IntegrationConnection(
            organization_id=organization_id,
            provider=provider,
            name=name,
            base_url=base_url,
            encrypted_credential=encrypted,
            credential_hint=build_key_hint(credential),
            allow_writes=allow_writes,
            is_valid=True,
            created_by=user_id,
        )
        self._session.add(row)

        await self._run_probe(row, provider_obj, credential)

        await self._session.commit()
        await self._session.refresh(row)

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.INTEGRATION_CONNECTION_ADDED,
            resource_type="integration_connection",
            resource_id=row.id,
            details={
                "provider": provider,
                "name": name,
                "credential_hint": row.credential_hint,
                "base_url": base_url,
                "allow_writes": allow_writes,
            },
        )
        await self._session.commit()

        await publish_connection_invalidation(row.id)
        await invalidate_org_connections_meta(organization_id)

        return row

    async def list_connections(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        provider: str | None = None,
    ) -> list[IntegrationConnection]:
        """List the org's connections; member-readable so the builder hint works."""
        await self._org_ops.require_org_member(user_id, organization_id)

        stmt = select(IntegrationConnection).where(
            IntegrationConnection.organization_id == organization_id
        )
        if provider:
            stmt = stmt.where(IntegrationConnection.provider == provider)
        stmt = stmt.order_by(IntegrationConnection.created_at)

        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def update_connection(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        connection_id: UUID,
        name: str | None = None,
        base_url: str | None = _UNSET,
        allow_writes: bool | None = None,
        credential: str | None = None,
    ) -> IntegrationConnection:
        """Update name / base URL / write policy, or rotate the credential (re-probes).

        The admin gate runs BEFORE the row load so a non-admin cannot probe
        cross-org connection ids for existence.
        """
        await self._org_ops.require_org_admin(user_id, organization_id)
        row = await self._load_connection(connection_id, organization_id)

        changed: list[str] = []

        if name is not None and name.strip() and name.strip() != row.name:
            name = name.strip()
            if await self._name_taken(
                organization_id, row.provider, name, exclude_id=row.id
            ):
                raise ConflictError(
                    "IntegrationConnection",
                    f"A connection named '{name}' already exists for provider "
                    f"'{row.provider}'",
                )
            row.name = name
            changed.append("name")

        if base_url is not _UNSET:
            normalized = _normalize_base_url(base_url)
            provider_obj = get_integration_registry().require_known(row.provider)
            if normalized and not provider_obj.descriptor.supports_base_url_override:
                raise ValidationError(
                    "base_url",
                    f"{provider_obj.descriptor.label} does not support a custom base URL",
                )
            if normalized != row.base_url:
                row.base_url = normalized
                changed.append("base_url")

        if allow_writes is not None and allow_writes != row.allow_writes:
            row.allow_writes = allow_writes
            changed.append("allow_writes")

        if credential is not None and credential.strip():
            credential = credential.strip()
            row.encrypted_credential = await self._org_cipher.encrypt(
                organization_id, credential
            )
            row.credential_hint = build_key_hint(credential)
            provider_obj = get_integration_registry().require_known(row.provider)
            await self._run_probe(row, provider_obj, credential)
            changed.append("credential")

        if not changed:
            return row

        row.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(row)

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.INTEGRATION_CONNECTION_UPDATED,
            resource_type="integration_connection",
            resource_id=row.id,
            details={
                "provider": row.provider,
                "name": row.name,
                "changed": changed,
            },
        )
        await self._session.commit()

        await publish_connection_invalidation(row.id)
        await invalidate_org_connections_meta(organization_id)

        return row

    async def remove_connection(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        connection_id: UUID,
    ) -> None:
        """Remove a connection (admin gate before load, see ``update_connection``)."""
        await self._org_ops.require_org_admin(user_id, organization_id)
        row = await self._load_connection(connection_id, organization_id)

        provider = row.provider
        name = row.name
        await self._session.delete(row)
        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.INTEGRATION_CONNECTION_REMOVED,
            resource_type="integration_connection",
            resource_id=connection_id,
            details={"provider": provider, "name": name},
        )
        await self._session.commit()

        await publish_connection_invalidation(connection_id)
        await invalidate_org_connections_meta(organization_id)

    async def validate_connection(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        connection_id: UUID,
    ) -> IntegrationConnection:
        """Re-probe a stored credential; the outcome overwrites the row state."""
        await self._org_ops.require_org_admin(user_id, organization_id)
        row = await self._load_connection(connection_id, organization_id)

        credential = await self._org_cipher.decrypt(
            row.organization_id, row.encrypted_credential
        )
        provider_obj = get_integration_registry().require_known(row.provider)
        await self._run_probe(row, provider_obj, credential)
        row.updated_at = datetime.now(UTC)

        await self._session.commit()
        await self._session.refresh(row)

        await publish_connection_invalidation(connection_id)
        await invalidate_org_connections_meta(organization_id)

        return row

    async def toggle_connection(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        connection_id: UUID,
        enabled: bool,
    ) -> IntegrationConnection:
        """Enable or disable a connection (admin gate before load)."""
        await self._org_ops.require_org_admin(user_id, organization_id)
        row = await self._load_connection(connection_id, organization_id)

        row.is_enabled = enabled
        row.updated_at = datetime.now(UTC)
        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.INTEGRATION_CONNECTION_TOGGLED,
            resource_type="integration_connection",
            resource_id=connection_id,
            details={"provider": row.provider, "name": row.name, "enabled": enabled},
        )
        await self._session.commit()
        await self._session.refresh(row)

        await publish_connection_invalidation(connection_id)
        await invalidate_org_connections_meta(organization_id)

        return row

    async def resolve_connection(
        self,
        *,
        organization_id: UUID,
        provider: str,
        name: str | None = None,
        connection_id: UUID | None = None,
    ) -> dict[str, Any]:
        """Resolve the usable connection for a tool call; errors carry recovery copy for the LLM.

        ``name`` is the explicit tool argument and wins; ``connection_id`` is
        the agent's pin, consulted only when no name arrived.
        """
        meta = await get_org_connections_meta(self._session, organization_id)
        provider_rows = [m for m in meta if m.get("provider") == provider]
        usable = [m for m in provider_rows if m.get("is_valid") and m.get("is_enabled")]

        if name:
            for m in usable:
                if m.get("name") == name:
                    return m
            for m in provider_rows:
                if m.get("name") == name:
                    reason = "disabled" if not m.get("is_enabled") else "marked invalid"
                    raise ValidationError(
                        "connection",
                        f"Connection '{name}' is {reason}. An org admin can fix it "
                        f"under Admin > Integrations.",
                    )
            known = ", ".join(sorted(m.get("name", "") for m in usable)) or "none"
            raise ValidationError(
                "connection",
                f"No {provider} connection named '{name}'. Available: {known}",
            )

        if connection_id is not None:
            target = str(connection_id)
            for m in provider_rows:
                if m.get("id") == target:
                    if m.get("is_valid") and m.get("is_enabled"):
                        return m
                    reason = "disabled" if not m.get("is_enabled") else "marked invalid"
                    raise ValidationError(
                        "connection",
                        f"The {provider} connection '{m.get('name')}' pinned to "
                        f"this agent is {reason}. An org admin can fix it under "
                        f"Admin > Integrations.",
                    )
            raise ValidationError(
                "connection",
                f"The {provider} connection pinned to this agent no longer "
                f"exists; a builder can fix it on the agent's Capabilities tab.",
            )

        if not usable:
            raise ValidationError(
                "connection",
                f"No enabled {provider} connection. Ask an org admin to add one "
                f"under Admin > Integrations.",
            )
        if len(usable) > 1:
            names = ", ".join(sorted(m.get("name", "") for m in usable))
            raise ValidationError(
                "connection",
                f"Multiple {provider} connections exist; pass the 'connection' "
                f"argument with one of: {names}",
            )
        return usable[0]

    async def get_connection_row(
        self, connection_id: UUID, organization_id: UUID
    ) -> IntegrationConnection:
        """Row load for the executor's LRU-miss path (no user gate: internal)."""
        return await self._load_connection(connection_id, organization_id)

    async def mark_connection_invalid(
        self,
        connection_id: UUID,
        organization_id: UUID,
        error: str,
    ) -> None:
        """Auto-demote after an auth rejection during a tool call."""
        await self._session.execute(
            update(IntegrationConnection)
            .where(IntegrationConnection.id == connection_id)
            .values(
                is_valid=False,
                last_error=error[:2000],
                updated_at=datetime.now(UTC),
            )
        )
        await self._session.commit()
        await publish_connection_invalidation(connection_id)
        await invalidate_org_connections_meta(organization_id)
        logger.warning(f"Integration connection {connection_id} auto-demoted: {error[:200]}")

    async def touch_last_used(self, connection_id: UUID) -> None:
        """Hot-row discipline: at most one ``last_used_at`` write per 5 minutes."""
        now = datetime.now(UTC)
        await self._session.execute(
            update(IntegrationConnection)
            .where(
                IntegrationConnection.id == connection_id,
                (IntegrationConnection.last_used_at.is_(None))  # type: ignore[union-attr]
                | (IntegrationConnection.last_used_at < now - _LAST_USED_THROTTLE),
            )
            .values(last_used_at=now)
        )
        await self._session.commit()


async def _list_connections_for_org(
    session: AsyncSession,
    organization_id: UUID,
):
    """Yield every connection row owned by an organization for DEK rotation."""
    result = await session.execute(
        select(IntegrationConnection).where(
            IntegrationConnection.organization_id == organization_id
        )
    )
    for row in result.scalars():
        yield row


def _connection_set_ciphertext(row: IntegrationConnection, ciphertext: str) -> None:
    row.encrypted_credential = ciphertext


register_consumer(
    ReEncryptingConsumer(
        name="integrations_connections",
        table_name="integrations_connections",
        list_rows=_list_connections_for_org,
        get_ciphertext=lambda row: row.encrypted_credential,
        set_ciphertext=_connection_set_ciphertext,
    )
)
