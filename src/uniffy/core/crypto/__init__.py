"""Cryptography primitives: envelope encryption for per-org secrets.

Public surface:

- ``OrgCipher`` -- per-org encrypt / decrypt / provision / rotate.
- ``get_master_cipher`` / ``app_encrypt`` / ``app_decrypt`` -- Fernet
  keyed on ``APP_MASTER_KEY``. Use ``app_encrypt`` / ``app_decrypt``
  only for genuinely app-wide secrets (VAPID); everything else is
  per-org and goes through ``OrgCipher``.
- DEK helpers: ``generate_dek``, ``wrap_dek``, ``unwrap_dek``.
- Pubsub: ``publish_dek_invalidation``, ``subscribe_dek_invalidations``,
  ``close_dek_invalidation_subscriber``.
- ``ReEncryptingConsumer`` + ``register_consumer`` -- per-domain
  registration so rotation can sweep every encrypted column.
- Error hierarchy: ``CryptoError`` (base), ``MasterKeyMissingError``,
  ``OrgDekNotFoundError``, ``OrgDekVersionMismatchError``,
  ``CiphertextFormatError``.
"""

from uniffy.core.crypto.cache import OrgDekLRU, get_org_dek_lru
from uniffy.core.crypto.consumers import (
    CRYPTO_CONSUMERS,
    ReEncryptingConsumer,
    register_consumer,
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
    publish_dek_invalidation,
    subscribe_dek_invalidations,
)
from uniffy.core.crypto.wrapping import generate_dek, unwrap_dek, wrap_dek

__all__ = [
    "CRYPTO_CONSUMERS",
    "CiphertextFormatError",
    "CryptoError",
    "MasterKeyMissingError",
    "OrgCipher",
    "OrgDekLRU",
    "OrgDekNotFoundError",
    "OrgDekVersionMismatchError",
    "ReEncryptingConsumer",
    "app_decrypt",
    "app_encrypt",
    "close_dek_invalidation_subscriber",
    "generate_dek",
    "get_master_cipher",
    "get_org_dek_lru",
    "publish_dek_invalidation",
    "register_consumer",
    "reset_master_cipher_cache",
    "subscribe_dek_invalidations",
    "unwrap_dek",
    "wrap_dek",
]
