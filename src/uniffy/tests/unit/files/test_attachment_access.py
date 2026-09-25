from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from uniffy_proto.common.v1.common_pb import ContentType as ProtoContentType

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.domains.chat.attachments import ChatAttachmentPolicy
from uniffy.domains.files.attachments import access as access_module
from uniffy.domains.files.attachments.access import AttachmentTargetAccess
from uniffy.domains.files.attachments.converters import content_type_from_proto
from uniffy.domains.files.attachments.operations import AttachmentOperations
from uniffy.domains.permissions.access import (
    ResolvedResourcePolicy,
    ResourceAccessDecision,
    ResourceKey,
    ResourceRowState,
)


@pytest.mark.asyncio
async def test_note_target_uses_resolved_edit_policy() -> None:
    session = AsyncMock()
    content_id = generate_id()
    key = ResourceKey(ContentType.NOTE, content_id)
    access = AttachmentTargetAccess(session)
    access._resources.resolve = AsyncMock(  # type: ignore[method-assign]
        return_value={
            key: ResourceAccessDecision(
                key=key,
                row_state=ResourceRowState.LIVE,
                can_view=True,
                role=ContentRole.EDITOR,
                target_policy=ResolvedResourcePolicy(
                    ContentType.NOTE,
                    AccessMode.EXPLICIT_MEMBERS,
                    None,
                ),
            )
        }
    )

    policy = await access.require_edit(
        generate_id(),
        generate_id(),
        ContentType.NOTE,
        content_id,
    )

    assert policy.content_type == ContentType.NOTE
    assert policy.access_mode == AccessMode.EXPLICIT_MEMBERS


@pytest.mark.asyncio
async def test_task_target_returns_its_project_policy() -> None:
    session = AsyncMock()
    content_id = generate_id()
    key = ResourceKey(ContentType.TASK, content_id)
    access = AttachmentTargetAccess(session)
    access._resources.resolve = AsyncMock(  # type: ignore[method-assign]
        return_value={
            key: ResourceAccessDecision(
                key=key,
                row_state=ResourceRowState.LIVE,
                can_view=True,
                role=ContentRole.EDITOR,
                target_policy=ResolvedResourcePolicy(
                    ContentType.PROJECT,
                    AccessMode.OPEN_TO_ORG,
                    ContentRole.EDITOR,
                ),
            )
        }
    )

    policy = await access.require_edit(
        generate_id(),
        generate_id(),
        ContentType.TASK,
        content_id,
    )

    assert policy.content_type == ContentType.PROJECT
    assert policy.baseline_role == ContentRole.EDITOR


@pytest.mark.asyncio
async def test_chat_target_requires_sender_or_moderator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = AsyncMock()
    require_chat_edit = AsyncMock(side_effect=PermissionDeniedError("edit", "chat message"))
    monkeypatch.setattr(access_module, "require_message_attachment_edit", require_chat_edit)

    with pytest.raises(PermissionDeniedError):
        await AttachmentTargetAccess(session).require_edit(
            generate_id(),
            generate_id(),
            ContentType.CHAT_MESSAGE,
            generate_id(),
        )


async def test_chat_target_uses_chat_owned_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    require_chat_edit = AsyncMock(
        return_value=ChatAttachmentPolicy(AccessMode.OPEN_TO_ORG, ContentRole.VIEWER)
    )
    monkeypatch.setattr(access_module, "require_message_attachment_edit", require_chat_edit)

    policy = await AttachmentTargetAccess(AsyncMock()).require_edit(
        generate_id(),
        generate_id(),
        ContentType.CHAT_MESSAGE,
        generate_id(),
    )

    assert policy.content_type == ContentType.CHAT
    assert policy.access_mode == AccessMode.OPEN_TO_ORG


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
    operations = AttachmentOperations(session, MagicMock())
    operations._verify_content_access = AsyncMock(  # type: ignore[method-assign]
        side_effect=PermissionDeniedError("access", "content")
    )
    operations._verify_content_edit_access = AsyncMock()  # type: ignore[method-assign]

    with pytest.raises(PermissionDeniedError):
        await operations.detach_file(user_id, generate_id(), attachment.id)

    operations._verify_content_edit_access.assert_not_awaited()


def test_user_profile_is_not_an_attachment_target() -> None:
    assert content_type_from_proto(ProtoContentType.USER) is None
