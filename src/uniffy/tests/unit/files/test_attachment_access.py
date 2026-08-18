from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from uniffy_proto.common.v1.common_pb2 import ContentType as ProtoContentType

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.chat.channel import ChannelType
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.domains.files.attachments import access as access_module
from uniffy.domains.files.attachments import operations as operations_module
from uniffy.domains.files.attachments.access import AttachmentTargetAccess
from uniffy.domains.files.attachments.converters import content_type_from_proto
from uniffy.domains.files.attachments.operations import AttachmentOperations


@pytest.mark.asyncio
async def test_note_target_uses_domain_edit_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    session = AsyncMock()
    note = SimpleNamespace(
        access_mode=AccessMode.EXPLICIT_MEMBERS,
        baseline_role=None,
    )
    note_operations = MagicMock()
    note_operations.get_for_edit = AsyncMock(return_value=note)
    monkeypatch.setattr(access_module, "NoteOperations", lambda _: note_operations)

    policy = await AttachmentTargetAccess(session).require_edit(
        generate_id(),
        generate_id(),
        ContentType.NOTE,
        generate_id(),
    )

    note_operations.get_for_edit.assert_awaited_once()
    assert policy.content_type == ContentType.NOTE
    assert policy.access_mode == AccessMode.EXPLICIT_MEMBERS


@pytest.mark.asyncio
async def test_task_target_reuses_project_authorized_by_task_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = AsyncMock()
    project_id = generate_id()
    task = SimpleNamespace(project_id=project_id)
    project = SimpleNamespace(
        is_deleted=False,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
    )
    task_operations = MagicMock()
    task_operations.get_for_edit = AsyncMock(return_value=task)
    session.get.return_value = project
    monkeypatch.setattr(access_module, "TaskOperations", lambda _: task_operations)

    policy = await AttachmentTargetAccess(session).require_edit(
        generate_id(),
        generate_id(),
        ContentType.TASK,
        generate_id(),
    )

    task_operations.get_for_edit.assert_awaited_once()
    session.get.assert_awaited_once_with(access_module.Project, project_id)
    assert policy.content_type == ContentType.PROJECT
    assert policy.baseline_role == ContentRole.EDITOR


@pytest.mark.asyncio
async def test_chat_target_requires_sender_or_moderator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = generate_id()
    session = AsyncMock()
    result = MagicMock()
    result.one_or_none.return_value = SimpleNamespace(
        channel_id=generate_id(),
        sender_id=generate_id(),
    )
    session.execute.return_value = result
    checker = MagicMock()
    checker.get_channel = AsyncMock(
        return_value=SimpleNamespace(id=generate_id(), channel_type=ChannelType.PRIVATE)
    )
    checker.check_access = AsyncMock()
    checker.require_elevated = AsyncMock(return_value=False)
    monkeypatch.setattr(access_module, "ChatAccessChecker", lambda _: checker)

    with pytest.raises(PermissionDeniedError):
        await AttachmentTargetAccess(session).require_edit(
            user_id,
            generate_id(),
            ContentType.CHAT_MESSAGE,
            generate_id(),
        )


@pytest.mark.asyncio
async def test_attacher_still_needs_current_parent_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = generate_id()
    attachment = SimpleNamespace(
        id=generate_id(),
        attached_by_user_id=user_id,
        content_type=ContentType.NOTE,
        content_id=generate_id(),
    )
    session = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = attachment
    session.execute.return_value = result
    monkeypatch.setattr(operations_module, "get_s3_client", MagicMock())
    operations = AttachmentOperations(session)
    operations._verify_content_access = AsyncMock(  # type: ignore[method-assign]
        side_effect=PermissionDeniedError("access", "content")
    )
    operations._verify_content_edit_access = AsyncMock()  # type: ignore[method-assign]

    with pytest.raises(PermissionDeniedError):
        await operations.detach_file(user_id, generate_id(), attachment.id)

    operations._verify_content_edit_access.assert_not_awaited()


def test_user_profile_is_not_an_attachment_target() -> None:
    assert content_type_from_proto(ProtoContentType.CONTENT_TYPE_USER) is None
