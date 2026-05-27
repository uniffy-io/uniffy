"""
Auth domain - authentication only.

This domain handles:
- User authentication (login, register, token refresh)
- Token management

Note: User, organization, and group management have been moved to their
respective domains: uniffy.domains.users, uniffy.domains.organizations,
and uniffy.domains.groups.
"""

from uniffy.domains.auth.context import (
    get_organization_id_from_context,
    get_user_id_from_context,
)
from uniffy.domains.auth.errors import (
    AuthenticationError,
    OrganizationAccessError,
    RegistrationError,
    TokenError,
)
from uniffy.domains.auth.handlers import AuthHandlers

# Side-effect import: registers the DeploymentReEncryptingConsumer for
# the login_user_mfa.totp_secret_encrypted column so deployment-DEK
# rotation re-encrypts MFA secrets without further wiring.
from uniffy.domains.auth.mfa import crypto as _mfa_crypto  # noqa: F401
from uniffy.domains.auth.operations import AuthOperations
from uniffy.domains.auth.passwords import hash_password, verify_password
from uniffy.domains.auth.service import AuthServiceImpl
from uniffy.domains.auth.tokens import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
)
from uniffy.domains.auth.types import AuthResult, TokenPair

__all__ = [
    "get_user_id_from_context",
    "get_organization_id_from_context",
    "hash_password",
    "verify_password",
    "create_access_token",
    "create_refresh_token",
    "decode_access_token",
    "AuthResult",
    "TokenPair",
    "AuthenticationError",
    "RegistrationError",
    "TokenError",
    "OrganizationAccessError",
    "AuthOperations",
    "AuthHandlers",
    # Service (for mounting)
    "AuthServiceImpl",
]
