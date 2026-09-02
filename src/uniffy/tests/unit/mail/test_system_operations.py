"""Unit tests for :mod:`uniffy.domains.mail.system.operations`.

Hits the pure / validation paths with mocked dependencies so the suite
stays fast and doesn't require a live database. The integration path
(actual SQL execution, audit row write) is exercised indirectly via the
RPC handler tests in a separate suite.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.audit.actions import Action
from uniffy.core.errors import ValidationError
from uniffy.core.types import generate_id
from uniffy.domains.mail.system.operations import (
    SystemMailOperations,
    _flatten_delivery,
    _outcome_actions,
    _system_summary_from_env,
)


class TestSystemSummaryFromEnv:
    def test_returns_unconfigured_when_env_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("MAIL_FROM_ADDRESS", raising=False)
        monkeypatch.delenv("SMTP_HOST", raising=False)
        monkeypatch.delenv("SMTP_PASSWORD", raising=False)

        summary = _system_summary_from_env()

        assert summary.configured is False
        assert summary.from_address == ""
        assert summary.smtp_password_set is False

    def test_returns_configured_summary_when_env_present(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("MAIL_FROM_ADDRESS", "noreply@example.com")
        monkeypatch.setenv("MAIL_FROM_NAME", "Example")
        monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
        monkeypatch.setenv("SMTP_PORT", "2525")
        monkeypatch.setenv("SMTP_USERNAME", "user")
        monkeypatch.setenv("SMTP_PASSWORD", "secret")
        monkeypatch.setenv("SMTP_USE_TLS", "false")
        monkeypatch.setenv("MAIL_RATE_LIMIT_PER_MIN", "42")

        summary = _system_summary_from_env()

        assert summary.configured is True
        assert summary.from_address == "noreply@example.com"
        assert summary.from_name == "Example"
        assert summary.smtp_host == "smtp.example.com"
        assert summary.smtp_port == 2525
        assert summary.smtp_username == "user"
        assert summary.smtp_password_set is True
        assert summary.smtp_use_tls is False
        assert summary.rate_limit_per_min == 42

    def test_password_set_flag_only_reads_env_presence(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("MAIL_FROM_ADDRESS", "noreply@example.com")
        monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
        monkeypatch.delenv("SMTP_PASSWORD", raising=False)

        summary = _system_summary_from_env()

        assert summary.configured is True
        assert summary.smtp_password_set is False


class TestOutcomeActions:
    def test_sent_maps_to_mail_sent(self) -> None:
        assert _outcome_actions("sent") == [Action.MAIL_SENT]

    def test_failed_maps_to_send_failed(self) -> None:
        assert _outcome_actions("failed") == [Action.MAIL_SEND_FAILED]

    def test_suppressed_maps_to_suppressed(self) -> None:
        assert _outcome_actions("suppressed") == [Action.MAIL_SUPPRESSED]

    def test_empty_returns_all_three(self) -> None:
        actions = _outcome_actions("")
        assert set(actions) == {
            Action.MAIL_SENT,
            Action.MAIL_SEND_FAILED,
            Action.MAIL_SUPPRESSED,
        }

    def test_unknown_returns_all_three(self) -> None:
        actions = _outcome_actions("nonsense")
        assert set(actions) == {
            Action.MAIL_SENT,
            Action.MAIL_SEND_FAILED,
            Action.MAIL_SUPPRESSED,
        }

    def test_case_insensitive(self) -> None:
        assert _outcome_actions("  SENT ") == [Action.MAIL_SENT]


class TestFlattenDelivery:
    def test_extracts_recipient_from_known_keys(self) -> None:
        event = MagicMock()
        event.id = generate_id()
        event.created_at = "2026-05-25T12:00:00Z"
        event.action = Action.MAIL_SENT
        event.organization_id = generate_id()
        event.details = {
            "config_source": "org",
            "recipient_email": "user@example.com",
            "template_name": "auth/invite",
            "provider_message_id": "msg-1",
        }

        row = _flatten_delivery(event, org_name="Acme")

        assert row.organization_name == "Acme"
        assert row.recipient == "user@example.com"
        assert row.template == "auth/invite"
        assert row.provider_message_id == "msg-1"
        assert row.config_source == "org"
        assert row.error is None

    def test_empty_details_yields_none_fields(self) -> None:
        event = MagicMock()
        event.id = generate_id()
        event.created_at = "2026-05-25T12:00:00Z"
        event.action = Action.MAIL_SEND_FAILED
        event.organization_id = None
        event.details = {}

        row = _flatten_delivery(event, org_name=None)

        assert row.recipient is None
        assert row.template is None
        assert row.organization_id is None
        assert row.organization_name is None
        assert row.config_source == ""


class TestRemoveSuppressionValidation:
    def _build_ops(self) -> SystemMailOperations:
        session = MagicMock()
        with (
            patch("uniffy.domains.mail.system.operations.UserOperations"),
            patch("uniffy.domains.mail.system.operations.OrgSettingsOperations"),
            patch("uniffy.domains.mail.system.operations.SuppressionRepository"),
        ):
            ops = SystemMailOperations(session)
        ops._user_ops.require_system_admin = AsyncMock()
        return ops

    async def test_empty_reason_raises_validation_error(self) -> None:
        ops = self._build_ops()
        with pytest.raises(ValidationError):
            await ops.remove_suppression(
                user_id=generate_id(),
                email="foo@bar.com",
                reason="   ",
            )

    async def test_invalid_email_raises_validation_error(self) -> None:
        ops = self._build_ops()
        with pytest.raises(ValidationError):
            await ops.remove_suppression(
                user_id=generate_id(),
                email="no-at-sign",
                reason="customer asked",
            )


class TestForceClearOrgConfigValidation:
    def _build_ops(self) -> SystemMailOperations:
        session = MagicMock()
        with (
            patch("uniffy.domains.mail.system.operations.UserOperations"),
            patch("uniffy.domains.mail.system.operations.OrgSettingsOperations"),
            patch("uniffy.domains.mail.system.operations.SuppressionRepository"),
        ):
            ops = SystemMailOperations(session)
        ops._user_ops.require_system_admin = AsyncMock()
        return ops

    async def test_empty_reason_raises_validation_error(self) -> None:
        ops = self._build_ops()
        with pytest.raises(ValidationError):
            await ops.force_clear_org_config(
                user_id=generate_id(),
                organization_id=generate_id(),
                reason="",
            )
