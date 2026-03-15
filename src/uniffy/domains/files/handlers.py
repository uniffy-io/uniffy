"""Files RPC handlers - thin layer delegating to operations."""

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.login.user import User
from uniffy.core.storage import get_s3_client
from uniffy.db import get_async_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.files.converters import (
    file_to_proto,
    file_version_to_proto,
    folder_to_proto,
    tree_node_from_file,
    tree_node_from_folder,
    upload_to_proto_status,
    visibility_from_proto,
)
from uniffy.domains.files.operations import FileOperations, FolderOperations
from uniffy.gen.files.v1.files_pb2 import (
    AbortUploadRequest,
    AbortUploadResponse,
    BulkDeleteRequest,
    BulkDeleteResponse,
    CompleteUploadRequest,
    CopyItemsRequest,
    CopyItemsResponse,
    CreateFolderRequest,
    DeleteFileRequest,
    DeleteFileResponse,
    DeleteFolderRequest,
    DeleteFolderResponse,
    DownloadChunkResponse,
    DownloadFileRequest,
    EmptyTrashRequest,
    EmptyTrashResponse,
    FileResponse,
    FolderResponse,
    GetFileRequest,
    GetFilesTreeRequest,
    GetFilesTreeResponse,
    GetUploadStatusRequest,
    GetUploadStatusResponse,
    InitiateUploadRequest,
    InitiateUploadResponse,
    ListFilesRequest,
    ListFilesResponse,
    ListFileVersionsRequest,
    ListFileVersionsResponse,
    MoveItemsRequest,
    MoveItemsResponse,
    RestoreFileRequest,
    RestoreFileVersionRequest,
    StreamFileRangeRequest,
    StreamFileRangeResponse,
    TreeNode,
    UpdateFileRequest,
    UpdateFolderRequest,
    UploadChunkRequest,
    UploadChunkResponse,
    UploadChunksResponse,
)


