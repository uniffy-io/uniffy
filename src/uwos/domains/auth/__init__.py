"""
Auth domain - authentication only.

This domain handles:
- User authentication (login, register, token refresh)
- Token management

Note: User, organization, and group management have been moved to their
respective domains: uwos.domains.users, uwos.domains.organizations,
and uwos.domains.groups.
"""

from uwos.domains.auth.context import (
    get_organization_id_from_context,
    get_user_id_from_context,
)
from uwos.domains.auth.errors import (
    AuthenticationError,
    OrganizationAccessError,
    RegistrationError,
    TokenError,
)
from uwos.domains.auth.handlers import AuthHandlers
from uwos.domains.auth.operations import AuthOperations
from uwos.domains.auth.passwords import hash_password, verify_password
from uwos.domains.auth.service import AuthServiceImpl
from uwos.domains.auth.tokens import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
)
from uwos.domains.auth.types import AuthResult, TokenPair

__all__ = [
    # Context
    "get_user_id_from_context",
    "get_organization_id_from_context",
    # Passwords
    "hash_password",
    "verify_password",
    # Tokens
    "create_access_token",
    "create_refresh_token",
    "decode_access_token",
    # Types
    "AuthResult",
    "TokenPair",
    # Errors
    "AuthenticationError",
    "RegistrationError",
    "TokenError",
    "OrganizationAccessError",
    # Operations
    "AuthOperations",
    # Handlers
    "AuthHandlers",
    # Service (for mounting)
    "AuthServiceImpl",
]
