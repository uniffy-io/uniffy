"""Data types for auth domain."""

from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class AuthResult:
    """Authentication result containing tokens and user context."""

    access_token: str
    refresh_token: str
    user_id: UUID
    organization_id: UUID | None = None
    organization_role: str | None = None  # MEMBER, ADMIN, or OWNER
    session_id: UUID | None = None
    domain_admin_domains: list[str] | None = None  # List of DomainType values


@dataclass(frozen=True)
class TokenPair:
    """A pair of access and refresh tokens."""

    access_token: str
    refresh_token: str
