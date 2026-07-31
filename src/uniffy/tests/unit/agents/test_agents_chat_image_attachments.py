"""Unit tests for chat-trigger attachment threading into the agent runtime.

Covers ``AgentChatBridge._load_trigger_attachments`` - the seam that fixes
#54 by resolving the trigger chat message's attachment rows into the
``FileContext`` list the runtime feeds to vision-capable LLMs.

The full ``respond_to_chat_message`` path is exercised by the existing
``test_agents_in_chat.py`` guard test plus manual QA; here we focus on the
helper so the per-file permission-tolerance and the no-attachment shortcut
are pinned down.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.types import generate_id
from uniffy.domains.agents.chat_integration import operations as bridge_mod
from uniffy.domains.agents.chat_integration.operations import AgentChatBridge
from uniffy.domains.agents.runtime.file_loader import FileContext


def _file_context(*, file_id: str = "", media_type: str = "image/png") -> FileContext:
    return FileContext(
        file_id=file_id or str(generate_id()),
        media_type=media_type,
        filename="screenshot.png",
        storage_key=f"files/{file_id or 'k'}.png",
        extracted_text=None,
        extraction_status="completed",
    )


def _attachment_row(file_id) -> tuple:
    """Mimic the (Attachment, File, User|None) tuple list_attachments returns."""
    return (SimpleNamespace(file_id=file_id), SimpleNamespace(), None)


class TestLoadTriggerAttachments:
    async def test_returns_none_when_trigger_has_no_attachments(self, monkeypatch) -> None:
        fake_ops = MagicMock()
        fake_ops.list_attachments = AsyncMock(return_value=[])
        monkeypatch.setattr(bridge_mod, "AttachmentOperations", lambda _s: fake_ops)

        safe_loader = AsyncMock()
        monkeypatch.setattr(bridge_mod, "_safe_load_files", safe_loader)

        bridge = AgentChatBridge(MagicMock())
        result = await bridge._load_trigger_attachments(
            user_id=generate_id(),
            organization_id=generate_id(),
            trigger_message_id=generate_id(),
        )
        assert result is None
        safe_loader.assert_not_awaited()

    async def test_returns_file_contexts_when_trigger_has_attachments(
        self, monkeypatch
    ) -> None:
        fid_a, fid_b = generate_id(), generate_id()
        fake_ops = MagicMock()
        fake_ops.list_attachments = AsyncMock(
            return_value=[_attachment_row(fid_a), _attachment_row(fid_b)]
        )
        monkeypatch.setattr(bridge_mod, "AttachmentOperations", lambda _s: fake_ops)

        loaded = [
            _file_context(file_id=str(fid_a)),
            _file_context(file_id=str(fid_b), media_type="application/pdf"),
        ]
        safe_loader = AsyncMock(return_value=loaded)
        monkeypatch.setattr(bridge_mod, "_safe_load_files", safe_loader)

        user_id, org_id, trigger_id = generate_id(), generate_id(), generate_id()
        bridge = AgentChatBridge(MagicMock())
        result = await bridge._load_trigger_attachments(
            user_id=user_id,
            organization_id=org_id,
            trigger_message_id=trigger_id,
        )
        assert result == loaded
        safe_loader.assert_awaited_once()
        passed_session, passed_user, passed_org, passed_file_ids = (
            safe_loader.await_args.args
        )
        assert passed_user == user_id
        assert passed_org == org_id
        assert passed_file_ids == [str(fid_a), str(fid_b)]

    async def test_returns_none_when_safe_load_returns_empty(self, monkeypatch) -> None:
        fid = generate_id()
        fake_ops = MagicMock()
        fake_ops.list_attachments = AsyncMock(return_value=[_attachment_row(fid)])
        monkeypatch.setattr(bridge_mod, "AttachmentOperations", lambda _s: fake_ops)

        safe_loader = AsyncMock(return_value=[])
        monkeypatch.setattr(bridge_mod, "_safe_load_files", safe_loader)

        bridge = AgentChatBridge(MagicMock())
        result = await bridge._load_trigger_attachments(
            user_id=generate_id(),
            organization_id=generate_id(),
            trigger_message_id=generate_id(),
        )
        assert result is None

    async def test_returns_none_when_list_attachments_raises(self, monkeypatch) -> None:
        fake_ops = MagicMock()
        fake_ops.list_attachments = AsyncMock(
            side_effect=PermissionDeniedError("access", "content")
        )
        monkeypatch.setattr(bridge_mod, "AttachmentOperations", lambda _s: fake_ops)

        safe_loader = AsyncMock()
        monkeypatch.setattr(bridge_mod, "_safe_load_files", safe_loader)

        bridge = AgentChatBridge(MagicMock())
        result = await bridge._load_trigger_attachments(
            user_id=generate_id(),
            organization_id=generate_id(),
            trigger_message_id=generate_id(),
        )
        assert result is None
        safe_loader.assert_not_awaited()


class TestSafeLoadFiles:
    """Pin down per-file permission tolerance shared by the bridge + future callers."""

    async def test_skips_files_the_user_cannot_view(self, monkeypatch) -> None:
        from uniffy.domains.agents.runtime import file_loader

        ok = _file_context(file_id="ok")
        call_count = {"n": 0}

        async def fake_load_files(_session, _user, _org, file_ids):
            call_count["n"] += 1
            if file_ids == ["ok"]:
                return [ok]
            raise PermissionDeniedError("view", "file")

        monkeypatch.setattr(file_loader, "_load_files", fake_load_files)

        result = await file_loader._safe_load_files(
            MagicMock(), generate_id(), generate_id(), ["ok", "blocked"]
        )
        assert result == [ok]
        assert call_count["n"] == 2

    async def test_returns_empty_list_for_no_file_ids(self) -> None:
        from uniffy.domains.agents.runtime import file_loader

        result = await file_loader._safe_load_files(MagicMock(), generate_id(), generate_id(), [])
        assert result == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
