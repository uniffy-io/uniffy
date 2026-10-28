"""Membership removal, reactivation and org shutdown, proven on the rows the gates return."""

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
import pytest_asyncio
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from uniffy_proto.files.v1.files_pb import (
    CompleteUploadRequest,
    GetUploadStatusRequest,
    UploadChunkRequest,
)
from uniffy_proto.organizations.v1.organizations_pb import GetOrganizationRequest

from uniffy.core.audit.actions import Action
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.errors import MembershipRequiredError, PermissionDeniedError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.files.file import File
from uniffy.core.models.files.multipart_part import MultipartPart
from uniffy.core.models.files.multipart_upload import MultipartUpload, UploadStatus
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationMemberSource,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.models.notes.note import Note
from uniffy.core.types import AccessMode, ContentType, generate_id
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.files.rpc.uploads import UploadHandlers
from uniffy.domains.files.uploads import MIN_CHUNK_SIZE, effective_upload_status
from uniffy.domains.organizations.handlers import OrganizationsHandlers
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.platform.directory.operations import PlatformDirectoryOperations
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.calls import _make_system_admin
from uniffy.tests.integration.access.rpc_calls import call_rpc
from uniffy.transport.rpc import ERROR_INFO_DOMAIN, MEMBERSHIP_REQUIRED_REASON

pytestmark = pytest.mark.asyncio(loop_scope="session")
_ERROR_INFO = "google.rpc.ErrorInfo"
_NOT_FOUND = "Upload not found"


