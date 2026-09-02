"""Attachments RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from uniffy_proto.files.v1.files_pb2 import (
    AttachFileRequest,
    AttachFileResponse,
    BatchListAttachmentsGroup,
    BatchListAttachmentsRequest,
    BatchListAttachmentsResponse,
    DetachFileRequest,
    DetachFileResponse,
    GetAttachmentsFolderRequest,
    GetAttachmentsFolderResponse,
    ListAttachmentsRequest,
    ListAttachmentsResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.files.file import File
from uniffy.core.models.login.user import User
from uniffy.domains.files.attachments.converters import (
    attachment_to_proto,
    content_type_from_proto,
)
from uniffy.domains.files.attachments.operations import AttachmentOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="files.attachments.handlers")


class AttachmentsHandlersMixin:
    """Attachment RPC handlers, mixed into FilesServiceImpl."""

    async def attach_file(
        self,
        request: AttachFileRequest,
        ctx: RequestContext,
    ) -> AttachFileResponse:
        """Attach a file to content."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
            source_file_id = UUID(request.source_file_id)
            content_id = UUID(request.content_id)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid UUID: {e}")

        content_type = content_type_from_proto(request.content_type)
        if not content_type:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid content_type")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = AttachmentOperations(session, self.storage, self.search_indexer)
                attachment = await ops.attach_file(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                    source_file_id=source_file_id,
                )

                result = await session.execute(
                    select(File, User)
                    .outerjoin(User, File.owner_id == User.id)
                    .where(File.id == attachment.file_id)
                )
                row = result.first()
                file = row[0] if row else None
                owner = row[1] if row else None

                await session.commit()
                if file is not None:
                    await ops.enqueue_processing_jobs(file)

                # The caller supplied the source id and passed the access check
                # on it inside attach_file, so echoing it back reveals nothing.
                return AttachFileResponse(
                    attachment=attachment_to_proto(
                        attachment, file, owner, include_source_file_id=True
                    )
                )

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error attaching file: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def detach_file(
        self,
        request: DetachFileRequest,
        ctx: RequestContext,
    ) -> DetachFileResponse:
        """Detach a file from content."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
            attachment_id = UUID(request.attachment_id)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid UUID: {e}")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = AttachmentOperations(session, self.storage, self.search_indexer)
                success = await ops.detach_file(
                    user_id=user_id,
                    organization_id=organization_id,
                    attachment_id=attachment_id,
                )
                await session.commit()

                msg = "Attachment removed" if success else "Failed to remove"
                return DetachFileResponse(success=success, message=msg)

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error detaching file: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_attachments(
        self,
        request: ListAttachmentsRequest,
        ctx: RequestContext,
    ) -> ListAttachmentsResponse:
        """List attachments for a piece of content."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
            content_id = UUID(request.content_id)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid UUID: {e}")

        content_type = content_type_from_proto(request.content_type)
        if not content_type:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid content_type")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = AttachmentOperations(session, self.storage, self.search_indexer)
                attachments = await ops.list_attachments(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                )
                viewable_sources = await ops.viewable_source_file_ids(
                    user_id, organization_id, [a for a, _, _ in attachments]
                )

                return ListAttachmentsResponse(
                    attachments=[
                        attachment_to_proto(
                            a,
                            f,
                            o,
                            include_source_file_id=a.source_file_id in viewable_sources,
                        )
                        for a, f, o in attachments
                    ],
                    total_count=len(attachments),
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error listing attachments: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def batch_list_attachments(
        self,
        request: BatchListAttachmentsRequest,
        ctx: RequestContext,
    ) -> BatchListAttachmentsResponse:
        """List attachments for many content rows in one call."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid UUID: {e}")

        content_type = content_type_from_proto(request.content_type)
        if not content_type:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid content_type")

        if not request.content_ids:
            return BatchListAttachmentsResponse(groups=[])

        try:
            content_ids = [UUID(cid) for cid in request.content_ids]
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid content_id: {e}")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = AttachmentOperations(session, self.storage, self.search_indexer)
                grouped = await ops.batch_list_attachments(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_ids=content_ids,
                )

                viewable_sources = await ops.viewable_source_file_ids(
                    user_id,
                    organization_id,
                    [a for rows in grouped.values() for a, _, _ in rows],
                )
                groups = [
                    BatchListAttachmentsGroup(
                        content_id=str(cid),
                        attachments=[
                            attachment_to_proto(
                                a,
                                f,
                                o,
                                include_source_file_id=a.source_file_id in viewable_sources,
                            )
                            for a, f, o in rows
                        ],
                    )
                    for cid, rows in grouped.items()
                ]
                return BatchListAttachmentsResponse(groups=groups)

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error batch-listing attachments: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_attachments_folder(
        self,
        request: GetAttachmentsFolderRequest,
        ctx: RequestContext,
    ) -> GetAttachmentsFolderResponse:
        """Get the user's Attachments folder ID."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid UUID: {e}")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = AttachmentOperations(session, self.storage, self.search_indexer)
                folder = await ops.get_or_create_attachments_folder(
                    user_id=user_id,
                    organization_id=organization_id,
                )
                await session.commit()

                return GetAttachmentsFolderResponse(folder_id=str(folder.id))

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error getting attachments folder: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
