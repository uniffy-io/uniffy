"""Envelope encryption for per-org secrets.

``app_encrypt`` / ``app_decrypt`` (Fernet on ``APP_MASTER_KEY``) is reserved
for genuinely app-wide secrets like VAPID; everything else is per-org through
``OrgCipher``.
"""

from uniffy.core.crypto.cache import (
    DeploymentDekCache,
    OrgDekLRU,
    get_deployment_dek_cache,
    get_org_dek_lru,
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
)
from uniffy.core.crypto.master import (
    app_decrypt,
    app_encrypt,
    get_master_cipher,
    reset_master_cipher_cache,
)
from uniffy.core.crypto.org_cipher import OrgCipher
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
    "DeploymentCipher",
    "DeploymentDekCache",
    "DeploymentEncryptionStatus",
    "DeploymentReEncryptingConsumer",
    "MasterKeyMissingError",
    "OrgCipher",
    "OrgDekLRU",
    "OrgDekNotFoundError",
    "OrgDekVersionMismatchError",
    "ReEncryptingConsumer",
    "app_decrypt",
    "app_encrypt",
    "close_dek_invalidation_subscriber",
    "close_deployment_dek_invalidation_subscriber",
    "generate_dek",
    "get_deployment_dek_cache",
    "get_master_cipher",
    "get_org_dek_lru",
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