async def _membership(session, user_id: UUID, org_id: UUID) -> OrganizationMember:
    return (
        await session.execute(
            select(OrganizationMember)
            .where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == org_id,
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _remove(session, access, target_user_id: UUID) -> bool:
    return await OrganizationOperations(session).remove_member(
        access.owner_id,
        access.org_id,
        target_user_id,
        search_indexer=AsyncMock(),
        call_lifecycle=CallsLifecycle(open_session),
    )


async def _join_other_org(session, access, user_id: UUID) -> None:
    session.add(
        OrganizationMember(
            user_id=user_id,
            organization_id=access.other_org_id,
            role=OrganizationRole.MEMBER,
        )
    )
    await session.commit()


async def _visible_note_ids(session, user_id: UUID, org_id: UUID) -> set[UUID]:
    condition = await ContentAccessQuery(session).build_accessible_filter(
        user_id=user_id,
        organization_id=org_id,
        content_type=ContentType.NOTE,
        content_id_column=Note.id,
        owner_id_column=Note.owner_id,
        access_mode_column=Note.access_mode,
        baseline_role_column=Note.baseline_role,
    )
    rows = await session.execute(select(Note.id).where(Note.organization_id == org_id, condition))
    return {row[0] for row in rows.all()}


async def _removal_audit_count(session, access, user_id: UUID) -> int:
    return (
        await session.execute(
            select(func.count())
            .select_from(AuditEvent)
            .where(
                AuditEvent.organization_id == access.org_id,
                AuditEvent.action == Action.ORGANIZATION_MEMBER_REMOVED,
                AuditEvent.resource_id == user_id,
            )
        )
    ).scalar_one()


async def _user_org_ids(session, user_id: UUID) -> list[UUID]:
    rows = await OrganizationOperations(session).get_user_organizations(user_id)
    return [org.id for org, _ in rows]


@pytest_asyncio.fixture(loop_scope="session")
async def in_flight_upload(session, access) -> AsyncIterator[MultipartUpload]:
    """The member's two-part upload with its first part already stored."""
    upload = MultipartUpload(
        organization_id=access.org_id,
        user_id=access.member_id,
        s3_upload_id=f"upload-{generate_id()}",
        storage_key=f"{access.org_id}/{access.member_id}/{generate_id()}/report.bin",
        storage_bucket="test",
        filename="report.bin",
        mime_type="application/octet-stream",
        total_size=MIN_CHUNK_SIZE + 4,
        total_chunks=2,
        chunk_size=MIN_CHUNK_SIZE,
        access_mode=AccessMode.OWNER_ONLY,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    session.add(upload)
    await session.flush()
    session.add(
        MultipartPart(upload_id=upload.id, part_number=1, etag="etag-1", size=MIN_CHUNK_SIZE)
    )
    await session.commit()
    upload_id = upload.id
    try:
        yield upload
    finally:
        await session.rollback()
        await session.execute(delete(MultipartPart).where(MultipartPart.upload_id == upload_id))
        await session.execute(delete(MultipartUpload).where(MultipartUpload.id == upload_id))
        await session.commit()


def _upload_handlers() -> UploadHandlers:
    handlers = UploadHandlers()
    handlers.storage = MagicMock()
    handlers.storage.upload_part = AsyncMock(return_value="etag-2")
    handlers.storage.complete_multipart_upload = AsyncMock()
    handlers.search_indexer = AsyncMock()
    return handlers


async def _upload_refusal(handler, request, access) -> ConnectError:
    with pytest.raises(ConnectError) as refused:
        await call_rpc(handler, request, user_id=access.member_id, organization_id=access.org_id)
    return refused.value


async def _upload_row(session, upload_id: UUID) -> MultipartUpload:
    return await session.get(MultipartUpload, upload_id, populate_existing=True)


class TestRemoval:
    async def test_removal_keeps_the_row_and_cuts_off_every_gate(self, session, access) -> None:
        assert access.private_note_id in await _visible_note_ids(
            session, access.member_id, access.org_id
        )

        assert await _remove(session, access, access.member_id) is True

        row = await _membership(session, access.member_id, access.org_id)
        assert row.is_active is False
        assert row.removed_at is not None
        assert row.removed_by_user_id == access.owner_id
        with pytest.raises(MembershipRequiredError):
            await OrganizationOperations(session).require_org_member(access.member_id, access.org_id)
        assert access.org_id not in await _user_org_ids(session, access.member_id)
        assert await _visible_note_ids(session, access.member_id, access.org_id) == set()

    async def test_a_removed_member_is_told_the_membership_is_gone(self, session, access) -> None:
        await _remove(session, access, access.member_id)

        with pytest.raises(ConnectError) as refused:
            await call_rpc(
                OrganizationsHandlers().get_organization,
                GetOrganizationRequest(organization_id=str(access.org_id)),
                user_id=access.member_id,
                organization_id=access.org_id,
            )

        assert refused.value.code is Code.PERMISSION_DENIED
        assert refused.value.message == "Permission denied: Requires organization membership"
        [detail] = refused.value.details
        assert detail.type_name == _ERROR_INFO
        reason, domain = MEMBERSHIP_REQUIRED_REASON.encode(), ERROR_INFO_DOMAIN.encode()
        assert detail.message_bytes == (
            bytes([0x0A, len(reason)]) + reason + bytes([0x12, len(domain)]) + domain
        )

    async def test_an_upload_started_before_removal_is_dead_after_it(
        self, session, access, in_flight_upload
    ) -> None:
        upload_id = in_flight_upload.id
        storage_key = in_flight_upload.storage_key
        handlers = _upload_handlers()

        await _remove(session, access, access.member_id)

        removed_at = (await _membership(session, access.member_id, access.org_id)).removed_at
        row = await _upload_row(session, upload_id)
        assert row.expires_at == removed_at
        assert effective_upload_status(row) is UploadStatus.EXPIRED
        for handler, request in (
            (handlers.get_upload_status, GetUploadStatusRequest(upload_id=str(upload_id))),
            (
                handlers.upload_chunk,
                UploadChunkRequest(upload_id=str(upload_id), chunk_number=2, data=b"tail"),
            ),
            (handlers.complete_upload, CompleteUploadRequest(upload_id=str(upload_id))),
        ):
            error = await _upload_refusal(handler, request, access)
            assert (error.code, error.message) == (Code.NOT_FOUND, _NOT_FOUND)
        handlers.storage.upload_part.assert_not_awaited()
        handlers.storage.complete_multipart_upload.assert_not_awaited()
        assert (
            await session.scalar(
                select(func.count()).select_from(File).where(File.storage_key == storage_key)
            )
            == 0
        )

        await OrganizationOperations(session).stage_member(
            access.member_id,
            access.org_id,
            actor_user_id=access.admin_id,
            source=OrganizationMemberSource.INVITE,
            invited_by_user_id=access.admin_id,
        )
        await session.commit()

        error = await _upload_refusal(
            handlers.upload_chunk,
            UploadChunkRequest(upload_id=str(upload_id), chunk_number=2, data=b"tail"),
            access,
        )
        assert error.code is Code.FAILED_PRECONDITION
        assert "EXPIRED" in error.message
        handlers.storage.upload_part.assert_not_awaited()

    async def test_removal_leaves_the_members_uploads_in_other_orgs_alone(
        self, session, access, in_flight_upload
    ) -> None:
        await session.execute(
            update(MultipartUpload)
            .where(MultipartUpload.id == in_flight_upload.id)
            .values(organization_id=access.other_org_id)
        )
        await session.commit()
        await _join_other_org(session, access, access.member_id)
        expires_at = (await _upload_row(session, in_flight_upload.id)).expires_at

        await _remove(session, access, access.member_id)

        row = await _upload_row(session, in_flight_upload.id)
        assert row.expires_at == expires_at
        assert effective_upload_status(row) is UploadStatus.ACTIVE

    async def test_re_adding_reactivates_the_same_row(self, session, access) -> None:
        removed_row_id = (await _membership(session, access.member_id, access.org_id)).id
        await _remove(session, access, access.member_id)

        await OrganizationOperations(session).stage_member(
            access.member_id,
            access.org_id,
            actor_user_id=access.admin_id,
            source=OrganizationMemberSource.INVITE,
            invited_by_user_id=access.admin_id,
        )
        await session.commit()

        row = await _membership(session, access.member_id, access.org_id)
        assert row.id == removed_row_id
        assert row.is_active is True
        assert row.removed_at is None
        assert row.removed_by_user_id is None
        assert row.source is OrganizationMemberSource.INVITE
        assert row.invited_by_user_id == access.admin_id
        assert access.private_note_id in await _visible_note_ids(
            session, access.member_id, access.org_id
        )

    async def test_a_second_removal_is_a_no_op(self, session, access) -> None:
        assert await _remove(session, access, access.member_id) is True
        first_removed_at = (await _membership(session, access.member_id, access.org_id)).removed_at

        assert await _remove(session, access, access.member_id) is False

        assert await _removal_audit_count(session, access, access.member_id) == 1
        row = await _membership(session, access.member_id, access.org_id)
        assert row.removed_at == first_removed_at

    async def test_a_duplicate_membership_row_is_refused(self, session, access) -> None:
        session.add(
            OrganizationMember(
                user_id=access.member_id,
                organization_id=access.org_id,
                role=OrganizationRole.MEMBER,
            )
        )
        with pytest.raises(IntegrityError):
            await session.flush()
        await session.rollback()


class TestOrganizationListing:
    async def test_deleted_orgs_drop_out_and_suspended_orgs_stay_flagged(
        self, session, access
    ) -> None:
        await _join_other_org(session, access, access.member_id)
        await session.execute(
            update(Organization)
            .where(Organization.id == access.org_id)
            .values(is_suspended=True, suspended_at=datetime.now(UTC))
        )
        await session.execute(
            update(Organization)
            .where(Organization.id == access.other_org_id)
            .values(deleted_at=datetime.now(UTC))
        )
        await session.commit()

        rows = await OrganizationOperations(session).get_user_organizations(access.member_id)

        assert [(org.id, org.is_suspended) for org, _ in rows] == [(access.org_id, True)]


class TestSuspension:
    async def test_suspension_cuts_off_only_that_org(self, session, access) -> None:
        await _make_system_admin(session, access.outsider_id)
        await _join_other_org(session, access, access.member_id)
        token_version = (
            await session.execute(select(User.token_version).where(User.id == access.member_id))
        ).scalar_one()

        await PlatformDirectoryOperations(
            session, CallsLifecycle(open_session)
        ).suspend_organization(
            user_id=access.outsider_id, organization_id=access.org_id, reason="abuse"
        )

        assert (
            await session.execute(select(User.token_version).where(User.id == access.member_id))
        ).scalar_one() == token_version
        ops = OrganizationOperations(session)
        with pytest.raises(PermissionDeniedError):
            await ops.require_org_member(access.member_id, access.org_id)
        assert await _visible_note_ids(session, access.member_id, access.org_id) == set()
        other = await ops.require_org_member(access.member_id, access.other_org_id)
        assert other.organization_id == access.other_org_id
