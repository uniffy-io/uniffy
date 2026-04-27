"""Phase 2 unit tests for agents-in-chat integration.

Covers the pure-logic + asyncio-only pieces that do not require a live
DB or Valkey:

- `_metadata_kind_for` role mapping used by `ChatChannelMessageWriter`.
- `ApprovalStore` round-trip in the in-process fast path (Valkey
  degrades gracefully when unavailable, which is exactly the test env).
- `ChatChannelMessageWriter.approval_scope_id` / actor / agent / channel
  accessors feed the right hints into the approval store.

DB-backed writer persistence + runtime end-to-end integration land in
the Phase 2j validation pass.
"""

import asyncio
from unittest.mock import MagicMock
from uuid import UUID

from uniffy.core.types import generate_id as uuid7
from uniffy.domains.agents.runtime.approvals import ApprovalStore
from uniffy.domains.agents.runtime.writers import (
    ChatChannelMessageWriter,
    SessionMessageWriter,
    _metadata_kind_for,
)


def _run(coro):
    return asyncio.run(coro)


class TestMetadataKindMapping:
    def test_summary_role(self) -> None:
        assert _metadata_kind_for("summary", None) == "summary"

    def test_tool_role(self) -> None:
        assert _metadata_kind_for("tool", "tc_123") == "tool_result"

    def test_assistant_with_tool_call_id(self) -> None:
        assert _metadata_kind_for("assistant", "tc_123") == "tool_call"

    def test_assistant_without_tool_call_id(self) -> None:
        assert _metadata_kind_for("assistant", None) == "final"

    def test_user_falls_back_to_final(self) -> None:
        # User role is persisted as the trigger message, not rewritten by
        # the writer; the mapper returns `final` but writer short-circuits
        # role=="user" before invoking the helper.
        assert _metadata_kind_for("user", None) == "final"


class TestApprovalStoreInProcess:
    def test_register_then_respond_approved(self) -> None:
        store = ApprovalStore()
        scope = uuid7()
        rid = "tc_abc"

        async def flow() -> bool | None:
            await store.register(scope, rid, tool_name="notes.delete_note")
            resolved = await store.respond(scope, rid, True, decided_by=uuid7())
            assert resolved is True
            return await store.wait_for_response(scope, rid, timeout=1.0)

        assert _run(flow()) is True

    def test_respond_denied_resolves_false(self) -> None:
        store = ApprovalStore()
        scope = uuid7()
        rid = "tc_def"

        async def flow() -> bool | None:
            await store.register(scope, rid)
            await store.respond(scope, rid, False)
            return await store.wait_for_response(scope, rid, timeout=1.0)

        assert _run(flow()) is False

    def test_respond_without_register_does_not_crash(self) -> None:
        """Respond on an unknown scope is tolerant and returns cleanly."""
        store = ApprovalStore()

        async def flow() -> bool:
            return await store.respond(uuid7(), "tc_ghost", True)

        # The local-event path is absent so `resolved_locally` is False,
        # but `cache_set` is a graceful no-op when Valkey is unavailable
        # which leaves `valkey_ok` True. Either way the call completes
        # without raising.
        _run(flow())

    def test_wait_times_out_without_respond(self) -> None:
        store = ApprovalStore()
        scope = uuid7()
        rid = "tc_slow"

        async def flow() -> bool | None:
            await store.register(scope, rid)
            return await store.wait_for_response(scope, rid, timeout=0.05)

        assert _run(flow()) is None


class TestChatWriterApprovalAccessors:
    def _writer(self) -> tuple[ChatChannelMessageWriter, dict[str, UUID]]:
        ids = {
            "channel": uuid7(),
            "agent": uuid7(),
            "user": uuid7(),
            "trigger": uuid7(),
            "org": uuid7(),
        }
        return (
            ChatChannelMessageWriter(
                session=MagicMock(),
                user_id=ids["user"],
                organization_id=ids["org"],
                channel_id=ids["channel"],
                agent_id=ids["agent"],
                trigger_message_id=ids["trigger"],
            ),
            ids,
        )

    def test_approval_scope_is_channel(self) -> None:
        w, ids = self._writer()
        assert w.approval_scope_id == ids["channel"]

    def test_approval_hints_feed_audit_path(self) -> None:
        w, ids = self._writer()
        assert w.approval_actor_user_id == ids["user"]
        assert w.approval_agent_id == ids["agent"]
        assert w.approval_channel_id == ids["channel"]


class TestSessionWriterApprovalAccessors:
    def test_scope_is_session_and_hints_are_none(self) -> None:
        session_id = uuid7()
        w = SessionMessageWriter(
            session_ops=MagicMock(),
            user_id=uuid7(),
            organization_id=uuid7(),
            session_id=session_id,
        )
        assert w.approval_scope_id == session_id
        assert w.approval_actor_user_id is None
        assert w.approval_agent_id is None
        assert w.approval_channel_id is None
