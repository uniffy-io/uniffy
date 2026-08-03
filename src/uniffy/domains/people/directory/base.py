"""Provider contract for directory sync backends.

`IdentitySource.config` is never consumed as a raw dict: each kind declares a
frozen dataclass here and `registry.parse_source_config` validates on every
Create/Update RPC and on every provider construction, so stored config stays
forward-compatible (new fields are additive with defaults).
"""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import ClassVar

from uniffy.core.models.people.identity import IdentitySourceKind
from uniffy.domains.people.directory.types import (
    DirectoryGroup,
    DirectoryUser,
    SourceCapabilities,
)


@dataclass(frozen=True)
class SourceConfig:
    """Base for per-kind non-secret config; secrets ride org_settings, never this."""


@dataclass(frozen=True)
class LocalSourceConfig(SourceConfig):
    pass


@dataclass(frozen=True)
class ScimSourceConfig(SourceConfig):
    """SCIM is push: the IdP calls our endpoint, so the bearer token (the
    source secret) is the whole configuration for now."""


@dataclass(frozen=True)
class LdapSourceConfig(SourceConfig):
    """Connection fields ship with the LDAP connector; empty keeps the kind
    creatable without guessing its shape now."""


@dataclass(frozen=True)
class OidcSourceConfig(SourceConfig):
    """Issuer / client fields ship with the OIDC login provider."""


class DirectorySyncProvider(ABC):
    """Enumeration plane for one configured source. A future ``AuthnProvider``
    (auth domain) resolves the same source row and secret for the login plane.
    """

    kind: ClassVar[IdentitySourceKind]
    capabilities: ClassVar[SourceCapabilities]

    def __init__(self, config: SourceConfig, secret: str | None) -> None:
        # The decrypted secret arrives at construction (registry.build_provider);
        # providers never read org_settings themselves.
        self._config = config
        self._secret = secret

    @abstractmethod
    def fetch_users(self) -> AsyncIterator[DirectoryUser]:
        """Async-iterate the backend's users; a 50k-user tenant must stream."""

    @abstractmethod
    def fetch_groups(self) -> AsyncIterator[DirectoryGroup]: ...

    @abstractmethod
    async def validate(self) -> None:
        """Raise a typed error when the source is unreachable or misconfigured."""
