"""Resolver logic: org KV rows vs env vs missing.

The DB session is stubbed via ``AsyncMock``; we exercise the branching
logic without touching Postgres. Per-org mail config lives in the
generic ``org_settings`` table under ``namespace='mail'``.
"""

import asyncio
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from uniffy.core.mail import MailNotConfiguredError
from uniffy.core.mail.resolver import MailConfigResolver


def _run(coro):
    return asyncio.run(coro)


@dataclass
class _Row:
    key: str
    value: Any = None
    value_encrypted: str | None = None
    is_secret: bool = False


def _session_returning(rows: list[_Row]):
    session = AsyncMock()
    scalars_obj = AsyncMock()
    scalars_obj.all = lambda: rows
    result = AsyncMock()
    result.scalars = lambda: scalars_obj
    session.execute = AsyncMock(return_value=result)
    return session


def _miss():
    from uniffy.core.valkey.cache import CACHE_MISS

    return CACHE_MISS


class TestResolveFromOrgRows:
    def test_org_rows_win_over_env(self, monkeypatch) -> None:
        monkeypatch.setenv("MAIL_FROM_ADDRESS", "env@uniffy.local")
        monkeypatch.setenv("SMTP_HOST", "env-smtp")

        org_id = uuid4()
        rows = [
            _Row("from_address", value="org@acme.com"),
            _Row("from_name", value="Acme"),
            _Row("smtp_host", value="smtp.acme.com"),
            _Row("smtp_port", value=2525),
            _Row("smtp_username", value="acme"),
            _Row(
                "smtp_password",
                value=None,
                value_encrypted="v1:ciphertext",
                is_secret=True,
            ),
            _Row("smtp_use_tls", value=True),
        ]
        session = _session_returning(rows)

        with patch(
            "uniffy.core.mail.resolver.cache_get",
            new=AsyncMock(return_value=_miss()),
        ), patch(
            "uniffy.core.mail.resolver.cache_set", new=AsyncMock()
        ), patch("uniffy.core.mail.resolver.OrgCipher") as cipher_cls:
            cipher = AsyncMock()
            cipher.decrypt = AsyncMock(return_value="plain-secret")
            cipher_cls.return_value = cipher
            resolver = MailConfigResolver(session)
            cfg = _run(resolver.resolve(org_id))

        assert cfg.from_address == "org@acme.com"
        assert cfg.from_name == "Acme"
        assert cfg.smtp_host == "smtp.acme.com"
        assert cfg.smtp_port == 2525
        assert cfg.smtp_password == "plain-secret"
        assert cfg.source == "org"

    def test_partial_org_rows_fall_back_to_env(self, monkeypatch) -> None:
        monkeypatch.setenv("MAIL_FROM_ADDRESS", "sys@uniffy.local")
        monkeypatch.setenv("SMTP_HOST", "smtp.local")

        rows = [
            _Row("from_address", value="org@acme.com"),
        ]
        session = _session_returning(rows)

        with patch(
            "uniffy.core.mail.resolver.cache_get",
            new=AsyncMock(return_value=_miss()),
        ), patch("uniffy.core.mail.resolver.cache_set", new=AsyncMock()):
            resolver = MailConfigResolver(session)
            cfg = _run(resolver.resolve(uuid4()))

        assert cfg.source == "env"
        assert cfg.from_address == "sys@uniffy.local"

    def test_no_rows_falls_back_to_env(self, monkeypatch) -> None:
        monkeypatch.setenv("MAIL_FROM_ADDRESS", "sys@uniffy.local")
        monkeypatch.setenv("SMTP_HOST", "smtp.local")
        monkeypatch.setenv("SMTP_PORT", "2525")

        session = _session_returning([])
        with patch(
            "uniffy.core.mail.resolver.cache_get",
            new=AsyncMock(return_value=_miss()),
        ), patch("uniffy.core.mail.resolver.cache_set", new=AsyncMock()):
            resolver = MailConfigResolver(session)
            cfg = _run(resolver.resolve(uuid4()))

        assert cfg.from_address == "sys@uniffy.local"
        assert cfg.smtp_port == 2525
        assert cfg.source == "env"

    def test_no_rows_no_env_raises(self, monkeypatch) -> None:
        monkeypatch.delenv("MAIL_FROM_ADDRESS", raising=False)
        monkeypatch.delenv("SMTP_HOST", raising=False)

        session = _session_returning([])
        with patch(
            "uniffy.core.mail.resolver.cache_get",
            new=AsyncMock(return_value=_miss()),
        ), patch("uniffy.core.mail.resolver.cache_set", new=AsyncMock()):
            resolver = MailConfigResolver(session)
            with pytest.raises(MailNotConfiguredError):
                _run(resolver.resolve(uuid4()))

    def test_none_org_skips_db(self, monkeypatch) -> None:
        monkeypatch.setenv("MAIL_FROM_ADDRESS", "sys@uniffy.local")
        monkeypatch.setenv("SMTP_HOST", "smtp.local")

        session = AsyncMock()
        session.execute = AsyncMock()
        with patch(
            "uniffy.core.mail.resolver.cache_get",
            new=AsyncMock(return_value=_miss()),
        ), patch("uniffy.core.mail.resolver.cache_set", new=AsyncMock()):
            resolver = MailConfigResolver(session)
            cfg = _run(resolver.resolve(None))

        assert cfg.source == "env"
        session.execute.assert_not_awaited()


class TestCache:
    def test_cache_hit_skips_db(self) -> None:
        session = AsyncMock()
        cached_payload = {
            "from_address": "cached@uniffy.io",
            "from_name": "Uniffy",
            "smtp_host": "cached-host",
            "smtp_port": 587,
            "smtp_use_tls": True,
            "rate_limit_per_min": 100,
            "source": "org",
        }
        with patch(
            "uniffy.core.mail.resolver.cache_get",
            new=AsyncMock(return_value=cached_payload),
        ):
            resolver = MailConfigResolver(session)
            cfg = _run(resolver.resolve(uuid4()))
        assert cfg.from_address == "cached@uniffy.io"
        session.execute.assert_not_called()
