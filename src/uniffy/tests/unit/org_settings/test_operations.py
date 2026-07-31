"""Generic OrgSettingsOperations CRUD with the cipher + session mocked."""

import asyncio
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from uniffy.domains.org_settings.operations import OrgSettingsOperations


def _run(coro):
    return asyncio.run(coro)


@dataclass
class _Row:
    key: str
    value: Any = None
    value_encrypted: str | None = None
    is_secret: bool = False


def _session(rows: list[_Row] | _Row | None = None):
    s = AsyncMock()
    if isinstance(rows, list):
        scalars = AsyncMock()
        scalars.all = lambda: rows
        result = AsyncMock()
        result.scalars = lambda: scalars
    else:
        result = AsyncMock()
        result.scalar_one_or_none = lambda: rows
    s.execute = AsyncMock(return_value=result)
    return s


def _patch_cipher(*, encrypt_to: str = "v1:cipher", decrypt_to: str = "plain"):
    cipher = AsyncMock()
    cipher.encrypt = AsyncMock(return_value=encrypt_to)
    cipher.decrypt = AsyncMock(return_value=decrypt_to)
    return patch(
        "uniffy.domains.org_settings.operations.OrgCipher",
        return_value=cipher,
    ), cipher


class TestGetNamespace:
    def test_returns_keyed_map(self) -> None:
        org_id = uuid4()
        rows = [
            _Row("from_address", value="x@y.com"),
            _Row("smtp_host", value="smtp.test"),
        ]
        session = _session(rows)
        patcher, _cipher = _patch_cipher()
        with patcher:
            ops = OrgSettingsOperations(session)
            out = _run(ops.get_namespace(org_id, "mail"))
        assert set(out) == {"from_address", "smtp_host"}
        assert out["from_address"].value == "x@y.com"


class TestSet:
    def test_plain_row_writes_value_column(self) -> None:
        session = _session()
        patcher, cipher = _patch_cipher()
        with patcher:
            ops = OrgSettingsOperations(session)
            _run(
                ops.set(
                    organization_id=uuid4(),
                    namespace="mail",
                    key="from_address",
                    value="no-reply@uniffy.io",
                    is_secret=False,
                )
            )
        cipher.encrypt.assert_not_awaited()
        stmt = session.execute.call_args.args[0]
        values = stmt.compile().params
        assert values["value"] == "no-reply@uniffy.io"
        assert values["value_encrypted"] is None
        assert values["is_secret"] is False
        assert values["namespace"] == "mail"
        assert values["key"] == "from_address"

    def test_secret_row_encrypts_and_writes_ciphertext_column(self) -> None:
        session = _session()
        patcher, cipher = _patch_cipher(encrypt_to="v1:abc")
        with patcher:
            ops = OrgSettingsOperations(session)
            _run(
                ops.set(
                    organization_id=uuid4(),
                    namespace="mail",
                    key="smtp_password",
                    value="supersecret",
                    is_secret=True,
                )
            )
        cipher.encrypt.assert_awaited_once_with(
            cipher.encrypt.await_args.args[0], "supersecret"
        )
        stmt = session.execute.call_args.args[0]
        values = stmt.compile().params
        assert values["value"] is None
        assert values["value_encrypted"] == "v1:abc"
        assert values["is_secret"] is True
        # plaintext must never be passed as a bound parameter
        assert "supersecret" not in {
            v for v in values.values() if isinstance(v, str)
        }

    def test_secret_rejects_non_string_value(self) -> None:
        session = _session()
        patcher, _cipher = _patch_cipher()
        with patcher:
            ops = OrgSettingsOperations(session)
            with pytest.raises(TypeError):
                _run(
                    ops.set(
                        organization_id=uuid4(),
                        namespace="mail",
                        key="smtp_password",
                        value=12345,
                        is_secret=True,
                    )
                )


class TestGetSecret:
    def test_returns_decrypted_plaintext(self) -> None:
        row = _Row(
            "smtp_password",
            value_encrypted="v1:cipher",
            is_secret=True,
        )
        session = _session(row)
        patcher, _cipher = _patch_cipher(decrypt_to="real-password")
        with patcher:
            ops = OrgSettingsOperations(session)
            out = _run(ops.get_secret(uuid4(), "mail", "smtp_password"))
        assert out == "real-password"

    def test_returns_none_for_missing_or_non_secret(self) -> None:
        patcher, _cipher = _patch_cipher()
        with patcher:
            ops = OrgSettingsOperations(_session(None))
            assert _run(ops.get_secret(uuid4(), "mail", "smtp_password")) is None

        plain_row = _Row("from_address", value="x@y.com", is_secret=False)
        with patcher:
            ops = OrgSettingsOperations(_session(plain_row))
            assert _run(ops.get_secret(uuid4(), "mail", "from_address")) is None


class TestDelete:
    def test_delete_key_returns_true_on_hit(self) -> None:
        session = AsyncMock()
        result = AsyncMock()
        result.rowcount = 1
        session.execute = AsyncMock(return_value=result)
        patcher, _cipher = _patch_cipher()
        with patcher:
            ops = OrgSettingsOperations(session)
            assert _run(
                ops.delete_key(
                    organization_id=uuid4(),
                    namespace="mail",
                    key="from_address",
                )
            ) is True

    def test_delete_namespace_returns_count(self) -> None:
        session = AsyncMock()
        result = AsyncMock()
        result.rowcount = 5
        session.execute = AsyncMock(return_value=result)
        patcher, _cipher = _patch_cipher()
        with patcher:
            ops = OrgSettingsOperations(session)
            assert _run(
                ops.delete_namespace(organization_id=uuid4(), namespace="mail")
            ) == 5


class TestConsumerRegistration:
    def test_org_settings_is_registered(self) -> None:
        from uniffy.core.crypto import CRYPTO_CONSUMERS

        names = {c.name for c in CRYPTO_CONSUMERS}
        assert "org_settings" in names
