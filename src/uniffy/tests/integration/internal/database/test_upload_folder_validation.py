"""initiate_upload validates the destination folder; stats never cross tenants."""

import pytest
from sqlalchemy import delete

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.files.operations import FileOperations, FolderOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _cleanup(session, org_ids) -> None:
    await session.rollback()
    await session.execute(delete(File).where(File.organization_id.in_(org_ids)))
    await session.execute(delete(Folder).where(Folder.organization_id.in_(org_ids)))
    await session.commit()


async def test_initiate_upload_rejects_foreign_and_unviewable_folders(
    session, env, second_env
) -> None:
    folder = Folder(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name="itdb-target",
        access_mode=AccessMode.OWNER_ONLY,
    )
    session.add(folder)
    await session.commit()

    file_ops = FileOperations(session)
    try:
        with pytest.raises(NotFoundError):
            await file_ops.initiate_upload(
                user_id=second_env.admin_id,
                organization_id=second_env.org_id,
                filename="itdb.txt",
                mime_type="text/plain",
                total_size=10,
                folder_id=folder.id,
            )

        with pytest.raises(NotFoundError):
            await file_ops.initiate_upload(
                user_id=env.admin_id,
                organization_id=env.org_id,
                filename="itdb.txt",
                mime_type="text/plain",
                total_size=10,
                folder_id=generate_id(),
            )

        with pytest.raises(PermissionDeniedError):
            await file_ops.initiate_upload(
                user_id=env.member_id,
                organization_id=env.org_id,
                filename="itdb.txt",
                mime_type="text/plain",
                total_size=10,
                folder_id=folder.id,
            )
    finally:
        await _cleanup(session, [env.org_id, second_env.org_id])


async def test_child_stats_ignore_rows_from_other_orgs(session, env, second_env) -> None:
    folder = Folder(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        name="itdb-scoped",
        access_mode=AccessMode.OPEN_TO_ORG,
    )
    session.add(folder)
    await session.flush()
    session.add(
        # A row in another tenant pointing at this folder id must stay uncounted.
        File(
            organization_id=second_env.org_id,
            owner_id=second_env.admin_id,
            filename="itdb-foreign.txt",
            original_filename="itdb-foreign.txt",
            mime_type="text/plain",
            size_bytes=999,
            storage_key="itdb/foreign",
            storage_bucket="itdb",
            folder_id=folder.id,
            access_mode=AccessMode.OPEN_TO_ORG,
        )
    )
    await session.commit()

    try:
        stats = await FolderOperations(session)._child_stats(
            folder, AccessMode.OPEN_TO_ORG
        )
        assert stats == {"file_count": "0", "folder_count": "0", "total_size": "0"}
    finally:
        await _cleanup(session, [env.org_id, second_env.org_id])
