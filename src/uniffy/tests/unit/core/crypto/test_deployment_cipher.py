"""DeploymentCipher parsing + framing behaviour (no DB).

Round-trip and rotation tests live in the integration suite because
they need a live DB. This module pins the wire format, version
parsing, and error mapping.
"""

from __future__ import annotations

import pytest

from uniffy.core.crypto.deployment_cipher import DeploymentCipher
from uniffy.core.crypto.errors import CiphertextFormatError


def test_parse_extracts_version_and_payload() -> None:
    version, payload = DeploymentCipher._parse("v5:abc.fernet-token")
    assert version == 5
    assert payload == "abc.fernet-token"


def test_parse_rejects_missing_prefix() -> None:
    with pytest.raises(CiphertextFormatError):
        DeploymentCipher._parse("gAAAAAtokenWithoutPrefix")


def test_parse_rejects_empty_payload() -> None:
    with pytest.raises(CiphertextFormatError):
        DeploymentCipher._parse("v1:")


def test_parse_rejects_non_numeric_version() -> None:
    with pytest.raises(CiphertextFormatError):
        DeploymentCipher._parse("vABC:payload")


def test_parse_rejects_empty_ciphertext() -> None:
    with pytest.raises(CiphertextFormatError):
        DeploymentCipher._parse("")
