from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import ContentAccessQuery, PermissionChecker
from uniffy.core.models.files.file import File
from uniffy.core.models.files.file_version import FileVersion
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.multipart_part import MultipartPart
from uniffy.core.models.files.multipart_upload import MultipartUpload
from uniffy.core.models.notes.note import Note
from uniffy.core.models.permissions.org_permission_defaults import OrganizationPermissionDefaults
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.view_config import ViewConfig
from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType, generate_id
from uniffy.domains.files.operations import FileOperations, FolderOperations
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.domains.projects.operations import ProjectOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")

Content = Note | File | Folder | Project


async def _create_content(
    session: AsyncSession,
    env: SimpleNamespace,
    search_indexer: SearchIndexer,
    content_type: ContentType,
    access_mode: AccessMode | None,
) -> Content:
    storage = MagicMock(spec=ObjectStorage)
    storage.bucket_name = "test"
    storage.create_multipart_upload = AsyncMock(return_value=str(generate_id()))
    name = f"Personal creation {generate_id().hex[:10]}"
    if content_type == ContentType.NOTE:
        return await NoteOperations(session, storage, search_indexer).create(
            user_id=env.member_id,
            organization_id=env.org_id,
            title=name,
            access_mode=access_mode,
        )
    if content_type == ContentType.PROJECT:
        return await ProjectOperations(session, storage, search_indexer).create(
            user_id=env.member_id,
            organization_id=env.org_id,
            name=name,
            access_mode=access_mode,
        )
    if content_type == ContentType.FOLDER:
        return await FolderOperations(session, storage, search_indexer).create(
            user_id=env.member_id,
            organization_id=env.org_id,
            name=name,
            access_mode=access_mode,
        )

    files = FileOperations(session, storage, search_indexer)
    quota = MagicMock()
    quota.check_quota = AsyncMock(return_value=SimpleNamespace(allowed=True))
    quota.increment_usage = AsyncMock()
    with patch("uniffy.domains.files.uploads.QuotaOperations", return_value=quota):
        upload = await files.initiate_upload(
            user_id=env.member_id,
            organization_id=env.org_id,
            filename=f"{name}.bin",
            mime_type="application/octet-stream",
            total_size=4,
            access_mode=access_mode,
        )
        await files.record_chunk_completed(upload.id, 1, "test-etag", 4)
        return await files.complete_upload(upload.id, env.member_id)


async def _role(
    session: AsyncSession, content: Content, content_type: ContentType, user_id: UUID
) -> ContentRole | None:
    return await PermissionChecker(session).effective_role(
        user_id=user_id,
        organization_id=content.organization_id,
        content_type=content_type,
        content_id=content.id,
        owner_id=content.owner_id,
        access_mode=content.access_mode,
        baseline_role=content.baseline_role,
    )


async def _is_listed(
    session: AsyncSession, content: Content, content_type: ContentType, user_id: UUID
) -> bool:
    model = type(content)
    access_filter = await ContentAccessQuery(session).build_accessible_filter(
        user_id=user_id,
        organization_id=content.organization_id,
        content_type=content_type,
        content_id_column=model.id,
        owner_id_column=model.owner_id,
        access_mode_column=model.access_mode,
        baseline_role_column=model.baseline_role,
    )
    return (
        await session.scalar(
            select(model.id).where(
                model.organization_id == content.organization_id,
                model.id == content.id,
                access_filter,
            )
        )
        is not None
    )


async def _cleanup_content(session: AsyncSession, organization_id: UUID) -> None:
    await session.rollback()
    project_ids = select(Project.id).where(Project.organization_id == organization_id)
    await session.execute(delete(ViewConfig).where(ViewConfig.project_id.in_(project_ids)))
    await session.execute(delete(FieldDefinition).where(FieldDefinition.project_id.in_(project_ids)))
    await session.execute(delete(Project).where(Project.organization_id == organization_id))
    await session.execute(delete(Note).where(Note.organization_id == organization_id))
    file_ids = select(File.id).where(File.organization_id == organization_id)
    await session.execute(
        update(File).where(File.organization_id == organization_id).values(current_version_id=None)
    )
    await session.execute(delete(FileVersion).where(FileVersion.file_id.in_(file_ids)))
    await session.execute(delete(File).where(File.organization_id == organization_id))
    upload_ids = select(MultipartUpload.id).where(MultipartUpload.organization_id == organization_id)
    await session.execute(delete(MultipartPart).where(MultipartPart.upload_id.in_(upload_ids)))
    await session.execute(
        delete(MultipartUpload).where(MultipartUpload.organization_id == organization_id)
    )
    await session.execute(
        delete(OrganizationPermissionDefaults).where(
            OrganizationPermissionDefaults.organization_id == organization_id
        )
    )
    await session.commit()


@pytest.mark.parametrize(
    "content_type", [ContentType.NOTE, ContentType.FILE, ContentType.FOLDER, ContentType.PROJECT]
)
@pytest.mark.parametrize(
    "access_mode", [None, AccessMode.OWNER_ONLY, AccessMode.OPEN_TO_ORG, AccessMode.EXPLICIT_MEMBERS]
)
async def test_creation_permissions_remain_scoped_when_org_defaults_change(
    session: AsyncSession,
    env: SimpleNamespace,
    search_indexer: SearchIndexer,
    content_type: ContentType,
    access_mode: AccessMode | None,
) -> None:
    defaults = OrganizationPermissionDefaults(
        organization_id=env.org_id,
        content_type=content_type,
        default_access_mode=AccessMode.OPEN_TO_ORG,
        default_baseline_role=ContentRole.VIEWER,
        updated_by_user_id=env.admin_id,
    )
    session.add(defaults)
    await session.commit()
    try:
        content = await _create_content(session, env, search_indexer, content_type, access_mode)
        await session.refresh(content)
        assert content.access_mode == (access_mode or AccessMode.OWNER_ONLY)
        assert content.baseline_role is None

        for baseline in (ContentRole.VIEWER, ContentRole.EDITOR):
            defaults.default_baseline_role = baseline
            await session.commit()
            expected = baseline if access_mode == AccessMode.OPEN_TO_ORG else None
            assert await _role(session, content, content_type, env.member_id) == ContentRole.OWNER
            assert await _role(session, content, content_type, env.admin_id) == expected
            assert await _is_listed(session, content, content_type, env.admin_id) == (
                expected is not None
            )

        if access_mode is None:
            members = ContentMembersOperations(session, search_indexer)
            await members.set_access_mode(
                env.member_id, env.org_id, content_type, content.id, AccessMode.EXPLICIT_MEMBERS
            )
            await members.add_member(
                env.member_id,
                env.org_id,
                content_type,
                content.id,
                SubjectType.USER,
                env.admin_id,
                ContentRole.VIEWER,
            )
            await session.refresh(content)
            assert await _role(session, content, content_type, env.admin_id) == ContentRole.VIEWER
            assert await _is_listed(session, content, content_type, env.admin_id)
    finally:
        await _cleanup_content(session, env.org_id)
