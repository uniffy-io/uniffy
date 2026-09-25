"""Proto <-> domain converters for integrations."""

from uniffy_proto.integrations.v1.integrations_pb import (
    IntegrationConnectionInfo,
    IntegrationProviderInfo,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.integrations.connection import IntegrationConnection
from uniffy.domains.integrations.base import IntegrationDescriptor


def connection_to_proto(
    row: IntegrationConnection,
    *,
    include_diagnostics: bool = False,
) -> IntegrationConnectionInfo:
    """Build the client-facing connection message; the credential is never included.

    ``last_error`` is unredacted upstream/transport text and only an org admin
    can act on it, so it rides only when the caller asks for diagnostics.
    """
    info = IntegrationConnectionInfo(
        id=str(row.id),
        provider=row.provider,
        name=row.name,
        credential_hint=row.credential_hint,
        allow_writes=row.allow_writes,
        is_valid=row.is_valid,
        is_enabled=row.is_enabled,
        created_by=str(row.created_by),
        created_at=datetime_to_timestamp(row.created_at),
        updated_at=datetime_to_timestamp(row.updated_at),
    )

    if row.base_url:
        info.base_url = row.base_url

    if row.account_login:
        info.account_login = row.account_login

    if row.last_validated_at:
        info.last_validated_at = datetime_to_timestamp(row.last_validated_at)

    if row.last_used_at:
        info.last_used_at = datetime_to_timestamp(row.last_used_at)

    if include_diagnostics and row.last_error:
        info.last_error = row.last_error

    return info


def provider_info_to_proto(descriptor: IntegrationDescriptor) -> IntegrationProviderInfo:
    return IntegrationProviderInfo(
        id=descriptor.id,
        label=descriptor.label,
        default_base_url=descriptor.default_base_url,
        credential_placeholder=descriptor.credential_placeholder,
        credential_docs_url=descriptor.credential_docs_url,
        supports_base_url_override=descriptor.supports_base_url_override,
    )
