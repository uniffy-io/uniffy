"""The OAuth app a provider uses for an organization: its own, else the deployment's, else none."""

import hashlib
import os
from dataclasses import dataclass, field
from enum import StrEnum
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.config.settings.organization import OrgSettingsOperations
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.calendar.connection import (
    CalendarConnection,
    CalendarProvider,
    ConnectionStatus,
)

PROVIDERS_NAMESPACE = "calendar_providers"
DEFAULT_MICROSOFT_TENANT = "common"
_SECRET_HINT_CHARS = 4
_MAX_FIELD = 500


class CredentialSource(StrEnum):
    ORGANIZATION = "ORGANIZATION"
    DEPLOYMENT = "DEPLOYMENT"


@dataclass(frozen=True)
class ProviderCredentials:
    provider: CalendarProvider
    client_id: str
    client_secret: str = field(repr=False)
    source: CredentialSource
    tenant: str = DEFAULT_MICROSOFT_TENANT

    @property
    def fingerprint(self) -> str:
        """Tokens are bound to the app that issued them; a new app means signing in again."""
        return client_fingerprint(self.client_id)


def client_fingerprint(client_id: str) -> str:
    return hashlib.sha256(client_id.encode()).hexdigest()


_ENV = {
    CalendarProvider.GOOGLE: ("GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET", None),
    CalendarProvider.MICROSOFT: (
        "MICROSOFT_CALENDAR_CLIENT_ID",
        "MICROSOFT_CALENDAR_CLIENT_SECRET",
        "MICROSOFT_CALENDAR_TENANT",
    ),
}


def _prefix(provider: CalendarProvider) -> str:
    return provider.value.lower()


def _id_key(provider: CalendarProvider) -> str:
    return f"{_prefix(provider)}.client_id"


def _secret_key(provider: CalendarProvider) -> str:
    return f"{_prefix(provider)}.client_secret"


def _tenant_key(provider: CalendarProvider) -> str:
    return f"{_prefix(provider)}.tenant"


def deployment_credentials(provider: CalendarProvider) -> ProviderCredentials | None:
    id_var, secret_var, tenant_var = _ENV[provider]
    client_id = (os.getenv(id_var) or "").strip()
    client_secret = (os.getenv(secret_var) or "").strip()
    if not client_id or not client_secret:
        return None
    tenant = (os.getenv(tenant_var) or "").strip() if tenant_var else ""
    return ProviderCredentials(
        provider=provider,
        client_id=client_id,
        client_secret=client_secret,
        source=CredentialSource.DEPLOYMENT,
        tenant=tenant or DEFAULT_MICROSOFT_TENANT,
    )


async def resolve_provider_credentials(
    session: AsyncSession, organization_id: UUID, provider: CalendarProvider
) -> ProviderCredentials | None:
    """Read on every use and never cached, so a secret only ever lives in this process."""
    settings = OrgSettingsOperations(session)
    rows = await settings.get_namespace(organization_id, PROVIDERS_NAMESPACE)
    id_row = rows.get(_id_key(provider))
    client_id = id_row.value if id_row is not None and isinstance(id_row.value, str) else ""
    if client_id:
        secret = await settings.get_secret(
            organization_id, PROVIDERS_NAMESPACE, _secret_key(provider)
        )
        if secret:
            tenant_row = rows.get(_tenant_key(provider))
            tenant = tenant_row.value if tenant_row and isinstance(tenant_row.value, str) else ""
            return ProviderCredentials(
                provider=provider,
                client_id=client_id,
                client_secret=secret,
                source=CredentialSource.ORGANIZATION,
                tenant=tenant or DEFAULT_MICROSOFT_TENANT,
            )
    return deployment_credentials(provider)


@dataclass(frozen=True)
class ProviderAppView:
    """What an admin sees of a provider app; the secret shows only as its last characters."""

    provider: CalendarProvider
    source: CredentialSource | None
    client_id: str
    secret_hint: str
    tenant: str
    deployment_configured: bool


async def provider_app_views(
    session: AsyncSession, user_id: UUID, organization_id: UUID
) -> list[ProviderAppView]:
    """The organization's provider apps as its admins see them."""
    await _require_org_admin(session, user_id, organization_id, "view")
    settings = OrgSettingsOperations(session)
    rows = await settings.get_namespace(organization_id, PROVIDERS_NAMESPACE)
    views = []
    for provider in CalendarProvider:
        deployment = deployment_credentials(provider)
        resolved = await resolve_provider_credentials(session, organization_id, provider)
        own = resolved is not None and resolved.source == CredentialSource.ORGANIZATION
        tenant_row = rows.get(_tenant_key(provider))
        views.append(
            ProviderAppView(
                provider=provider,
                source=resolved.source if resolved else None,
                client_id=resolved.client_id if own and resolved else "",
                secret_hint=resolved.client_secret[-_SECRET_HINT_CHARS:] if own and resolved else "",
                tenant=(
                    tenant_row.value
                    if own and tenant_row and isinstance(tenant_row.value, str)
                    else ""
                ),
                deployment_configured=deployment is not None,
            )
        )
    return views


