"""ARQ ``send_email`` task: happy path and error routing.

The underlying ``MailSender`` is patched so the test exercises the
task's translation of typed errors into ARQ retry semantics rather
than the full pipeline (covered by ``test_sender.py``).
"""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from arq import Retry

from uniffy.core.mail import (
    MailNotConfiguredError,
    MailProviderError,
    MailRateLimitedError,
    MailSuppressedError,
)
from uniffy.core.mail.backends.base import MailResult
from uniffy.workers.tasks.mail import send_email


def _run(coro):
    return asyncio.run(coro)


class TestSendEmailTask:
    def test_happy_path_returns_sent(self) -> None:
        sender_mock = AsyncMock()
        sender_mock.send = AsyncMock(
            return_value=MailResult(success=True, provider_message_id="msg-1")
        )
        with patch("uniffy.workers.tasks.mail._get_sender", return_value=sender_mock):
            result = _run(
                send_email(
                    {"job_try": 1},
                    "user@example.com",
                    "admin/test",
                    '{"sent_at":"now","config_source":"env"}',
                    organization_id=None,
                    idempotency_key="key-1",
                )
            )
        assert result == {"status": "sent", "provider_message_id": "msg-1"}
        kwargs = sender_mock.send.call_args.kwargs
        assert kwargs["recipient_email"] == "user@example.com"
        assert kwargs["organization_id"] is None
        assert kwargs["idempotency_key"] == "key-1"

    def test_invalid_context_json_returns_failed(self) -> None:
        result = _run(
            send_email(
                {"job_try": 1},
                "user@example.com",
                "admin/test",
                "{not json",
            )
        )
        assert result == {"status": "failed", "reason": "invalid_context_json"}

    def test_suppressed_is_terminal(self) -> None:
        sender_mock = AsyncMock()
        sender_mock.send = AsyncMock(side_effect=MailSuppressedError("blocked"))
        with patch("uniffy.workers.tasks.mail._get_sender", return_value=sender_mock):
            result = _run(send_email({"job_try": 1}, "a@b.com", "admin/test", "{}"))
        assert result["status"] == "suppressed"

    def test_not_configured_is_terminal(self) -> None:
        sender_mock = AsyncMock()
        sender_mock.send = AsyncMock(side_effect=MailNotConfiguredError("no env"))
        with patch("uniffy.workers.tasks.mail._get_sender", return_value=sender_mock):
            result = _run(send_email({"job_try": 1}, "a@b.com", "admin/test", "{}"))
        assert result["status"] == "skipped"
        assert result["reason"] == "not_configured"

    def test_rate_limited_raises_retry(self) -> None:
        sender_mock = AsyncMock()
        sender_mock.send = AsyncMock(side_effect=MailRateLimitedError("over"))
        with (
            patch("uniffy.workers.tasks.mail._get_sender", return_value=sender_mock),
            pytest.raises(Retry) as exc_info,
        ):
            _run(send_email({"job_try": 3}, "a@b.com", "admin/test", "{}"))
        assert exc_info.value.defer_score == 90 * 1000

    def test_provider_error_raises_retry(self) -> None:
        sender_mock = AsyncMock()
        sender_mock.send = AsyncMock(side_effect=MailProviderError("smtp down"))
        with (
            patch("uniffy.workers.tasks.mail._get_sender", return_value=sender_mock),
            pytest.raises(Retry) as exc_info,
        ):
            _run(send_email({"job_try": 2}, "a@b.com", "admin/test", "{}"))
        assert exc_info.value.defer_score == 120 * 1000
