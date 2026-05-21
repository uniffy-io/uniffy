"""DEK generation + master-cipher wrapping."""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from uniffy.core.crypto.errors import CryptoError
from uniffy.core.crypto.master import reset_master_cipher_cache
from uniffy.core.crypto.wrapping import generate_dek, unwrap_dek, wrap_dek


@pytest.fixture(autouse=True)
def _set_master_key(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_MASTER_KEY", Fernet.generate_key().decode("ascii"))
    reset_master_cipher_cache()
    yield
    reset_master_cipher_cache()


def test_generate_dek_is_fernet_loadable() -> None:
    dek = generate_dek()
    Fernet(dek)


def test_generate_dek_unique() -> None:
    assert generate_dek() != generate_dek()


def test_wrap_unwrap_round_trip() -> None:
    dek = generate_dek()
    wrapped = wrap_dek(dek)
    assert unwrap_dek(wrapped) == dek


def test_unwrap_rejects_tampered_wrapped() -> None:
    wrapped = wrap_dek(generate_dek())
    tampered = wrapped[:-4] + "AAAA"
    with pytest.raises(CryptoError):
        unwrap_dek(tampered)


def test_wrap_changes_each_call() -> None:
    dek = generate_dek()
    assert wrap_dek(dek) != wrap_dek(dek)
