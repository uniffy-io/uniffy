"""Single lookup surface for source kinds - sync plane now, login plane later."""

from dataclasses import fields

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.config.settings.organization import OrgSettingsOperations
from uniffy.core.errors import ValidationError
from uniffy.core.models.people.identity import IdentitySource, IdentitySourceKind
from uniffy.domains.directory.sync.base import (
    DirectorySyncProvider,
    LdapSourceConfig,
    LocalSourceConfig,
    OidcSourceConfig,
    ScimSourceConfig,
    SourceConfig,
)
from uniffy.domains.directory.sync.local import LocalDirectoryProvider
from uniffy.domains.directory.sync.types import SourceCapabilities

# One secret per source: org_settings namespace `identity`, key str(source_id),
# is_secret=True (OrgCipher + DEK rotation ride along). DeleteIdentitySource
# removes the row.
IDENTITY_SECRET_NAMESPACE = "identity"

PROVIDERS: dict[IdentitySourceKind, type[DirectorySyncProvider]] = {
    IdentitySourceKind.LOCAL: LocalDirectoryProvider,
}

_CONFIG_CLASSES: dict[IdentitySourceKind, type[SourceConfig]] = {
    IdentitySourceKind.LOCAL: LocalSourceConfig,
    IdentitySourceKind.SCIM: ScimSourceConfig,
    IdentitySourceKind.LDAP: LdapSourceConfig,
    IdentitySourceKind.OIDC: OidcSourceConfig,
}

# Capabilities describe the KIND, not one configured source; kinds without a
# shipped provider still declare theirs so the RPCs and admin UI can gate.
_CAPABILITIES: dict[IdentitySourceKind, SourceCapabilities] = {
    IdentitySourceKind.LOCAL: LocalDirectoryProvider.capabilities,
    IdentitySourceKind.SCIM: SourceCapabilities(supports_push=True, supports_manager=True),
    IdentitySourceKind.LDAP: SourceCapabilities(
        supports_pull_users=True, supports_pull_groups=True, supports_manager=True
    ),
    IdentitySourceKind.OIDC: SourceCapabilities(supports_jit_login=True, supports_login=True),
}


def capabilities_for(kind: IdentitySourceKind) -> SourceCapabilities:
    capabilities = _CAPABILITIES.get(kind)
    if capabilities is None:
        raise ValidationError("kind", f"unknown identity source kind: {kind}")
    return capabilities


def has_provider(kind: IdentitySourceKind) -> bool:
    return kind in PROVIDERS


def parse_source_config(kind: IdentitySourceKind, raw: dict) -> SourceConfig:
    """Unknown keys are a hard reject, never silently carried."""
    config_cls = _CONFIG_CLASSES.get(kind)
    if config_cls is None:
        raise ValidationError("kind", f"unknown identity source kind: {kind}")
    known = {f.name for f in fields(config_cls)}
    unknown = set(raw) - known
    if unknown:
        raise ValidationError("config", f"unknown config keys: {', '.join(sorted(unknown))}")
    try:
        return config_cls(**raw)
    except TypeError as e:
        raise ValidationError("config", str(e)) from e


async def build_provider(session: AsyncSession, source: IdentitySource) -> DirectorySyncProvider:
    """Parse config, load the decrypted secret, construct the provider."""
    provider_cls = PROVIDERS.get(source.kind)
    if provider_cls is None:
        raise ValidationError("kind", f"no connector available for kind: {source.kind}")
    config = parse_source_config(source.kind, source.config or {})
    secret = await OrgSettingsOperations(session).get_secret(
        source.organization_id, IDENTITY_SECRET_NAMESPACE, str(source.id)
    )
    return provider_cls(config, secret)
