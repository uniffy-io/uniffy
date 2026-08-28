"""Direct grants pierce inaccessible parent folders in list paths; BLOCKED never does."""

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import delete

from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    ParentSelection,
    SubjectType,
    generate_id,
)
from uniffy.domains.files.operations import FileOperations, FolderOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.fixture
def quiet_search(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(SearchIndexer, "index", AsyncMock())
    monkeypatch.setattr(SearchIndexer, "update_sharing", AsyncMock())


def _folder(env, *, access_mode, baseline_role=None, parent_id=None) -> Folder:
    return Folder(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name=f"itdb-{generate_id().hex[:8]}",
        access_mode=access_mode,
        baseline_role=baseline_role,
        parent_id=parent_id,
    )


def _file(env, *, folder_id, access_mode, baseline_role=None) -> File:
    suffix = generate_id().hex[:8]
    return File(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        filename=f"itdb-{suffix}.txt",
        original_filename=f"itdb-{suffix}.txt",
        mime_type="text/plain",
        size_bytes=10,
        storage_key=f"itdb/{suffix}",
        storage_bucket="itdb",
        folder_id=folder_id,
        access_mode=access_mode,
        baseline_role=baseline_role,
    )


async def _cleanup(session, org_id) -> None:
    await session.rollback()
    await session.execute(delete(ContentMember).where(ContentMember.organization_id == org_id))
    await session.execute(delete(File).where(File.organization_id == org_id))
    await session.execute(delete(Folder).where(Folder.organization_id == org_id))
    await session.commit()


async def test_direct_file_grant_pierces_inaccessible_folder(session, env, quiet_search) -> None:
    try:
        private_folder = _folder(env, access_mode=AccessMode.OWNER_ONLY)
        session.add(private_folder)
        await session.flush()
        granted = _file(env, folder_id=private_folder.id, access_mode=AccessMode.EXPLICIT_MEMBERS)
        sibling = _file(env, folder_id=private_folder.id, access_mode=AccessMode.EXPLICIT_MEMBERS)
        session.add_all([granted, sibling])
        await session.commit()

        await ContentMembersOperations(session).add_member(
            actor_user_id=env.admin_id,
            organization_id=env.org_id,
            content_type=ContentType.FILE,
            content_id=granted.id,
            subject_type=SubjectType.USER,
            subject_id=env.member_id,
            role=ContentRole.VIEWER,
        )

        files, _ = await FileOperations(session).list_files(
            env.member_id,
            env.org_id,
            folder_id=ParentSelection.ALL,
        )
        listed_ids = {f.id for f in files}
        assert granted.id in listed_ids
        assert sibling.id not in listed_ids

        root_folders = await FolderOperations(session).list_folders(
            env.member_id, env.org_id, parent_id=None
        )
        assert private_folder.id not in {f.id for f in root_folders}
    finally:
        await _cleanup(session, env.org_id)


async def test_direct_folder_grant_reaches_nested_folder(session, env, quiet_search) -> None:
    try:
        private_parent = _folder(env, access_mode=AccessMode.OWNER_ONLY)
        session.add(private_parent)
        await session.flush()
        nested = _folder(env, access_mode=AccessMode.EXPLICIT_MEMBERS, parent_id=private_parent.id)
        session.add(nested)
        await session.commit()

        await ContentMembersOperations(session).add_member(
            actor_user_id=env.admin_id,
            organization_id=env.org_id,
            content_type=ContentType.FOLDER,
            content_id=nested.id,
            subject_type=SubjectType.USER,
            subject_id=env.member_id,
            role=ContentRole.VIEWER,
        )

        accessible = await FolderOperations(session).list_accessible_folders(
            env.member_id, env.org_id
        )
        accessible_ids = {f.id for f in accessible}
        assert nested.id in accessible_ids
        assert private_parent.id not in accessible_ids
    finally:
        await _cleanup(session, env.org_id)


async def test_blocked_member_row_hides_file_in_accessible_folder(
    session, env, quiet_search
) -> None:
    try:
        open_folder = _folder(
            env, access_mode=AccessMode.OPEN_TO_ORG, baseline_role=ContentRole.VIEWER
        )
        session.add(open_folder)
        await session.flush()
        blocked_file = _file(
            env,
            folder_id=open_folder.id,
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )
        control_file = _file(
            env,
            folder_id=open_folder.id,
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )
        session.add_all([blocked_file, control_file])
        await session.commit()

        await ContentMembersOperations(session).add_member(
            actor_user_id=env.admin_id,
            organization_id=env.org_id,
            content_type=ContentType.FILE,
            content_id=blocked_file.id,
            subject_type=SubjectType.USER,
            subject_id=env.member_id,
            role=ContentRole.BLOCKED,
        )

        files, _ = await FileOperations(session).list_files(
            env.member_id,
            env.org_id,
            folder_id=ParentSelection.ALL,
        )
        listed_ids = {f.id for f in files}
        assert control_file.id in listed_ids
        assert blocked_file.id not in listed_ids
    finally:
        await _cleanup(session, env.org_id)
