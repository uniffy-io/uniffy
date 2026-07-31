"""OrgCipher parsing + framing behaviour (no DB).

End-to-end encrypt/decrypt round-trips with real DB live in the
integration test suite -- this module pins the ciphertext format,
version parsing, and error mapping.
"""

from __future__ import annotations

import pytest

from uniffy.core.crypto.errors import CiphertextFormatError
from uniffy.core.crypto.org_cipher import OrgCipher


def test_parse_extracts_version_and_payload() -> None:
    version, payload = OrgCipher._parse("v3:abcDEF.fernet-token")
    assert version == 3
    assert payload == "abcDEF.fernet-token"


def test_parse_rejects_missing_prefix() -> None:
    with pytest.raises(CiphertextFormatError):
        OrgCipher._parse("gAAAAAtokenWithoutPrefix")


def test_parse_rejects_empty_payload() -> None:
    with pytest.raises(CiphertextFormatError):
        OrgCipher._parse("v1:")


def test_parse_rejects_non_numeric_version() -> None:
    with pytest.raises(CiphertextFormatError):
        OrgCipher._parse("vABC:payload")


def test_parse_rejects_empty_ciphertext() -> None:
    with pytest.raises(CiphertextFormatError):
        OrgCipher._parse("")
