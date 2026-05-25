"""SmtpBackend payload + TLS-mode tests with aiosmtplib mocked."""

import asyncio
from email.message import EmailMessage
from unittest.mock import AsyncMock, patch

import aiosmtplib

from uniffy.core.mail.backends.smtp import SmtpBackend
from uniffy.core.mail.config import MailConfig


def _run(coro):
    return asyncio.run(coro)


def _msg() -> EmailMessage:
    m = EmailMessage()
    m["Subject"] = "hi"
    m["To"] = "user@example.com"
    m["From"] = "Uniffy <no-reply@uniffy.io>"
    m.set_content("hello")
    m.add_alternative("<p>hello</p>", subtype="html")
    return m


def _cfg(**overrides) -> MailConfig:
    base = {
        "from_address": "no-reply@uniffy.io",
        "smtp_host": "smtp.example.com",
        "smtp_port": 587,
        "smtp_username": "user",
        "smtp_password": "pass",
        "smtp_use_tls": True,
    }
    base.update(overrides)
    return MailConfig(**base)


class TestSmtpBackend:
    def test_port_587_uses_starttls(self) -> None:
        with patch.object(
            aiosmtplib, "send", new=AsyncMock(return_value=({}, "ok 250"))
        ) as send_mock:
            backend = SmtpBackend(_cfg(smtp_port=587))
            result = _run(backend.send(_msg(), idempotency_key="abc"))

        assert result.success is True
        assert result.provider_message_id == "ok 250"
        kwargs = send_mock.call_args.kwargs
        assert kwargs["hostname"] == "smtp.example.com"
        assert kwargs["port"] == 587
        assert kwargs["username"] == "user"
        assert kwargs["password"] == "pass"
        assert kwargs.get("start_tls") is True
        assert "use_tls" not in kwargs

    def test_port_465_uses_implicit_tls(self) -> None:
        with patch.object(aiosmtplib, "send", new=AsyncMock(return_value=({}, "ok"))) as send_mock:
            backend = SmtpBackend(_cfg(smtp_port=465))
            _run(backend.send(_msg()))
        kwargs = send_mock.call_args.kwargs
        assert kwargs.get("use_tls") is True
        assert "start_tls" not in kwargs

    def test_use_tls_false_skips_both_flags(self) -> None:
        with patch.object(aiosmtplib, "send", new=AsyncMock(return_value=({}, "ok"))) as send_mock:
            backend = SmtpBackend(_cfg(smtp_use_tls=False))
            _run(backend.send(_msg()))
        kwargs = send_mock.call_args.kwargs
        assert "start_tls" not in kwargs
        assert "use_tls" not in kwargs

    def test_per_recipient_errors_surface_as_failure(self) -> None:
        with patch.object(
            aiosmtplib,
            "send",
            new=AsyncMock(return_value=({"x@y.com": (550, "blocked")}, "")),
        ):
            backend = SmtpBackend(_cfg())
            result = _run(backend.send(_msg()))
        assert result.success is False
        assert "blocked" in (result.error or "")

    def test_smtp_exception_surfaces_as_failure(self) -> None:
        with patch.object(
            aiosmtplib,
            "send",
            new=AsyncMock(side_effect=aiosmtplib.SMTPException("network down")),
        ):
            backend = SmtpBackend(_cfg())
            result = _run(backend.send(_msg()))
        assert result.success is False
        assert "network down" in (result.error or "")

    def test_idempotency_key_added_as_header(self) -> None:
        captured: dict = {}

        async def fake_send(msg, **_kwargs):
            captured["msg"] = msg
            return ({}, "ok")

        with patch.object(aiosmtplib, "send", new=AsyncMock(side_effect=fake_send)):
            backend = SmtpBackend(_cfg())
            _run(backend.send(_msg(), idempotency_key="reset/123"))
        assert captured["msg"]["X-Idempotency-Key"] == "reset/123"
