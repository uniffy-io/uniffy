"""Per-org security settings (password reset toggle today; MFA + SSO + session policy later).

Thin wrapper over ``OrgSettingsOperations`` with ``namespace='security'``
plus typed accessors so callers do not stringly-name keys.
"""

from uniffy.domains.security.operations import (
    SECURITY_NAMESPACE,
    SecurityOperations,
    SecuritySettings,
)

__all__ = ["SECURITY_NAMESPACE", "SecurityOperations", "SecuritySettings"]
