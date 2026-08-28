"""Platform-operator RPCs for the deployment-singleton DEK.

Read-only status + rotation. Rotation re-encrypts every registered
deployment-scope secret under a fresh DEK, publishes a cross-pod
cache invalidation, and writes an audit row.
"""

from uniffy.domains.platform.encryption.operations import SystemEncryptionOperations
from uniffy.domains.platform.encryption.service import SystemEncryptionServiceImpl

__all__ = ["SystemEncryptionOperations", "SystemEncryptionServiceImpl"]
