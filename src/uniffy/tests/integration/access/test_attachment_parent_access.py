from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.files.attachment import Attachment
from uniffy.core.models.files.file import File
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.types import AccessMode, ContentRole, ContentType, ParentSelection, SubjectType
from uniffy.domains.files import routes
from uniffy.domains.files.attachments.operations import AttachmentOperations
from uniffy.domains.files.attachments.policy import migrate_attachment_policy
from uniffy.domains.files.operations import FileOperations
from uniffy.domains.permissions.access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.mark.parametrize("blocked", [False, True])
async def test_attachment_reads_follow_parent_without_changing_source_share(
    session, access, monkeypatch, blocked
):
    source = File(
        organization_id=access.org_id,
        owner_id=access.member_id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.VIEWER,
        filename="shared.mp4",
        original_filename="shared.mp4",
        mime_type="video/mp4",
        size_bytes=1,
        storage_key="source",
        storage_bucket="test",
    )
    session.add(source)
    await session.flush()
    parent_id = access.blocked_note_id if blocked else access.org_note_id
    ops = AttachmentOperations(session, AsyncMock(), AsyncMock())
    try:
        attachment = await ops.attach_file(
            access.member_id, access.org_id, ContentType.NOTE, parent_id, source.id
        )
        await session.commit()
        for migrate in (False, True):
            if migrate:
                await migrate_attachment_policy(
                    session,
                    AsyncMock(),
                    access.org_id,
                    [(ContentType.NOTE, parent_id)],
                    AccessMode.OPEN_TO_ORG,
                    ContentRole.EDITOR,
                    access.member_id,
                )
                await session.commit()
            file = await session.get(File, attachment.file_id)
            assert file.access_mode == AccessMode.OWNER_ONLY
            assert file.baseline_role is None
            key = ResourceKey(ContentType.FILE, file.id)
            decision = (
                await ResourceAccessResolver(session).resolve(
                    actor_id=access.peer_id,
                    organization_id=access.org_id,
                    keys=[key],
                    purpose=ResourceAccessPurpose.REFERENCE,
                )
            )[key]
            assert decision.can_view is not blocked
            if not blocked:
                assert decision.role == ContentRole.VIEWER
                await FileOperations(session).get_by_id(access.peer_id, access.org_id, file.id)
                continue
            with pytest.raises(PermissionDeniedError):
                await FileOperations(session).get_by_id(access.peer_id, access.org_id, file.id)

            @asynccontextmanager
            async def same_session():
                yield session

            monkeypatch.setattr(routes, "open_session", same_session)
            storage = AsyncMock()
            for version in (None, 1):
                with pytest.raises(HTTPException) as denied:
                    await routes.stream_media(
                        storage, access.org_id, file.id, access.peer_id, "bytes=0-0", version
                    )
                assert denied.value.status_code == 403
            storage.download_range.assert_not_awaited()
            files, _ = await FileOperations(session).list_files(
                access.peer_id, access.org_id, folder_id=ParentSelection.ALL
            )
            assert file.id not in {row.id for row in files}

        await FileOperations(session).get_by_id(access.peer_id, access.org_id, source.id)
        assert source.access_mode == AccessMode.OPEN_TO_ORG
        if blocked:
            session.add(
                ContentMember(
                    organization_id=access.org_id,
                    content_type=ContentType.FILE,
                    content_id=attachment.file_id,
                    subject_type=SubjectType.USER,
                    subject_id=access.peer_id,
                    role=ContentRole.VIEWER,
                    added_by_user_id=access.member_id,
                )
            )
            await session.commit()
            await FileOperations(session).get_by_id(
                access.peer_id, access.org_id, attachment.file_id
            )
    finally:
        await session.rollback()
        await session.execute(delete(Attachment).where(Attachment.organization_id == access.org_id))
        await session.execute(
            delete(FileVersion).where(
                FileVersion.file_id.in_(select(File.id).where(File.organization_id == access.org_id))
            )
        )
        await session.execute(delete(File).where(File.organization_id == access.org_id))
        await session.commit()
