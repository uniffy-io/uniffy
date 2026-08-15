"""End-to-end MailSender pipeline with the backend + DB stubbed out."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest

from uniffy.core.mail import (
    MailConfig,
    MailProviderError,
    MailSender,
    MailSuppressedError,
)
from uniffy.core.mail.backends.base import MailResult
from uniffy.core.types import generate_id


@asynccontextmanager
async def _fake_session():
    yield AsyncMock()


def _patch_resolver(config: MailConfig):
    return patch(
        "uniffy.core.mail.sender.MailConfigResolver.resolve",
        new=AsyncMock(return_value=config),
    )


def _patch_suppression(suppressed: bool):
    return patch(
        "uniffy.core.mail.sender.SuppressionRepository.is_suppressed",
        new=AsyncMock(return_value=suppressed),
    )


def _patch_rate_limit():
    return patch(
        "uniffy.core.mail.sender.check_send_rate_limit",
        new=AsyncMock(return_value=None),
    )


def _patch_backend(result: MailResult):
    backend = AsyncMock()
    backend.send = AsyncMock(return_value=result)
    return patch("uniffy.core.mail.sender.build_backend", return_value=backend), backend


def _patch_audit():
    return patch(
        "uniffy.core.mail.sender.write_audit_event",
        new=AsyncMock(return_value=None),
    )


CONFIG = MailConfig(
    from_address="no-reply@uniffy.io",
    from_name="Uniffy",
    smtp_host="smtp.test",
    smtp_port=587,
    smtp_use_tls=True,
    source="env",
)


class TestSender:
    async def test_happy_path_dispatches_through_backend(self) -> None:
        backend_patch, backend = _patch_backend(
            MailResult(success=True, provider_message_id="mid-1")
        )
        with (
            _patch_resolver(CONFIG),
            _patch_suppression(False),
            _patch_rate_limit(),
            backend_patch,
            _patch_audit(),
        ):
            sender = MailSender(session_factory=_fake_session)
            result = await sender.send(
                recipient_email="USER@Example.com",
                template_name="admin/test",
                context={"sent_at": "t", "config_source": "env", "org_name": ""},
                organization_id=None,
            )

        assert result.success is True
        assert result.provider_message_id == "mid-1"
        msg = backend.send.call_args.args[0]
        assert msg["To"] == "user@example.com"
        assert "Test email from Uniffy" in msg["Subject"]
        # multipart/alternative: text + html
        parts = list(msg.iter_parts())
        assert len(parts) == 2

    async def test_suppressed_recipient_raises_before_backend(self) -> None:
        backend_patch, backend = _patch_backend(MailResult(success=True))
        with (
            _patch_resolver(CONFIG),
            _patch_suppression(True),
            _patch_rate_limit(),
            backend_patch,
            _patch_audit(),
        ):
            sender = MailSender(session_factory=_fake_session)
            with pytest.raises(MailSuppressedError):
                await sender.send(
                    recipient_email="x@y.com",
                    template_name="admin/test",
                    context={"sent_at": "t", "config_source": "env"},
                )
        backend.send.assert_not_called()

    async def test_backend_failure_raises_provider_error(self) -> None:
        backend_patch, _backend = _patch_backend(MailResult(success=False, error="connect refused"))
        with (
            _patch_resolver(CONFIG),
            _patch_suppression(False),
            _patch_rate_limit(),
            backend_patch,
            _patch_audit(),
        ):
            sender = MailSender(session_factory=_fake_session)
            with pytest.raises(MailProviderError) as exc_info:
                await sender.send(
                    recipient_email="user@example.com",
                    template_name="admin/test",
                    context={"sent_at": "t", "config_source": "env"},
                )
        assert "connect refused" in str(exc_info.value)

    async def test_unknown_template_raises_before_resolver(self) -> None:
        from uniffy.core.mail import TemplateNotFoundError

        sender = MailSender(session_factory=_fake_session)
        with pytest.raises(TemplateNotFoundError):
            await sender.send(
                recipient_email="user@example.com",
                template_name="nope/missing",
                context={},
                organization_id=generate_id(),
            )


class TestSenderAudit:
    async def test_success_writes_mail_sent_event(self) -> None:
        from uniffy.core.audit.actions import Action

        backend_patch, _ = _patch_backend(MailResult(success=True, provider_message_id="mid-1"))
        audit_patch = _patch_audit()
        with (
            _patch_resolver(CONFIG),
            _patch_suppression(False),
            _patch_rate_limit(),
            backend_patch,
            audit_patch as audit_mock,
        ):
            sender = MailSender(session_factory=_fake_session)
            await sender.send(
                recipient_email="user@example.com",
                template_name="admin/test",
                context={"sent_at": "t", "config_source": "env", "org_name": ""},
            )

        actions = [call.kwargs["action"] for call in audit_mock.await_args_list]
        assert Action.MAIL_SENT in actions
        success_call = next(
            c for c in audit_mock.await_args_list if c.kwargs["action"] == Action.MAIL_SENT
        )
        assert success_call.kwargs["details"]["template"] == "admin/test"
        assert success_call.kwargs["details"]["provider_message_id"] == "mid-1"

    async def test_suppressed_writes_mail_suppressed_event(self) -> None:
        from uniffy.core.audit.actions import Action

        backend_patch, _ = _patch_backend(MailResult(success=True))
        audit_patch = _patch_audit()
        with (
            _patch_resolver(CONFIG),
            _patch_suppression(True),
            _patch_rate_limit(),
            backend_patch,
            audit_patch as audit_mock,
        ):
            sender = MailSender(session_factory=_fake_session)
            with pytest.raises(MailSuppressedError):
                await sender.send(
                    recipient_email="x@y.com",
                    template_name="admin/test",
                    context={"sent_at": "t", "config_source": "env"},
                )

        actions = [c.kwargs["action"] for c in audit_mock.await_args_list]
        assert Action.MAIL_SUPPRESSED in actions

    async def test_backend_failure_writes_mail_send_failed_event(self) -> None:
        from uniffy.core.audit.actions import Action

        backend_patch, _ = _patch_backend(MailResult(success=False, error="connect refused"))
        audit_patch = _patch_audit()
        with (
            _patch_resolver(CONFIG),
            _patch_suppression(False),
            _patch_rate_limit(),
            backend_patch,
            audit_patch as audit_mock,
        ):
            sender = MailSender(session_factory=_fake_session)
            with pytest.raises(MailProviderError):
                await sender.send(
                    recipient_email="user@example.com",
                    template_name="admin/test",
                    context={"sent_at": "t", "config_source": "env"},
                )

        actions = [c.kwargs["action"] for c in audit_mock.await_args_list]
        assert Action.MAIL_SEND_FAILED in actions
        fail_call = next(
            c for c in audit_mock.await_args_list if c.kwargs["action"] == Action.MAIL_SEND_FAILED
        )
        assert "connect refused" in fail_call.kwargs["details"]["error"]
