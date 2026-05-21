"""Master cipher lifecycle + error handling."""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from uniffy.core.crypto.errors import MasterKeyMissingError
from uniffy.core.crypto.master import (
    app_decrypt,
    app_encrypt,
    get_master_cipher,
    reset_master_cipher_cache,
)


@pytest.fixture(autouse=True)
def _reset_master_cache():
    reset_master_cipher_cache()
    yield
    reset_master_cipher_cache()


def test_get_master_cipher_round_trip(monkeypatch: pytest.MonkeyPatch) -> None:
    key = Fernet.generate_key().decode("ascii")
    monkeypatch.setenv("APP_MASTER_KEY", key)
    cipher = get_master_cipher()
    token = cipher.encrypt(b"hello")
    assert cipher.decrypt(token) == b"hello"


def test_get_master_cipher_missing_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APP_MASTER_KEY", raising=False)
    with pytest.raises(MasterKeyMissingError):
        get_master_cipher()


def test_get_master_cipher_invalid_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_MASTER_KEY", "not-a-valid-fernet-key")
    with pytest.raises(MasterKeyMissingError):
        get_master_cipher()


def test_app_encrypt_decrypt_round_trip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_MASTER_KEY", Fernet.generate_key().decode("ascii"))
    ciphertext = app_encrypt("secret-payload")
    assert app_decrypt(ciphertext) == "secret-payload"


def test_app_decrypt_rejects_tampered_ciphertext(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from uniffy.core.crypto.errors import CryptoError

    monkeypatch.setenv("APP_MASTER_KEY", Fernet.generate_key().decode("ascii"))
    ciphertext = app_encrypt("secret-payload")
    tampered = ciphertext[:-4] + "AAAA"
    with pytest.raises(CryptoError):
        app_decrypt(tampered)
