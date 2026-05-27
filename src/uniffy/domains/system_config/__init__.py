"""Deployment-wide configuration flags edited from `/platform/server-settings`.

Each flag resolves through the same chain: ``deployment_settings`` row >
env default > coded default. Writes always go to the DB row; env is
only the seed value used when no operator decision has been made yet.
"""

from uniffy.domains.system_config.operations import (
    SystemConfigOperations,
    SystemFlagState,
    public_registration_enabled,
)
from uniffy.domains.system_config.service import SystemConfigServiceImpl

__all__ = [
    "SystemConfigOperations",
    "SystemConfigServiceImpl",
    "SystemFlagState",
    "public_registration_enabled",
]
