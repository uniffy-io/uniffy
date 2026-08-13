"""A reader learns an attachment's source file id only if they can open it."""

import pytest
from sqlalchemy import delete

from uniffy.core.models.files.attachment import Attachment
from uniffy.core.models.files.file import File
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.domains.files.attachments.converters import attachment_to_proto
from uniffy.domains.files.attachments.operations import AttachmentOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _file(env, access_mode: AccessMode, owner_id) -> File:
    suffix = generate_id().hex[:8]
    return File(
        organization_id=env.org_id,
        owner_id=owner_id,
        filename=f"itdb-{suffix}.pdf",
        original_filename=f"itdb-{suffix}.pdf",
        mime_type="application/pdf",
        size_bytes=10,
        storage_key=f"itdb/{suffix}",
        storage_bucket="itdb",
        access_mode=access_mode,
        # Materialised like the real create path: this suite's org carries no
        # permissions_org_defaults row, and OPEN_TO_ORG with a NULL baseline
        # everywhere grants nobody anything.
        baseline_role=(
            ContentRole.VIEWER if access_mode == AccessMode.OPEN_TO_ORG else None
        ),
    )


async def test_source_file_id_is_withheld_from_readers_without_access(session, env) -> None:
    private_source = _file(env, AccessMode.OWNER_ONLY, env.admin_id)
    shared_source = _file(env, AccessMode.OPEN_TO_ORG, env.admin_id)
    copy_a = _file(env, AccessMode.OPEN_TO_ORG, env.admin_id)
    copy_b = _file(env, AccessMode.OPEN_TO_ORG, env.admin_id)
    session.add_all([private_source, shared_source, copy_a, copy_b])
    await session.flush()

    message_id = generate_id()
    from_private = Attachment(
        organization_id=env.org_id,
        file_id=copy_a.id,
        source_file_id=private_source.id,
        content_type=ContentType.CHAT_MESSAGE,
        content_id=message_id,
        attached_by_user_id=env.admin_id,
    )
    from_shared = Attachment(
        organization_id=env.org_id,
        file_id=copy_b.id,
        source_file_id=shared_source.id,
        content_type=ContentType.CHAT_MESSAGE,
        content_id=message_id,
        attached_by_user_id=env.admin_id,
    )
    session.add_all([from_private, from_shared])
    await session.commit()

    ops = AttachmentOperations(session)
    try:
        # The attacher owns both sources.
        owner_view = await ops.viewable_source_file_ids(
            env.admin_id, env.org_id, [from_private, from_shared]
        )
        assert owner_view == {private_source.id, shared_source.id}

        # Another member reaches only the org-wide one.
        member_view = await ops.viewable_source_file_ids(
            env.member_id, env.org_id, [from_private, from_shared]
        )
        assert member_view == {shared_source.id}

        leaked = attachment_to_proto(
            from_private,
            copy_a,
            None,
            include_source_file_id=from_private.source_file_id in member_view,
        )
        assert leaked.source_file_id == ""

        kept = attachment_to_proto(
            from_shared,
            copy_b,
            None,
            include_source_file_id=from_shared.source_file_id in member_view,
        )
        assert kept.source_file_id == str(shared_source.id)

    finally:
        await session.rollback()
        await session.execute(
            delete(Attachment).where(Attachment.organization_id == env.org_id)
        )
        await session.execute(delete(File).where(File.organization_id == env.org_id))
        await session.commit()


async def test_converter_denies_by_default(session, env) -> None:
    attachment = Attachment(
        organization_id=env.org_id,
        file_id=generate_id(),
        source_file_id=generate_id(),
        content_type=ContentType.CHAT_MESSAGE,
        content_id=generate_id(),
        attached_by_user_id=env.admin_id,
    )
    proto = attachment_to_proto(attachment, _file(env, AccessMode.OPEN_TO_ORG, env.admin_id))
    assert proto.source_file_id == ""