async def _require_org_admin(
    session: AsyncSession, user_id: UUID, organization_id: UUID, action: str = "update"
) -> None:
    if not await PermissionChecker(session).is_org_admin(user_id, organization_id):
        raise PermissionDeniedError(action, "calendar provider settings")


def _clean(value: str, field_name: str) -> str:
    text = value.strip()
    if len(text) > _MAX_FIELD or any(ord(ch) < 32 for ch in text):  # noqa: PLR2004 - control chars
        raise ValidationError(field_name, f"{field_name} is not valid")
    return text


async def set_provider_credentials(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    provider: CalendarProvider,
    *,
    client_id: str,
    client_secret: str,
    tenant: str,
) -> None:
    """Store the organization's own app; a new client id signs everyone out of that provider."""
    await _require_org_admin(session, user_id, organization_id)
    client_id = _clean(client_id, "client_id")
    client_secret = _clean(client_secret, "client_secret")
    tenant = _clean(tenant, "tenant") if provider == CalendarProvider.MICROSOFT else ""
    if not client_id:
        raise ValidationError("client_id", "Enter the client ID")
    settings = OrgSettingsOperations(session)
    before = await resolve_provider_credentials(session, organization_id, provider)
    has_own_secret = (
        before is not None
        and before.source == CredentialSource.ORGANIZATION
        and before.client_id == client_id
    )
    if not client_secret and not has_own_secret:
        raise ValidationError("client_secret", "Enter the client secret")
    await settings.set(
        organization_id=organization_id,
        namespace=PROVIDERS_NAMESPACE,
        key=_id_key(provider),
        value=client_id,
        updated_by_user_id=user_id,
    )
    if client_secret:
        await settings.set(
            organization_id=organization_id,
            namespace=PROVIDERS_NAMESPACE,
            key=_secret_key(provider),
            value=client_secret,
            is_secret=True,
            updated_by_user_id=user_id,
        )
    if provider == CalendarProvider.MICROSOFT:
        await settings.set(
            organization_id=organization_id,
            namespace=PROVIDERS_NAMESPACE,
            key=_tenant_key(provider),
            value=tenant or DEFAULT_MICROSOFT_TENANT,
            updated_by_user_id=user_id,
        )
    signed_out = await _expire_connections_issued_elsewhere(
        session, organization_id, provider, client_fingerprint(client_id)
    )
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=user_id,
        action=Action.CALENDAR_PROVIDER_SETTINGS_UPDATED,
        resource_type=AuditResourceType.CALENDAR,
        resource_id=organization_id,
        details={
            "provider": provider.value,
            "source": CredentialSource.ORGANIZATION.value,
            "secret_changed": bool(client_secret),
            "connections_signed_out": signed_out,
        },
    )
    await session.commit()


async def clear_provider_credentials(
    session: AsyncSession, user_id: UUID, organization_id: UUID, provider: CalendarProvider
) -> None:
    await _require_org_admin(session, user_id, organization_id)
    settings = OrgSettingsOperations(session)
    for key in (_id_key(provider), _secret_key(provider), _tenant_key(provider)):
        await settings.delete_key(
            organization_id=organization_id, namespace=PROVIDERS_NAMESPACE, key=key
        )
    fallback = deployment_credentials(provider)
    signed_out = await _expire_connections_issued_elsewhere(
        session, organization_id, provider, fallback.fingerprint if fallback else None
    )
    await write_audit_event(
        session,
        organization_id=organization_id,
        actor_user_id=user_id,
        action=Action.CALENDAR_PROVIDER_SETTINGS_UPDATED,
        resource_type=AuditResourceType.CALENDAR,
        resource_id=organization_id,
        details={
            "provider": provider.value,
            "source": CredentialSource.DEPLOYMENT.value if fallback else None,
            "connections_signed_out": signed_out,
        },
    )
    await session.commit()


async def _expire_connections_issued_elsewhere(
    session: AsyncSession,
    organization_id: UUID,
    provider: CalendarProvider,
    fingerprint: str | None,
) -> int:
    """Tokens from another app cannot be refreshed by this one; those members must sign in again."""
    statement = (
        update(CalendarConnection)
        .where(
            CalendarConnection.organization_id == organization_id,
            CalendarConnection.provider == provider,
            CalendarConnection.status.in_([ConnectionStatus.ACTIVE, ConnectionStatus.PAUSED]),
        )
        .values(
            status=ConnectionStatus.REAUTH_REQUIRED,
            generation=CalendarConnection.generation + 1,
            access_token_encrypted=None,
            access_token_expires_at=None,
        )
    )
    if fingerprint is not None:
        statement = statement.where(CalendarConnection.client_fingerprint != fingerprint)
    result = await session.execute(statement)
    return int(getattr(result, "rowcount", 0) or 0)
