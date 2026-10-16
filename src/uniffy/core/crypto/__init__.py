"""Envelope encryption for secrets and server-side data at rest.

Per-org secrets go through ``OrgCipher``, per-org binary data the server keeps for itself
through ``OrgDataCipher``, and deployment-wide secrets (e.g. VAPID) through
``DeploymentCipher``. All of them key off DEKs wrapped with the master KEK.
"""

from uniffy.core.crypto.cache import (
    DeploymentDekCache,
    OrgActiveDekVersions,
    OrgDekLRU,
    get_deployment_dek_cache,
    get_org_active_dek_versions,
    get_org_data_key_lru,
    get_org_dek_lru,
    invalidate_org_dek_caches,
)
from uniffy.core.crypto.consumers import (
    CRYPTO_CONSUMERS,
    DEPLOYMENT_CRYPTO_CONSUMERS,
    DeploymentReEncryptingConsumer,
    ReEncryptingConsumer,
    register_consumer,
    register_deployment_consumer,
)
from uniffy.core.crypto.deployment_cipher import (
    DeploymentCipher,
    DeploymentEncryptionStatus,
    reset_deployment_cipher_cache,
)
from uniffy.core.crypto.errors import (
    CiphertextFormatError,
    CryptoError,
    MasterKeyMissingError,
    OrgDekNotFoundError,
    OrgDekVersionMismatchError,
    SealedDataError,
)
from uniffy.core.crypto.master import (
    get_master_cipher,
    reset_master_cipher_cache,
)
from uniffy.core.crypto.org_cipher import OrgCipher
from uniffy.core.crypto.org_data_cipher import (
    SEAL_OVERHEAD_BYTES,
    DatabaseKeySource,
    OrgDataCipher,
    OrgDataKeys,
    OrgKeySource,
    StaticKeySource,
)
from uniffy.core.crypto.pubsub import (
    close_dek_invalidation_subscriber,
    close_deployment_dek_invalidation_subscriber,
    publish_dek_invalidation,
    publish_deployment_dek_invalidation,
    subscribe_dek_invalidations,
    subscribe_deployment_dek_invalidations,
)
from uniffy.core.crypto.wrapping import generate_dek, unwrap_dek, wrap_dek

__all__ = [
    "CRYPTO_CONSUMERS",
    "CiphertextFormatError",
    "CryptoError",
    "DEPLOYMENT_CRYPTO_CONSUMERS",
    "DatabaseKeySource",
    "DeploymentCipher",
    "DeploymentDekCache",
    "DeploymentEncryptionStatus",
    "DeploymentReEncryptingConsumer",
    "MasterKeyMissingError",
    "OrgActiveDekVersions",
    "OrgCipher",
    "OrgDataCipher",
    "OrgDataKeys",
    "OrgDekLRU",
    "OrgDekNotFoundError",
    "OrgDekVersionMismatchError",
    "OrgKeySource",
    "ReEncryptingConsumer",
    "SEAL_OVERHEAD_BYTES",
    "SealedDataError",
    "StaticKeySource",
    "close_dek_invalidation_subscriber",
    "close_deployment_dek_invalidation_subscriber",
    "generate_dek",
    "get_deployment_dek_cache",
    "get_master_cipher",
    "get_org_active_dek_versions",
    "get_org_data_key_lru",
    "get_org_dek_lru",
    "invalidate_org_dek_caches",
    "publish_dek_invalidation",
    "publish_deployment_dek_invalidation",
    "register_consumer",
    "register_deployment_consumer",
    "reset_deployment_cipher_cache",
    "reset_master_cipher_cache",
    "subscribe_dek_invalidations",
    "subscribe_deployment_dek_invalidations",
    "unwrap_dek",
    "wrap_dek",
]
