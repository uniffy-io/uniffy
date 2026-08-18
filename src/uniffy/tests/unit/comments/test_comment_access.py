from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.types import ContentType, generate_id
from uniffy.domains.comments import access as access_module
from uniffy.domains.comments.access import CommentTargetAccess


@pytest.mark.parametrize(
    ("content_type", "operations_name"),
    [
        (ContentType.NOTE, "NoteOperations"),
        (ContentType.FILE, "FileOperations"),
        (ContentType.CALENDAR_EVENT, "CalendarEventOperations"),
        (ContentType.PROJECT, "ProjectOperations"),
        (ContentType.TASK, "TaskOperations"),
    ],
)
async def test_view_dispatches_to_the_owning_domain(content_type, operations_name) -> None:
    user_id = generate_id()
    organization_id = generate_id()
    content_id = generate_id()
    operations = MagicMock()
    operations.get_by_id = AsyncMock()

    with patch.object(access_module, operations_name, return_value=operations):
        await CommentTargetAccess(MagicMock()).require_view(
            user_id,
            organization_id,
            content_type,
            content_id,
        )

    operations.get_by_id.assert_awaited_once_with(user_id, organization_id, content_id)


@pytest.mark.parametrize(
    ("content_type", "operations_name"),
    [
        (ContentType.NOTE, "NoteOperations"),
        (ContentType.FILE, "FileOperations"),
        (ContentType.CALENDAR_EVENT, "CalendarEventOperations"),
        (ContentType.PROJECT, "ProjectOperations"),
        (ContentType.TASK, "TaskOperations"),
    ],
)
async def test_edit_dispatches_to_the_owning_domain(content_type, operations_name) -> None:
    user_id = generate_id()
    organization_id = generate_id()
    content_id = generate_id()
    operations = MagicMock()
    operations.get_for_edit = AsyncMock()

    with patch.object(access_module, operations_name, return_value=operations):
        await CommentTargetAccess(MagicMock()).require_edit(
            user_id,
            organization_id,
            content_type,
            content_id,
        )

    operations.get_for_edit.assert_awaited_once_with(user_id, organization_id, content_id)
