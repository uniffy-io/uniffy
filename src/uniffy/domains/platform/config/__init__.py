"""Platform operator RPCs for deployment-wide configuration."""

from uniffy.domains.platform.config.operations import SystemConfigOperations
from uniffy.domains.platform.config.service import SystemConfigServiceImpl

__all__ = [
    "SystemConfigOperations",
    "SystemConfigServiceImpl",
]
