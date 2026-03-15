"""Attachments RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.db import get_async_session
from uniffy.domains.attachments.converters import (
    attachment_to_proto,
    content_type_from_proto,
    content_type_to_proto,
)
from uniffy.domains.attachments.operations import AttachmentOperations
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.gen.attachments.v1.attachments_pb2 import (
    AttachFileRequest,
    AttachFileResponse,
    DetachFileRequest,
    DetachFileResponse,
    GetAttachmentsFolderRequest,
    GetAttachmentsFolderResponse,
    ListAttachmentsRequest,
    ListAttachmentsResponse,
    ListSharedAttachmentsRequest,
    ListSharedAttachmentsResponse,
    SharedAttachment,
    SharedAttachmentGroup,
)


class AttachmentsHandlers:
    """Attachments RPC handlers."""

    async def attach_file(
        self,
        request: AttachFileRequest,
        ctx: RequestContext,
    ) -> AttachFileResponse:
        """Attach a file to content."""
        try:
            organization_id = UUID(request.organization_id)
            source_file_id = UUID(request.source_file_id)
            content_id = UUID(request.content_id)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid UUID: {e}")

        content_type = content_type_from_proto(request.content_type)
        if not content_type:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid content_type")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = AttachmentOperations(session)
                attachment = await ops.attach_file(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                    source_file_id=source_file_id,
                )

                # Get the file and owner info
                from sqlalchemy import select

                from uniffy.core.models.files.file import File
                from uniffy.core.models.login.user import User

                result = await session.execute(
                    select(File, User)
                    .outerjoin(User, File.owner_id == User.id)
                    .where(File.id == attachment.file_id)
                )
                row = result.first()
                file = row[0] if row else None
                owner = row[1] if row else None

                await session.commit()

                return AttachFileResponse(attachment=attachment_to_proto(attachment, file, owner))

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error attaching file: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def detach_file(
        self,
        request: DetachFileRequest,
        ctx: RequestContext,
    ) -> DetachFileResponse:
        """Detach a file from content."""
        try:
            organization_id = UUID(request.organization_id)
            attachment_id = UUID(request.attachment_id)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid UUID: {e}")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = AttachmentOperations(session)
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
            logger.error(f"Error detaching file: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def list_attachments(
        self,
        request: ListAttachmentsRequest,
        ctx: RequestContext,
    ) -> ListAttachmentsResponse:
        """List attachments for a piece of content."""
        try:
            organization_id = UUID(request.organization_id)
            content_id = UUID(request.content_id)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid UUID: {e}")

        content_type = content_type_from_proto(request.content_type)
        if not content_type:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid content_type")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = AttachmentOperations(session)
                attachments = await ops.list_attachments(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                )

                return ListAttachmentsResponse(
                    attachments=[attachment_to_proto(a, f, o) for a, f, o in attachments],
                    total_count=len(attachments),
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing attachments: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def list_shared_attachments(
        self,
        request: ListSharedAttachmentsRequest,
        ctx: RequestContext,
    ) -> ListSharedAttachmentsResponse:
        """List attachments from content shared with the user."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid UUID: {e}")

        content_type_filter = None
        if request.HasField("content_type_filter"):
            content_type_filter = content_type_from_proto(request.content_type_filter)

        page = request.page if request.page > 0 else 1
        page_size = request.page_size if request.page_size > 0 else 50

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = AttachmentOperations(session)
                attachments, total = await ops.list_shared_attachments(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type_filter=content_type_filter,
                    page=page,
                    page_size=page_size,
                )

                # Group by content type
                groups_dict: dict = {}
                for attachment, file, owner in attachments:
                    ct = attachment.content_type
                    if ct not in groups_dict:
                        groups_dict[ct] = []
                    groups_dict[ct].append(
                        SharedAttachment(
                            attachment=attachment_to_proto(attachment, file, owner),
                            content_title="",  # TODO: Fetch content title
                            content_owner_name="",  # TODO: Fetch content owner
                        )
                    )

                groups = [
                    SharedAttachmentGroup(
                        content_type=content_type_to_proto(ct),
                        attachments=items,
                    )
                    for ct, items in groups_dict.items()
                ]

                total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0

                return ListSharedAttachmentsResponse(
                    groups=groups,
                    total_count=total,
                    page=page,
                    page_size=page_size,
                    total_pages=total_pages,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing shared attachments: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def get_attachments_folder(
        self,
        request: GetAttachmentsFolderRequest,
        ctx: RequestContext,
    ) -> GetAttachmentsFolderResponse:
        """Get the user's Attachments folder ID."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid UUID: {e}")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = AttachmentOperations(session)
                folder = await ops.get_or_create_attachments_folder(
                    user_id=user_id,
                    organization_id=organization_id,
                )
                await session.commit()

                return GetAttachmentsFolderResponse(folder_id=str(folder.id))

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting attachments folder: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")
