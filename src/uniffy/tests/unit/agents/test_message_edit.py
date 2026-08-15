"""Tests for message edit/delete/retry operations.

The validation surface (ownership, window, role, empty content,
inflight-run guard) is exercised against the in-memory objects the
operations mutate. The SQL paths require a real DB to verify the
cascade fully; the operations layer asserts cascade correctness via
the rows it touches in-memory.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

# Pre-import the auth package (full chain) so its handlers module
# finishes before any other test-file import triggers a partial-init
# cycle through core.converters.
import uniffy.domains.auth  # noqa: F401
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.models.agents.session import AgentSession
from uniffy.core.types import generate_id
from uniffy.domains.agents.sessions.operations import (
    EDIT_WINDOW_SECONDS,
    SessionOperations,
)


def _make_user_message(*, age_seconds: float = 5) -> AgentMessage:
    return AgentMessage(
        id=generate_id(),
        session_id=generate_id(),
        role="user",
        content="hello",
        created_at=datetime.now(UTC) - timedelta(seconds=age_seconds),
    )


def _make_session(*, user_id) -> AgentSession:
    return AgentSession(
        id=generate_id(),
        organization_id=generate_id(),
        agent_id=generate_id(),
        user_id=user_id,
        kind="direct",
    )


def _make_ops_with_message(
    msg: AgentMessage,
    sess: AgentSession,
    *,
    downstream: list[AgentMessage] | None = None,
    inflight: bool = False,
    monkeypatch: pytest.MonkeyPatch | None = None,
) -> SessionOperations:
    ops = SessionOperations(MagicMock())
    ops._org_ops = MagicMock()
    ops._org_ops.require_org_member = AsyncMock()

    async def fake_load(**kwargs):
        return msg, sess

    ops._load_message = fake_load  # type: ignore[assignment]

    rows = downstream or []

    async def fake_execute(_stmt):
        result = MagicMock()
        result.scalars.return_value.all.return_value = rows
        return result

    ops._session.execute = fake_execute
    ops._session.commit = AsyncMock()
    ops._session.refresh = AsyncMock()
    ops._session.add = MagicMock()

    if monkeypatch is not None:

        async def fake_active(_session_id):
            return inflight

        monkeypatch.setattr(
            "uniffy.domains.agents.sessions.operations.session_has_active_run",
            fake_active,
        )

    return ops


class TestEditMessage:
    async def test_succeeds_within_window(self, monkeypatch: pytest.MonkeyPatch) -> None:
        user = generate_id()
        msg = _make_user_message(age_seconds=5)
        sess = _make_session(user_id=user)
        downstream = [
            AgentMessage(
                id=generate_id(),
                session_id=sess.id,
                role="assistant",
                content="reply",
                created_at=msg.created_at + timedelta(seconds=1),
            ),
        ]
        ops = _make_ops_with_message(msg, sess, downstream=downstream, monkeypatch=monkeypatch)

        result = await ops.edit_message(
            user_id=user,
            organization_id=sess.organization_id,
            message_id=msg.id,
            new_content="updated",
        )

        assert result.content == "updated"
        assert result.previous_content == "hello"
        assert result.edited_at is not None
        assert downstream[0].is_invalidated is True
        assert downstream[0].invalidated_by == user

    async def test_rejects_after_window(self, monkeypatch: pytest.MonkeyPatch) -> None:
        user = generate_id()
        msg = _make_user_message(age_seconds=EDIT_WINDOW_SECONDS + 60)
        sess = _make_session(user_id=user)
        ops = _make_ops_with_message(msg, sess, monkeypatch=monkeypatch)

        with pytest.raises(ValidationError, match="window expired"):
            await ops.edit_message(
                user_id=user,
                organization_id=sess.organization_id,
                message_id=msg.id,
                new_content="updated",
            )

    async def test_rejects_non_owner(self, monkeypatch: pytest.MonkeyPatch) -> None:
        msg = _make_user_message()
        sess = _make_session(user_id=generate_id())
        ops = _make_ops_with_message(msg, sess, monkeypatch=monkeypatch)

        with pytest.raises(PermissionDeniedError):
            await ops.edit_message(
                user_id=generate_id(),
                organization_id=sess.organization_id,
                message_id=msg.id,
                new_content="updated",
            )

    async def test_rejects_non_user_role(self, monkeypatch: pytest.MonkeyPatch) -> None:
        user = generate_id()
        sess = _make_session(user_id=user)
        msg = AgentMessage(
            id=generate_id(),
            session_id=sess.id,
            role="assistant",
            content="reply",
            created_at=datetime.now(UTC),
        )
        ops = _make_ops_with_message(msg, sess, monkeypatch=monkeypatch)

        with pytest.raises(ValidationError, match="user messages"):
            await ops.edit_message(
                user_id=user,
                organization_id=sess.organization_id,
                message_id=msg.id,
                new_content="updated",
            )

    async def test_rejects_empty_content(self, monkeypatch: pytest.MonkeyPatch) -> None:
        user = generate_id()
        msg = _make_user_message()
        sess = _make_session(user_id=user)
        ops = _make_ops_with_message(msg, sess, monkeypatch=monkeypatch)

        with pytest.raises(ValidationError, match="empty"):
            await ops.edit_message(
                user_id=user,
                organization_id=sess.organization_id,
                message_id=msg.id,
                new_content="   ",
            )

    async def test_rejects_when_run_is_inflight(self, monkeypatch: pytest.MonkeyPatch) -> None:
        user = generate_id()
        msg = _make_user_message()
        sess = _make_session(user_id=user)
        ops = _make_ops_with_message(msg, sess, inflight=True, monkeypatch=monkeypatch)

        with pytest.raises(ValidationError, match="streaming"):
            await ops.edit_message(
                user_id=user,
                organization_id=sess.organization_id,
                message_id=msg.id,
                new_content="updated",
            )


class TestRetryMessage:
    async def test_user_message_returns_content_and_invalidates_downstream(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        user = generate_id()
        msg = _make_user_message()
        msg.file_ids = ["f1", "f2"]
        sess = _make_session(user_id=user)
        downstream = AgentMessage(
            id=generate_id(),
            session_id=sess.id,
            role="assistant",
            content="b",
            created_at=msg.created_at + timedelta(seconds=1),
        )
        ops = _make_ops_with_message(msg, sess, downstream=[downstream], monkeypatch=monkeypatch)

        content, file_ids = await ops.retry_message(
            user_id=user,
            organization_id=sess.organization_id,
            message_id=msg.id,
        )

        assert content == "hello"
        assert file_ids == ["f1", "f2"]
        assert downstream.is_invalidated is True
        assert msg.is_invalidated is False  # anchor preserved

    async def test_assistant_message_walks_back_to_user(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        user = generate_id()
        sess = _make_session(user_id=user)
        anchor_user = AgentMessage(
            id=generate_id(),
            session_id=sess.id,
            role="user",
            content="anchor",
            created_at=datetime.now(UTC) - timedelta(seconds=10),
        )
        assistant = AgentMessage(
            id=generate_id(),
            session_id=sess.id,
            role="assistant",
            content="reply",
            created_at=anchor_user.created_at + timedelta(seconds=1),
        )

        ops = SessionOperations(MagicMock())
        ops._org_ops = MagicMock()
        ops._org_ops.require_org_member = AsyncMock()

        async def fake_load(**kwargs):
            return assistant, sess

        ops._load_message = fake_load  # type: ignore[assignment]

        call_state = {"call": 0}

        async def fake_execute(_stmt):
            call_state["call"] += 1
            result = MagicMock()
            if call_state["call"] == 1:
                result.scalar_one_or_none.return_value = anchor_user
            else:
                result.scalars.return_value.all.return_value = [assistant]
            return result

        ops._session.execute = fake_execute
        ops._session.commit = AsyncMock()
        ops._session.add = MagicMock()

        async def fake_active(_session_id):
            return False

        monkeypatch.setattr(
            "uniffy.domains.agents.sessions.operations.session_has_active_run",
            fake_active,
        )

        content, _ = await ops.retry_message(
            user_id=user,
            organization_id=sess.organization_id,
            message_id=assistant.id,
        )

        assert content == "anchor"
        assert assistant.is_invalidated is True
