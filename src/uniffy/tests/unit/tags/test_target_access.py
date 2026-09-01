from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import NotFoundError
from uniffy.core.types import ContentType, generate_id
from uniffy.domains.tags import targets as access_module
from uniffy.domains.tags.targets import TagTargetAccess


@pytest.mark.asyncio
async def test_standard_target_uses_domain_edit_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    operations = MagicMock()
    operations.get_for_edit = AsyncMock()
    monkeypatch.setattr(access_module, "NoteReader", lambda _: operations)

    await TagTargetAccess(AsyncMock()).require_edit(
        generate_id(),
        generate_id(),
        ContentType.NOTE,
        generate_id(),
    )

    operations.get_for_edit.assert_awaited_once()


@pytest.mark.asyncio
async def test_folder_target_uses_folder_edit_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    folder = SimpleNamespace(is_deleted=False)
    operations = MagicMock()
    operations.get_by_id = AsyncMock(return_value=folder)
    operations.require_edit = AsyncMock()
    monkeypatch.setattr(access_module, "FolderOperations", lambda _: operations)
    actor_id = generate_id()
    organization_id = generate_id()
    folder_id = generate_id()

    await TagTargetAccess(AsyncMock()).require_edit(
        actor_id,
        organization_id,
        ContentType.FOLDER,
        folder_id,
    )

    operations.require_edit.assert_awaited_once_with(actor_id, organization_id, folder)


@pytest.mark.asyncio
async def test_unsupported_target_fails_closed() -> None:
    with pytest.raises(NotFoundError):
        await TagTargetAccess(AsyncMock()).require_edit(
            generate_id(),
            generate_id(),
            ContentType.USER,
            generate_id(),
        )