class FilesHandlers:
    """Files RPC handlers."""

    # ─────────────────────────────────────────────────────────────
    # Upload handlers
    # ─────────────────────────────────────────────────────────────

    async def initiate_upload(
        self,
        request: InitiateUploadRequest,
        ctx: RequestContext,
    ) -> InitiateUploadResponse:
        """Initialize a new upload session."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = FileOperations(session)

                visibility = visibility_from_proto(request.visibility)
                folder_id = None
                if request.HasField("folder_id"):
                    try:
                        folder_id = UUID(request.folder_id)
                    except ValueError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid folder_id")

                logger.info(f"[Upload] Initiating upload with folder_id={folder_id}")

                upload = await ops.initiate_upload(
                    user_id=user_id,
                    organization_id=organization_id,
                    filename=request.filename,
                    mime_type=request.mime_type,
                    total_size=request.total_size,
                    folder_id=folder_id,
                    visibility=visibility,
                )

                return InitiateUploadResponse(
                    upload_id=str(upload.id),
                    chunk_size=upload.chunk_size,
                    total_chunks=upload.total_chunks,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error initiating upload: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def upload_chunk(
        self,
        request: UploadChunkRequest,
        ctx: RequestContext,
    ) -> UploadChunkResponse:
        """
        Upload a single chunk (browser-compatible unary RPC).

        Call this for each chunk, then call CompleteUpload when done.
        """
        try:
            upload_id = UUID(request.upload_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid upload_id")

        user_id = get_user_id_from_context(ctx)
        s3 = get_s3_client()

        try:
            async for session in get_async_session():
                ops = FileOperations(session)

                # Get upload info and verify ownership
                upload = await ops.get_upload_status(upload_id)
                if not upload:
                    raise ConnectError(Code.NOT_FOUND, "Upload not found")
                if upload.user_id != user_id:
                    raise ConnectError(Code.PERMISSION_DENIED, "Not your upload")

                # Upload part to S3
                etag = await s3.upload_part(
                    key=upload.storage_key,
                    upload_id=upload.s3_upload_id,
                    part_number=request.chunk_number,
                    data=request.data,
                )

                # Record completion
                await ops.record_chunk_completed(
                    upload_id=upload_id,
                    part_number=request.chunk_number,
                    etag=etag,
                    size=len(request.data),
                )

                # Get updated status
                upload = await ops.get_upload_status(upload_id)
                chunks_received = len(upload.get_completed_chunk_numbers())

                return UploadChunkResponse(
                    success=True,
                    chunk_number=request.chunk_number,
                    chunks_received=chunks_received,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error uploading chunk: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def complete_upload(
        self,
        request: CompleteUploadRequest,
        ctx: RequestContext,
    ) -> UploadChunksResponse:
        """
        Complete an upload after all chunks have been sent.

        Returns the completed file.
        """
        try:
            upload_id = UUID(request.upload_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid upload_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = FileOperations(session)

                # Complete the upload
                file = await ops.complete_upload(
                    upload_id=upload_id,
                    user_id=user_id,
                )

                logger.info(f"[Upload] Completed file id={file.id} folder_id={file.folder_id}")

                return UploadChunksResponse(file=file_to_proto(file))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Upload not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Not your upload")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error completing upload: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def upload_chunks(
        self,
        request_iterator: AsyncIterator[UploadChunkRequest],
        ctx: RequestContext,
    ) -> UploadChunksResponse:
        """
        Stream file chunks from client.

        This is a client streaming RPC - the client sends multiple chunks,
        and we return the completed file when done.
        """
        user_id = get_user_id_from_context(ctx)
        s3 = get_s3_client()

        upload_id: UUID | None = None
        storage_key: str | None = None
        s3_upload_id: str | None = None

        try:
            async for session in get_async_session():
                ops = FileOperations(session)

                async for chunk in request_iterator:
                    # First chunk - get upload info
                    if upload_id is None:
                        try:
                            upload_id = UUID(chunk.upload_id)
                        except ValueError:
                            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid upload_id")

                        upload = await ops.get_upload_status(upload_id)
                        if not upload:
                            raise ConnectError(Code.NOT_FOUND, "Upload not found")

                        if upload.user_id != user_id:
                            raise ConnectError(Code.PERMISSION_DENIED, "Not your upload")

                        storage_key = upload.storage_key
                        s3_upload_id = upload.s3_upload_id

                    # Upload part to S3
                    etag = await s3.upload_part(
                        key=storage_key,
                        upload_id=s3_upload_id,
                        part_number=chunk.chunk_number,
                        data=chunk.data,
                    )

                    # Record completion
                    await ops.record_chunk_completed(
                        upload_id=upload_id,
                        part_number=chunk.chunk_number,
                        etag=etag,
                        size=len(chunk.data),
                    )

                    # If last chunk, complete the upload
                    if chunk.is_last:
                        file = await ops.complete_upload(
                            upload_id=upload_id,
                            user_id=user_id,
                        )
                        return UploadChunksResponse(file=file_to_proto(file))

                # If we get here without is_last, something went wrong
                raise ConnectError(Code.INVALID_ARGUMENT, "Upload stream ended without is_last")

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error in upload_chunks: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def get_upload_status(
        self,
        request: GetUploadStatusRequest,
        ctx: RequestContext,
    ) -> GetUploadStatusResponse:
        """Get status of an in-progress upload."""
        try:
            upload_id = UUID(request.upload_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid upload_id")

        get_user_id_from_context(ctx)  # Verify auth

        try:
            async for session in get_async_session():
                ops = FileOperations(session)
                upload = await ops.get_upload_status(upload_id)

                if not upload:
                    raise ConnectError(Code.NOT_FOUND, "Upload not found")

                completed_chunks = upload.get_completed_chunk_numbers()

                return GetUploadStatusResponse(
                    upload_id=str(upload.id),
                    completed_chunks=completed_chunks,
                    total_chunks=upload.total_chunks,
                    status=upload_to_proto_status(upload),
                    filename=upload.filename,
                    total_size=upload.total_size,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting upload status: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def abort_upload(
        self,
        request: AbortUploadRequest,
        ctx: RequestContext,
    ) -> AbortUploadResponse:
        """Abort an in-progress upload."""
        try:
            upload_id = UUID(request.upload_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid upload_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = FileOperations(session)
                await ops.abort_upload(upload_id, user_id)

                return AbortUploadResponse(
                    success=True,
                    message="Upload aborted successfully",
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Upload not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Not your upload")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error aborting upload: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    # ─────────────────────────────────────────────────────────────
    # Download handler (server streaming)
    # ─────────────────────────────────────────────────────────────

    async def download_file(
        self,
        request: DownloadFileRequest,
        ctx: RequestContext,
    ) -> AsyncIterator[DownloadChunkResponse]:
        """
        Stream file content to client.

        This is a server streaming RPC - we send multiple chunks to the client.
        """
        try:
            file_id = UUID(request.file_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = FileOperations(session)

                # Get file and check permissions
                file = await ops.get_by_id(user_id, organization_id, file_id)

                # Stream from S3
                s3 = get_s3_client()
                first_chunk = True

                async for chunk_data, chunk_num, total_chunks in s3.download_stream(
                    key=file.storage_key
                ):
                    response = DownloadChunkResponse(
                        data=chunk_data,
                        chunk_number=chunk_num,
                        total_chunks=total_chunks,
                    )

                    # Include metadata in first chunk
                    if first_chunk:
                        response.filename = file.filename
                        response.mime_type = file.mime_type
                        response.total_size = file.size_bytes
                        first_chunk = False

                    yield response

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "File not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error downloading file: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def stream_file_range(
        self,
        request: StreamFileRangeRequest,
        ctx: RequestContext,
    ) -> AsyncIterator[StreamFileRangeResponse]:
        """
        Stream file with byte range support for Service Worker.

        This handler supports HTTP Range-like semantics, allowing media
        players to seek within large files without downloading everything.
        """
        try:
            file_id = UUID(request.file_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        # Parse optional range parameters
        start_byte = request.start_byte if request.HasField("start_byte") else None
        end_byte = request.end_byte if request.HasField("end_byte") else None

        try:
            async for session in get_async_session():
                ops = FileOperations(session)

                # Get file and check permissions
                file = await ops.get_by_id(user_id, organization_id, file_id)

                # Stream from S3 with range support
                s3 = get_s3_client()
                is_first = True

                async for chunk_data, total_size, range_start, range_end in s3.download_range(
                    key=file.storage_key,
                    start_byte=start_byte,
                    end_byte=end_byte,
                ):
                    response = StreamFileRangeResponse(
                        data=chunk_data,
                        total_size=total_size,
                        range_start=range_start,
                        range_end=range_end,
                        is_first_chunk=is_first,
                    )

                    # Include metadata in first chunk
                    if is_first:
                        response.mime_type = file.mime_type
                        response.filename = file.filename
                        is_first = False

                    yield response

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "File not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error streaming file range: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    # ─────────────────────────────────────────────────────────────
    # File CRUD handlers
    # ─────────────────────────────────────────────────────────────

    async def get_file(
        self,
        request: GetFileRequest,
        ctx: RequestContext,
    ) -> FileResponse:
        """Get a file by ID."""
        try:
            file_id = UUID(request.file_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = FileOperations(session)
                file = await ops.get_by_id(user_id, organization_id, file_id)
                return FileResponse(file=file_to_proto(file))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "File not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting file: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def update_file(
        self,
        request: UpdateFileRequest,
        ctx: RequestContext,
    ) -> FileResponse:
        """Update file metadata."""
        try:
            file_id = UUID(request.file_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = FileOperations(session)

                visibility = None
                if request.HasField("visibility"):
                    visibility = visibility_from_proto(request.visibility)

                file = await ops.update(
                    user_id=user_id,
                    organization_id=organization_id,
                    file_id=file_id,
                    filename=request.filename if request.HasField("filename") else None,
                    tags=list(request.tags) if request.tags else None,
                    description=request.description if request.HasField("description") else None,
                    visibility=visibility,
                )

                return FileResponse(file=file_to_proto(file))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "File not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e) or "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            if "ValidationError" in type(e).__name__:
                raise ConnectError(Code.INVALID_ARGUMENT, str(e))
            logger.error(f"Error updating file: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def delete_file(
        self,
        request: DeleteFileRequest,
        ctx: RequestContext,
    ) -> DeleteFileResponse:
        """Delete a file."""
        try:
            file_id = UUID(request.file_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = FileOperations(session)
                await ops.delete(
                    user_id=user_id,
                    organization_id=organization_id,
                    file_id=file_id,
                    permanent=request.permanent,
                )

                message = "File permanently deleted" if request.permanent else "File moved to trash"
                return DeleteFileResponse(success=True, message=message)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "File not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting file: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def restore_file(
        self,
        request: RestoreFileRequest,
        ctx: RequestContext,
    ) -> FileResponse:
        """Restore a soft-deleted file."""
        try:
            file_id = UUID(request.file_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = FileOperations(session)
                file = await ops.restore(
                    user_id=user_id,
                    organization_id=organization_id,
                    file_id=file_id,
                )
                return FileResponse(file=file_to_proto(file))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "File not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error restoring file: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def list_files(
        self,
        request: ListFilesRequest,
        ctx: RequestContext,
    ) -> ListFilesResponse:
        """List files with filters and pagination."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        folder_id = None
        if request.HasField("folder_id"):
            if request.folder_id == "all":
                folder_id = "all"
            elif request.folder_id == "":
                folder_id = None  # Root
            else:
                try:
                    folder_id = UUID(request.folder_id)
                except ValueError:
                    raise ConnectError(Code.INVALID_ARGUMENT, "Invalid folder_id")

        group_id = None
        if request.HasField("group_id"):
            try:
                group_id = UUID(request.group_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid group_id")

        visibility = None
        if request.HasField("visibility"):
            visibility = visibility_from_proto(request.visibility)

        try:
            async for session in get_async_session():
                ops = FileOperations(session)
                files, total = await ops.list_files(
                    user_id=user_id,
                    organization_id=organization_id,
                    folder_id=folder_id,
                    visibility=visibility,
                    group_id=group_id,
                    personal_only=request.personal_only,
                    shared_only=request.shared_only,
                    include_deleted=request.include_deleted,
                    tags=list(request.tags) if request.tags else None,
                    page=max(1, request.page or 1),
                    page_size=min(100, max(1, request.page_size or 50)),
                    sort_by=request.sort_by or "updated_at",
                    sort_order=request.sort_order or "desc",
                )

                # Fetch owner info for all files
                owner_ids = list({f.owner_id for f in files})
                owner_info_map: dict[UUID, dict] = {}
                if owner_ids:
                    result = await session.execute(
                        select(User.id, User.full_name, User.email).where(User.id.in_(owner_ids))
                    )
                    for row in result.all():
                        owner_info_map[row.id] = {
                            "id": row.id,
                            "name": row.full_name,
                            "email": row.email,
                        }

                page_size = request.page_size or 50
                total_pages = (total + page_size - 1) // page_size

                return ListFilesResponse(
                    files=[
                        file_to_proto(f, owner_info=owner_info_map.get(f.owner_id)) for f in files
                    ],
                    total_count=total,
                    page=request.page or 1,
                    page_size=page_size,
                    total_pages=total_pages,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing files: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    # ─────────────────────────────────────────────────────────────
    # Folder handlers
    # ─────────────────────────────────────────────────────────────

    async def create_folder(
        self,
        request: CreateFolderRequest,
        ctx: RequestContext,
    ) -> FolderResponse:
        """Create a new folder."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        parent_id = None
        if request.HasField("parent_id"):
            try:
                parent_id = UUID(request.parent_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid parent_id")

        visibility = visibility_from_proto(request.visibility)

        try:
            async for session in get_async_session():
                ops = FolderOperations(session)
                folder = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    name=request.name,
                    parent_id=parent_id,
                    visibility=visibility,
                )
                return FolderResponse(folder=folder_to_proto(folder))

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating folder: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def update_folder(
        self,
        request: UpdateFolderRequest,
        ctx: RequestContext,
    ) -> FolderResponse:
        """Update a folder."""
        try:
            folder_id = UUID(request.folder_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        parent_id = None
        if request.HasField("parent_id"):
            if request.parent_id == "":
                parent_id = ""  # Move to root
            else:
                try:
                    parent_id = UUID(request.parent_id)
                except ValueError:
                    raise ConnectError(Code.INVALID_ARGUMENT, "Invalid parent_id")

        visibility = None
        if request.HasField("visibility"):
            visibility = visibility_from_proto(request.visibility)

        try:
            async for session in get_async_session():
                ops = FolderOperations(session)
                folder = await ops.update(
                    user_id=user_id,
                    organization_id=organization_id,
                    folder_id=folder_id,
                    name=request.name if request.HasField("name") else None,
                    parent_id=parent_id,
                    visibility=visibility,
                )
                return FolderResponse(folder=folder_to_proto(folder))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Folder not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e) or "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            if "ValidationError" in type(e).__name__:
                raise ConnectError(Code.INVALID_ARGUMENT, str(e))
            logger.error(f"Error updating folder: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def delete_folder(
        self,
        request: DeleteFolderRequest,
        ctx: RequestContext,
    ) -> DeleteFolderResponse:
        """Delete a folder."""
        try:
            folder_id = UUID(request.folder_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = FolderOperations(session)
                files_deleted, folders_deleted = await ops.delete(
                    user_id=user_id,
                    organization_id=organization_id,
                    folder_id=folder_id,
                    permanent=request.permanent,
                    recursive=request.recursive,
                )

                return DeleteFolderResponse(
                    success=True,
                    message="Folder deleted successfully",
                    files_deleted=files_deleted,
                    folders_deleted=folders_deleted,
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Folder not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting folder: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def get_files_tree(
        self,
        request: GetFilesTreeRequest,
        ctx: RequestContext,
    ) -> GetFilesTreeResponse:
        """Get the file/folder tree."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        root_folder_id = None
        if request.HasField("root_folder_id"):
            try:
                root_folder_id = UUID(request.root_folder_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid root_folder_id")

        try:
            async for session in get_async_session():
                folder_ops = FolderOperations(session)
                file_ops = FileOperations(session)

                # Recursive helper to build tree with nested children
                # Returns tuple of (nodes, total_size_bytes)
                async def build_folder_tree(
                    parent_id: UUID | None,
                    _folder_ops: FolderOperations = folder_ops,
                    _file_ops: FileOperations = file_ops,
                ) -> tuple[list[TreeNode], int]:
                    folders = await _folder_ops.list_folders(
                        user_id=user_id,
                        organization_id=organization_id,
                        parent_id=parent_id,
                        personal_only=request.personal_only,
                    )

                    nodes = []
                    parent_total_size = 0

                    for folder in folders:
                        # Recursively get children and their size
                        child_nodes, children_size = await build_folder_tree(folder.id)

                        # Get files in this folder
                        child_files, _ = await _file_ops.list_files(
                            user_id=user_id,
                            organization_id=organization_id,
                            folder_id=folder.id,
                            personal_only=request.personal_only,
                        )

                        # Calculate total size: files in this folder + size from subfolders
                        folder_files_size = sum(f.size_bytes for f in child_files)
                        folder_total_size = folder_files_size + children_size

                        # Include files as children if requested
                        if request.include_files:
                            for file in child_files:
                                child_nodes.append(tree_node_from_file(file))

                        # Count subfolders + files (files already in child_nodes when include_files)
                        file_count = 0 if request.include_files else len(child_files)
                        child_count = len(child_nodes) + file_count
                        node = tree_node_from_folder(folder, child_count, folder_total_size)
                        node.children.extend(child_nodes)
                        nodes.append(node)

                        # Add this folder's total to parent's accumulator
                        parent_total_size += folder_total_size

                    return nodes, parent_total_size

                # Build the tree starting from root
                nodes, _ = await build_folder_tree(root_folder_id)

                # Include files at root level if requested
                if request.include_files:
                    files, _ = await file_ops.list_files(
                        user_id=user_id,
                        organization_id=organization_id,
                        folder_id=root_folder_id,
                        personal_only=request.personal_only,
                    )
                    for file in files:
                        nodes.append(tree_node_from_file(file))

                return GetFilesTreeResponse(nodes=nodes)

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting files tree: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    # ─────────────────────────────────────────────────────────────
    # Bulk operations
    # ─────────────────────────────────────────────────────────────

    async def empty_trash(
        self,
        request: EmptyTrashRequest,
        ctx: RequestContext,
    ) -> EmptyTrashResponse:
        """Empty trash for the current user."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = FileOperations(session)
                files_deleted, folders_deleted = await ops.empty_trash(
                    user_id=user_id,
                    organization_id=organization_id,
                )

                return EmptyTrashResponse(
                    success=True,
                    message=f"Deleted {files_deleted} files and {folders_deleted} folders",
                    files_deleted=files_deleted,
                    folders_deleted=folders_deleted,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error emptying trash: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def list_file_versions(
        self,
        request: ListFileVersionsRequest,
        ctx: RequestContext,
    ) -> ListFileVersionsResponse:
        """List version history for a file."""
        try:
            file_id = UUID(request.file_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = FileOperations(session)

                # Verify access
                await ops.get_by_id(user_id, organization_id, file_id)

                # Get versions
                versions = await ops._get_file_versions(file_id)

                return ListFileVersionsResponse(
                    versions=[file_version_to_proto(v) for v in versions],
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "File not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing file versions: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    # ─────────────────────────────────────────────────────────────
    # Unimplemented methods
    # ─────────────────────────────────────────────────────────────

    async def move_items(
        self,
        request: MoveItemsRequest,
        ctx: RequestContext,
    ) -> MoveItemsResponse:
        """Move files/folders to a different parent and/or visibility scope."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        user_id = get_user_id_from_context(ctx)

        # Parse target folder ID
        target_folder_id = None
        if request.HasField("target_folder_id") and request.target_folder_id:
            try:
                target_folder_id = UUID(request.target_folder_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid target folder ID")

        # Parse target visibility
        target_visibility = None
        if request.HasField("target_visibility"):
            target_visibility = visibility_from_proto(request.target_visibility)

        # Parse file and folder IDs
        file_ids = []
        for fid in request.file_ids:
            try:
                file_ids.append(UUID(fid))
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid file ID: {fid}")

        folder_ids = []
        for fid in request.folder_ids:
            try:
                folder_ids.append(UUID(fid))
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid folder ID: {fid}")

        if not file_ids and not folder_ids:
            return MoveItemsResponse(
                success=True,
                message="No items to move",
                files_moved=0,
                folders_moved=0,
            )

        try:
            files_moved = 0
            folders_moved = 0

            async for session in get_async_session():
                file_ops = FileOperations(session)
                folder_ops = FolderOperations(session)

                # Move files
                for file_id in file_ids:
                    file = await file_ops._fetch_by_id(file_id, organization_id)
                    if not file:
                        continue

                    # Check if visibility is actually changing
                    visibility_changing = (
                        target_visibility is not None and target_visibility != file.visibility
                    )

                    # Check ownership only for visibility changes
                    if visibility_changing and file.owner_id != user_id:
                        raise PermissionDeniedError("change_visibility", "file")

                    # Update folder if specified
                    if target_folder_id is not None or request.HasField("target_folder_id"):
                        file.folder_id = target_folder_id

                    # Update visibility if actually changing (this also handles group links)
                    if visibility_changing:
                        await file_ops.update(
                            user_id=user_id,
                            organization_id=organization_id,
                            file_id=file_id,
                            visibility=target_visibility,
                        )
                    else:
                        # Just update folder
                        file.updated_at = datetime.now(UTC)
                        await session.commit()

                    files_moved += 1

                # Move folders
                for folder_id in folder_ids:
                    folder = await folder_ops.get_by_id(folder_id, organization_id)
                    if not folder:
                        continue

                    # Check if visibility is actually changing
                    visibility_changing = (
                        target_visibility is not None and target_visibility != folder.visibility
                    )

                    # Check ownership only for visibility changes
                    if visibility_changing and folder.owner_id != user_id:
                        raise PermissionDeniedError("change_visibility", "folder")

                    # Update parent if specified
                    if target_folder_id is not None or request.HasField("target_folder_id"):
                        folder.parent_id = target_folder_id

                    # Update visibility if actually changing (this also handles group links)
                    if visibility_changing:
                        await folder_ops.update(
                            user_id=user_id,
                            organization_id=organization_id,
                            folder_id=folder_id,
                            visibility=target_visibility,
                        )
                    else:
                        folder.updated_at = datetime.now(UTC)
                        await session.commit()

                    folders_moved += 1

                return MoveItemsResponse(
                    success=True,
                    message=f"Moved {files_moved} files and {folders_moved} folders",
                    files_moved=files_moved,
                    folders_moved=folders_moved,
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e) or "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            if "ValidationError" in type(e).__name__:
                raise ConnectError(Code.INVALID_ARGUMENT, str(e))
            logger.error(f"Error moving items: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def copy_items(
        self,
        request: CopyItemsRequest,
        ctx: RequestContext,
    ) -> CopyItemsResponse:
        """Copy files to a different location."""
        raise ConnectError(Code.UNIMPLEMENTED, "CopyItems not yet implemented")

    async def bulk_delete(
        self,
        request: BulkDeleteRequest,
        ctx: RequestContext,
    ) -> BulkDeleteResponse:
        """Bulk delete multiple files/folders."""
        raise ConnectError(Code.UNIMPLEMENTED, "BulkDelete not yet implemented")

    async def restore_file_version(
        self,
        request: RestoreFileVersionRequest,
        ctx: RequestContext,
    ) -> FileResponse:
        """Restore a previous version of a file."""
        raise ConnectError(Code.UNIMPLEMENTED, "RestoreFileVersion not yet implemented")
