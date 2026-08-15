"""Integration framework core: descriptor, provider ABC, typed errors."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import TYPE_CHECKING, ClassVar

from uniffy.core.errors import UNIFFYError
from uniffy.domains.agents.tools.definitions import ToolDefinition

if TYPE_CHECKING:
    from uniffy.domains.integrations.http import IntegrationHttpClient


class IntegrationError(UNIFFYError):
    """Base for integration transport and API failures."""


class IntegrationAuthError(IntegrationError):
    """Credential rejected (401); the auto-demote signal for the stored row."""


class IntegrationApiError(IntegrationError):
    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class IntegrationUnavailableError(IntegrationError):
    """Raised while the connection's circuit breaker is open."""


@dataclass(frozen=True)
class IntegrationDescriptor:
    """Static identity of one shipped provider; ``id`` is also the tool-name prefix."""

    id: str
    label: str
    default_base_url: str
    credential_placeholder: str
    credential_docs_url: str
    supports_base_url_override: bool = True
    credential_kind: str = "token"


@dataclass(frozen=True)
class IntegrationProbeResult:
    is_valid: bool
    error: str | None = None
    account_login: str | None = None


class IntegrationProvider(ABC):
    """One external service: validation probe, client construction, tool pack."""

    descriptor: ClassVar[IntegrationDescriptor]

    @abstractmethod
    def build_http_client(self, credential: str, base_url: str | None) -> IntegrationHttpClient: ...

    @abstractmethod
    async def validate(self, credential: str, base_url: str | None) -> IntegrationProbeResult: ...

    @abstractmethod
    def tools(self) -> list[ToolDefinition]: ...
