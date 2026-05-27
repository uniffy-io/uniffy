"""Files RPC handlers."""

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from uniffy_proto.files.v1.files_pb2 import (
    AbortUploadRequest,
    AbortUploadResponse,
    BulkDeleteRequest,
    BulkDeleteResponse,
    CompleteUploadRequest,
    CompleteUploadResponse,
    CopyItemsRequest,
    CopyItemsResponse,
    CreatedFolderInfo,
    CreateFolderRequest,
    CreateFolderResponse,
    CreateFolderTreeRequest,
    CreateFolderTreeResponse,
    DeleteFileRequest,
    DeleteFileResponse,
    DeleteFolderRequest,
    DeleteFolderResponse,
    DownloadFileRequest,
    DownloadFileResponse,
    EmptyTrashRequest,
    EmptyTrashResponse,
    EnsureRecordingsFolderRequest,
    EnsureRecordingsFolderResponse,
    GetFileRequest,
    GetFileResponse,
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
    ListTrashRequest,
    ListTrashResponse,
    MoveItemsRequest,
    MoveItemsResponse,
    RestoreFileRequest,
    RestoreFileResponse,
    RestoreFileVersionRequest,
    RestoreFileVersionResponse,
    RestoreFolderRequest,
    RestoreFolderResponse,
    StreamFileRangeRequest,
    StreamFileRangeResponse,
    TreeNode,
    UpdateFileRequest,
    UpdateFileResponse,
    UpdateFolderRequest,
    UpdateFolderResponse,
    UploadChunkRequest,
    UploadChunkResponse,
    UploadChunksRequest,
    UploadChunksResponse,
)

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.permissions import resolve_access_policy, resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.content.members import ContentMembersOperations
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.multipart_upload import UploadStatus
from uniffy.core.models.login.user import User
from uniffy.core.storage import get_s3_client
from uniffy.core.types import AccessMode, ContentType
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.files.converters import (
    file_to_proto,
    file_version_to_proto,
    folder_to_proto,
    tree_node_from_file,
    tree_node_from_folder,
    upload_to_proto_status,
)
from uniffy.domains.files.operations import FileOperations, FolderOperations
from uniffy.domains.tags import TagOperations


def _file_urn(file_id: str | UUID) -> str:
    """Build the URN string for a file id (mirrors File.urn)."""
    return f"urn:uniffy:content:FILE:{file_id}"


def _parse_tag_id_list(values: list[str]) -> list[UUID]:
    """Parse a list of tag id strings, raising ``INVALID_ARGUMENT`` on any miss."""
    parsed: list[UUID] = []
    for value in values:
        try:
            parsed.append(UUID(value))
        except ValueError as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid tag_id: {exc}") from exc
    return parsed


async def _hydrate_file_tags(
    session,
    organization_id: UUID,
    files: list[File],
) -> dict[str, list]:
    """Bulk-fetch unified tags for a batch of files."""
    if not files:
        return {}
    tag_ops = TagOperations(session)
    return await tag_ops.get_for_urns(
        organization_id=organization_id,
        content_urns=[_file_urn(f.id) for f in files],
    )


async def _resolve_file_effective_policy(
    session,
    organization_id: UUID,
    file: File,
    checker: PermissionChecker | None = None,
):
    """Return the file's effective ``(access_mode, baseline_role)`` for proto emission."""
    permission_checker = checker or PermissionChecker(session)
    default_mode, default_baseline = await permission_checker.get_org_defaults(
        organization_id, ContentType.FILE,
    )
    return resolve_effective_policy(
        file.access_mode, file.baseline_role, default_mode, default_baseline,
    )


async def _resolve_folder_effective_policy(
    session,
    organization_id: UUID,
    folder: Folder,
    checker: PermissionChecker | None = None,
):
    """Return the folder's effective ``(access_mode, baseline_role)`` for proto emission."""
    permission_checker = checker or PermissionChecker(session)
    default_mode, default_baseline = await permission_checker.get_org_defaults(
        organization_id, ContentType.FOLDER,
    )
    return resolve_effective_policy(
        folder.access_mode, folder.baseline_role, default_mode, default_baseline,
    )


class FilesHandlers:
    async def initiate_upload(
        self,
        request: InitiateUploadRequest,
        ctx: RequestContext,
    ) -> InitiateUploadResponse:
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = FileOperations(session)

                access_mode = None
                if request.access_mode:
                    access_mode = access_mode_from_proto(request.access_mode)
                baseline_role = None
                if request.baseline_role:
                    baseline_role = content_role_from_proto(request.baseline_role)

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
                    access_mode=access_mode,
                    baseline_role=baseline_role,
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
        """Upload a single chunk; call CompleteUpload when all chunks have been sent."""
        try:
            upload_id = UUID(request.upload_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid upload_id")

        user_id = get_user_id_from_context(ctx)
        s3 = get_s3_client()

        try:
            async with open_session() as session:
                ops = FileOperations(session)

                upload = await ops.get_upload_status(upload_id)
                if not upload:
                    raise ConnectError(Code.NOT_FOUND, "Upload not found")
                if upload.user_id != user_id:
                    raise ConnectError(Code.PERMISSION_DENIED, "Not your upload")
                if upload.status != UploadStatus.ACTIVE:
                    raise ConnectError(
                        Code.FAILED_PRECONDITION,
                        f"Upload is {upload.status.value}; cannot accept chunks.",
                    )

                etag = await s3.upload_part(
                    key=upload.storage_key,
                    upload_id=upload.s3_upload_id,
                    part_number=request.chunk_number,
                    data=request.data,
                )

                await ops.record_chunk_completed(
                    upload_id=upload_id,
                    part_number=request.chunk_number,
                    etag=etag,
                    size=len(request.data),
                )

                completed_part_numbers = await ops.list_completed_part_numbers(upload_id)
                chunks_received = len(completed_part_numbers)

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
    ) -> CompleteUploadResponse:
        """Complete an upload after all chunks have been sent; returns the file."""
        try:
            upload_id = UUID(request.upload_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid upload_id")

        user_id = get_user_id_from_context(ctx)

        tag_ids = _parse_tag_id_list(list(request.tag_ids)) if request.tag_ids else None

        try:
            async with open_session() as session:
                ops = FileOperations(session)

                file = await ops.complete_upload(
                    upload_id=upload_id,
                    user_id=user_id,
                    tag_ids=tag_ids,
                )

                logger.info(f"[Upload] Completed file id={file.id} folder_id={file.folder_id}")

                tags_by_urn = await _hydrate_file_tags(session, file.organization_id, [file])
                eff_mode, eff_baseline = await _resolve_file_effective_policy(
                    session, file.organization_id, file,
                )
                return CompleteUploadResponse(
                    file=file_to_proto(
                        file,
                        tags=tags_by_urn.get(_file_urn(file.id), []),
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )

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
        request_iterator: AsyncIterator[UploadChunksRequest],
        ctx: RequestContext,
    ) -> UploadChunksResponse:
        """Client-streaming chunk upload; returns the completed file."""
        user_id = get_user_id_from_context(ctx)
        s3 = get_s3_client()

        upload_id: UUID | None = None
        storage_key: str | None = None
        s3_upload_id: str | None = None

        try:
            async with open_session() as session:
                ops = FileOperations(session)

                async for chunk in request_iterator:
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

                    etag = await s3.upload_part(
                        key=storage_key,
                        upload_id=s3_upload_id,
                        part_number=chunk.chunk_number,
                        data=chunk.data,
                    )

                    await ops.record_chunk_completed(
                        upload_id=upload_id,
                        part_number=chunk.chunk_number,
                        etag=etag,
                        size=len(chunk.data),
                    )

                    if chunk.is_last:
                        file = await ops.complete_upload(
                            upload_id=upload_id,
                            user_id=user_id,
                        )
                        tags_by_urn = await _hydrate_file_tags(
                            session, file.organization_id, [file]
                        )
                        eff_mode, eff_baseline = await _resolve_file_effective_policy(
                            session, file.organization_id, file,
                        )
                        return UploadChunksResponse(
                            file=file_to_proto(
                                file,
                                tags=tags_by_urn.get(_file_urn(file.id), []),
                                effective_access_mode=eff_mode,
                                effective_baseline_role=eff_baseline,
                            )
                        )

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
        try:
            upload_id = UUID(request.upload_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid upload_id")

        get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = FileOperations(session)
                upload = await ops.get_upload_status(upload_id)

                if not upload:
                    raise ConnectError(Code.NOT_FOUND, "Upload not found")

                completed_chunks = await ops.list_completed_part_numbers(upload_id)

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
            async with open_session() as session:
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

    async def download_file(
        self,
        request: DownloadFileRequest,
        ctx: RequestContext,
    ) -> AsyncIterator[DownloadFileResponse]:
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
            async with open_session() as session:
                ops = FileOperations(session)

                file = await ops.get_by_id(user_id, organization_id, file_id)

                s3 = get_s3_client()
                first_chunk = True

                async for chunk_data, chunk_num, total_chunks in s3.download_stream(
                    key=file.storage_key
                ):
                    response = DownloadFileResponse(
                        data=chunk_data,
                        chunk_number=chunk_num,
                        total_chunks=total_chunks,
                    )

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
        """Stream a file with HTTP-Range-like semantics so media players can seek."""
        try:
            file_id = UUID(request.file_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        start_byte = request.start_byte if request.HasField("start_byte") else None
        end_byte = request.end_byte if request.HasField("end_byte") else None

        try:
            async with open_session() as session:
                ops = FileOperations(session)

                file = await ops.get_by_id(user_id, organization_id, file_id)

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

    async def get_file(
        self,
        request: GetFileRequest,
        ctx: RequestContext,
    ) -> GetFileResponse:
        try:
            file_id = UUID(request.file_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = FileOperations(session)
                file = await ops.get_by_id(user_id, organization_id, file_id)
                tags_by_urn = await _hydrate_file_tags(session, organization_id, [file])
                eff_mode, eff_baseline = await _resolve_file_effective_policy(
                    session, organization_id, file,
                )
                return GetFileResponse(
                    file=file_to_proto(
                        file,
                        tags=tags_by_urn.get(_file_urn(file.id), []),
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )

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
    ) -> UpdateFileResponse:
        """Update file metadata; access_mode/baseline_role go through
        MembersService.set_access_mode.
        """
        try:
            file_id = UUID(request.file_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = FileOperations(session)

                if request.access_mode:
                    new_access_mode = access_mode_from_proto(request.access_mode)
                    if new_access_mode is None:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid access_mode")
                    new_baseline_role = None
                    if request.baseline_role:
                        new_baseline_role = content_role_from_proto(request.baseline_role)
                    new_access_mode, new_baseline_role = await resolve_access_policy(
                        session,
                        organization_id,
                        ContentType.FILE,
                        new_access_mode,
                        new_baseline_role,
                    )
                    members_ops = ContentMembersOperations(session)
                    await members_ops.set_access_mode(
                        actor_user_id=user_id,
                        organization_id=organization_id,
                        content_type=ContentType.FILE,
                        content_id=file_id,
                        new_access_mode=new_access_mode,
                        new_baseline_role=new_baseline_role,
                    )

                tag_ids: list[UUID] | None = None
                if request.HasField("tag_ids"):
                    tag_ids = _parse_tag_id_list(list(request.tag_ids.ids))

                file = await ops.update(
                    user_id=user_id,
                    organization_id=organization_id,
                    file_id=file_id,
                    filename=request.filename if request.HasField("filename") else None,
                    tag_ids=tag_ids,
                    description=request.description if request.HasField("description") else None,
                )

                tags_by_urn = await _hydrate_file_tags(session, organization_id, [file])
                eff_mode, eff_baseline = await _resolve_file_effective_policy(
                    session, organization_id, file,
                )
                return UpdateFileResponse(
                    file=file_to_proto(
                        file,
                        tags=tags_by_urn.get(_file_urn(file.id), []),
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "File not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e) or "Access denied")
        except ConnectError:
            raise
        except Exception as e:
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
            async with open_session() as session:
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
    ) -> RestoreFileResponse:
        """Restore a soft-deleted file."""
        try:
            file_id = UUID(request.file_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = FileOperations(session)
                file = await ops.restore(
                    user_id=user_id,
                    organization_id=organization_id,
                    file_id=file_id,
                )
                tags_by_urn = await _hydrate_file_tags(session, organization_id, [file])
                eff_mode, eff_baseline = await _resolve_file_effective_policy(
                    session, organization_id, file,
                )
                return RestoreFileResponse(
                    file=file_to_proto(
                        file,
                        tags=tags_by_urn.get(_file_urn(file.id), []),
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )

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

        access_mode_filter = None
        if request.access_mode:
            access_mode_filter = access_mode_from_proto(request.access_mode)

        tag_ids = _parse_tag_id_list(list(request.tag_ids)) if request.tag_ids else None

        try:
            async with open_session() as session:
                ops = FileOperations(session)
                files, total = await ops.list_files(
                    user_id=user_id,
                    organization_id=organization_id,
                    folder_id=folder_id,
                    access_mode=access_mode_filter,
                    group_id=group_id,
                    personal_only=request.personal_only,
                    shared_only=request.shared_only,
                    include_deleted=request.include_deleted,
                    tag_ids=tag_ids,
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

                tags_by_urn = await _hydrate_file_tags(session, organization_id, files)
                page_size = request.page_size or 50
                total_pages = (total + page_size - 1) // page_size

                checker = PermissionChecker(session)
                default_mode, default_baseline = await checker.get_org_defaults(
                    organization_id, ContentType.FILE,
                )
                proto_files = []
                for f in files:
                    eff_mode, eff_baseline = resolve_effective_policy(
                        f.access_mode, f.baseline_role, default_mode, default_baseline,
                    )
                    proto_files.append(
                        file_to_proto(
                            f,
                            owner_info=owner_info_map.get(f.owner_id),
                            tags=tags_by_urn.get(_file_urn(f.id), []),
                            effective_access_mode=eff_mode,
                            effective_baseline_role=eff_baseline,
                        )
                    )

                return ListFilesResponse(
                    files=proto_files,
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

    async def create_folder(
        self,
        request: CreateFolderRequest,
        ctx: RequestContext,
    ) -> CreateFolderResponse:
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

        access_mode = None
        if request.access_mode:
            access_mode = access_mode_from_proto(request.access_mode)
        baseline_role = None
        if request.baseline_role:
            baseline_role = content_role_from_proto(request.baseline_role)

        try:
            async with open_session() as session:
                ops = FolderOperations(session)
                folder = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    name=request.name,
                    parent_id=parent_id,
                    access_mode=access_mode,
                    baseline_role=baseline_role,
                )
                eff_mode, eff_baseline = await _resolve_folder_effective_policy(
                    session, organization_id, folder,
                )
                return CreateFolderResponse(
                    folder=folder_to_proto(
                        folder,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating folder: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def update_folder(
        self,
        request: UpdateFolderRequest,
        ctx: RequestContext,
    ) -> UpdateFolderResponse:
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

        try:
            async with open_session() as session:
                ops = FolderOperations(session)

                if request.access_mode:
                    new_access_mode = access_mode_from_proto(request.access_mode)
                    if new_access_mode is None:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid access_mode")
                    new_baseline_role = None
                    if request.baseline_role:
                        new_baseline_role = content_role_from_proto(request.baseline_role)
                    new_access_mode, new_baseline_role = await resolve_access_policy(
                        session,
                        organization_id,
                        ContentType.FOLDER,
                        new_access_mode,
                        new_baseline_role,
                    )
                    members_ops = ContentMembersOperations(session)
                    await members_ops.set_access_mode(
                        actor_user_id=user_id,
                        organization_id=organization_id,
                        content_type=ContentType.FOLDER,
                        content_id=folder_id,
                        new_access_mode=new_access_mode,
                        new_baseline_role=new_baseline_role,
                    )

                folder = await ops.update(
                    user_id=user_id,
                    organization_id=organization_id,
                    folder_id=folder_id,
                    name=request.name if request.HasField("name") else None,
                    parent_id=parent_id,
                )
                eff_mode, eff_baseline = await _resolve_folder_effective_policy(
                    session, organization_id, folder,
                )
                return UpdateFolderResponse(
                    folder=folder_to_proto(
                        folder,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Folder not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e) or "Access denied")
        except ConnectError:
            raise
        except Exception as e:
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
            async with open_session() as session:
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
            async with open_session() as session:
                folder_ops = FolderOperations(session)
                file_ops = FileOperations(session)

                checker = PermissionChecker(session)
                file_default_mode, file_default_baseline = await checker.get_org_defaults(
                    organization_id, ContentType.FILE,
                )
                folder_default_mode, folder_default_baseline = await checker.get_org_defaults(
                    organization_id, ContentType.FOLDER,
                )

                def _file_eff_mode(f: File) -> AccessMode | None:
                    mode, _ = resolve_effective_policy(
                        f.access_mode, f.baseline_role, file_default_mode, file_default_baseline,
                    )
                    return mode

                def _folder_eff_mode(fld: Folder) -> AccessMode | None:
                    mode, _ = resolve_effective_policy(
                        fld.access_mode,
                        fld.baseline_role,
                        folder_default_mode,
                        folder_default_baseline,
                    )
                    return mode

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
                        child_nodes, children_size = await build_folder_tree(folder.id)

                        child_files, _ = await _file_ops.list_files(
                            user_id=user_id,
                            organization_id=organization_id,
                            folder_id=folder.id,
                            personal_only=request.personal_only,
                        )

                        folder_files_size = sum(f.size_bytes for f in child_files)
                        folder_total_size = folder_files_size + children_size

                        if request.include_files:
                            for file in child_files:
                                child_nodes.append(
                                    tree_node_from_file(
                                        file,
                                        effective_access_mode=_file_eff_mode(file),
                                    )
                                )

                        file_count = 0 if request.include_files else len(child_files)
                        child_count = len(child_nodes) + file_count
                        node = tree_node_from_folder(
                            folder,
                            child_count,
                            folder_total_size,
                            effective_access_mode=_folder_eff_mode(folder),
                        )
                        node.children.extend(child_nodes)
                        nodes.append(node)

                        parent_total_size += folder_total_size

                    return nodes, parent_total_size

                nodes, _ = await build_folder_tree(root_folder_id)

                if request.include_files:
                    files, _ = await file_ops.list_files(
                        user_id=user_id,
                        organization_id=organization_id,
                        folder_id=root_folder_id,
                        personal_only=request.personal_only,
                    )
                    for file in files:
                        nodes.append(
                            tree_node_from_file(
                                file,
                                effective_access_mode=_file_eff_mode(file),
                            )
                        )

                return GetFilesTreeResponse(nodes=nodes)

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting files tree: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

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
            async with open_session() as session:
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

    async def list_trash(
        self,
        request: ListTrashRequest,
        ctx: RequestContext,
    ) -> ListTrashResponse:
        """List the authenticated user's soft-deleted files and folders."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = FileOperations(session)
                files, folders = await ops.list_trashed_items(
                    user_id=user_id,
                    organization_id=organization_id,
                )
                tags_by_urn = await _hydrate_file_tags(session, organization_id, files)
                checker = PermissionChecker(session)
                file_default_mode, file_default_baseline = await checker.get_org_defaults(
                    organization_id, ContentType.FILE,
                )
                folder_default_mode, folder_default_baseline = await checker.get_org_defaults(
                    organization_id, ContentType.FOLDER,
                )
                proto_files = []
                for f in files:
                    eff_mode, eff_baseline = resolve_effective_policy(
                        f.access_mode, f.baseline_role, file_default_mode, file_default_baseline,
                    )
                    proto_files.append(
                        file_to_proto(
                            f,
                            tags=tags_by_urn.get(_file_urn(f.id), []),
                            effective_access_mode=eff_mode,
                            effective_baseline_role=eff_baseline,
                        )
                    )
                proto_folders = []
                for fld in folders:
                    eff_mode, eff_baseline = resolve_effective_policy(
                        fld.access_mode,
                        fld.baseline_role,
                        folder_default_mode,
                        folder_default_baseline,
                    )
                    proto_folders.append(
                        folder_to_proto(
                            fld,
                            effective_access_mode=eff_mode,
                            effective_baseline_role=eff_baseline,
                        )
                    )
                return ListTrashResponse(files=proto_files, folders=proto_folders)

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing trash: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def restore_folder(
        self,
        request: RestoreFolderRequest,
        ctx: RequestContext,
    ) -> RestoreFolderResponse:
        """Restore a soft-deleted folder (and its soft-deleted contents)."""
        try:
            folder_id = UUID(request.folder_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = FolderOperations(session)
                folder = await ops.restore_folder(
                    user_id=user_id,
                    organization_id=organization_id,
                    folder_id=folder_id,
                )
                eff_mode, eff_baseline = await _resolve_folder_effective_policy(
                    session, organization_id, folder,
                )
                return RestoreFolderResponse(
                    folder=folder_to_proto(
                        folder,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Folder not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error restoring folder: {e}", exc_info=True)
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
            async with open_session() as session:
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

    async def create_folder_tree(
        self,
        request: CreateFolderTreeRequest,
        ctx: RequestContext,
    ) -> CreateFolderTreeResponse:
        """Create a folder tree in a single transaction for recursive upload."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        parent_folder_id = None
        if request.HasField("parent_folder_id"):
            try:
                parent_folder_id = UUID(request.parent_folder_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid parent_folder_id")

        access_mode = None
        if request.access_mode:
            access_mode = access_mode_from_proto(request.access_mode)
        baseline_role = None
        if request.baseline_role:
            baseline_role = content_role_from_proto(request.baseline_role)

        def proto_tree_to_dict(nodes: list) -> list[dict]:
            result = []
            for node in nodes:
                result.append({
                    "name": node.name,
                    "children": proto_tree_to_dict(list(node.children)),
                })
            return result

        tree = proto_tree_to_dict(list(request.tree))

        try:
            async with open_session() as session:
                ops = FolderOperations(session)
                created = await ops.create_folder_tree(
                    user_id=user_id,
                    organization_id=organization_id,
                    tree=tree,
                    parent_id=parent_folder_id,
                    access_mode=access_mode,
                    baseline_role=baseline_role,
                )

                proto_folders = []
                for item in created:
                    info = CreatedFolderInfo(
                        id=str(item["id"]),
                        name=item["name"],
                        path=item["path"],
                    )
                    if item.get("parent_id"):
                        info.parent_id = str(item["parent_id"])
                    proto_folders.append(info)

                return CreateFolderTreeResponse(folders=proto_folders)

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating folder tree: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def ensure_recordings_folder(
        self,
        request: EnsureRecordingsFolderRequest,
        ctx: RequestContext,
    ) -> EnsureRecordingsFolderResponse:
        """Lazily create or fetch the per-user "Recordings" system folder."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = FolderOperations(session)
                folder = await ops.ensure_named_folder(
                    user_id=user_id,
                    organization_id=organization_id,
                    name="Recordings",
                )
                eff_mode, eff_baseline = await _resolve_folder_effective_policy(
                    session, organization_id, folder,
                )
                return EnsureRecordingsFolderResponse(
                    folder=folder_to_proto(
                        folder,
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error ensuring recordings folder: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def move_items(
        self,
        request: MoveItemsRequest,
        ctx: RequestContext,
    ) -> MoveItemsResponse:
        """Move files / folders to a new parent and/or change their access mode."""
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        user_id = get_user_id_from_context(ctx)

        target_folder_id = None
        if request.HasField("target_folder_id") and request.target_folder_id:
            try:
                target_folder_id = UUID(request.target_folder_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid target folder ID")

        target_access_mode = None
        if request.target_access_mode:
            target_access_mode = access_mode_from_proto(request.target_access_mode)
        target_baseline_role = None
        if request.target_baseline_role:
            target_baseline_role = content_role_from_proto(request.target_baseline_role)

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

            async with open_session() as session:
                file_ops = FileOperations(session)
                folder_ops = FolderOperations(session)
                members_ops = ContentMembersOperations(session)

                for file_id in file_ids:
                    file = await file_ops._fetch_by_id(file_id, organization_id)
                    if not file:
                        continue

                    if target_access_mode is not None:
                        resolved_mode, resolved_baseline = await resolve_access_policy(
                            session,
                            organization_id,
                            ContentType.FILE,
                            target_access_mode,
                            target_baseline_role,
                        )
                        if (
                            resolved_mode != file.access_mode
                            or resolved_baseline != file.baseline_role
                        ):
                            await members_ops.set_access_mode(
                                actor_user_id=user_id,
                                organization_id=organization_id,
                                content_type=ContentType.FILE,
                                content_id=file_id,
                                new_access_mode=resolved_mode,
                                new_baseline_role=resolved_baseline,
                            )

                    if target_folder_id is not None or request.HasField("target_folder_id"):
                        file = await file_ops._fetch_by_id(file_id, organization_id)
                        if file is not None and file.folder_id != target_folder_id:
                            previous_folder_id = file.folder_id
                            file.folder_id = target_folder_id
                            file.updated_at = datetime.now(UTC)
                            await write_audit_event(
                                session,
                                organization_id=organization_id,
                                actor_user_id=user_id,
                                action=Action.FILE_MOVED,
                                resource_type=ContentType.FILE.value,
                                resource_id=file_id,
                                details={
                                    "previous_folder_id": (
                                        str(previous_folder_id)
                                        if previous_folder_id
                                        else None
                                    ),
                                    "new_folder_id": (
                                        str(target_folder_id)
                                        if target_folder_id
                                        else None
                                    ),
                                },
                            )

                    await session.commit()
                    files_moved += 1

                for folder_id in folder_ids:
                    folder = await folder_ops.get_by_id(folder_id, organization_id)
                    if not folder:
                        continue

                    if target_access_mode is not None:
                        resolved_mode, resolved_baseline = await resolve_access_policy(
                            session,
                            organization_id,
                            ContentType.FOLDER,
                            target_access_mode,
                            target_baseline_role,
                        )
                        if (
                            resolved_mode != folder.access_mode
                            or resolved_baseline != folder.baseline_role
                        ):
                            await members_ops.set_access_mode(
                                actor_user_id=user_id,
                                organization_id=organization_id,
                                content_type=ContentType.FOLDER,
                                content_id=folder_id,
                                new_access_mode=resolved_mode,
                                new_baseline_role=resolved_baseline,
                            )

                    if target_folder_id is not None or request.HasField("target_folder_id"):
                        folder = await folder_ops.get_by_id(folder_id, organization_id)
                        if folder is not None:
                            folder.parent_id = target_folder_id
                            folder.updated_at = datetime.now(UTC)

                    await session.commit()
                    folders_moved += 1

                return MoveItemsResponse(
                    success=True,
                    message=f"Moved {files_moved} files and {folders_moved} folders",
                    files_moved=files_moved,
                    folders_moved=folders_moved,
                )

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e) or "Access denied")
        except ConnectError:
            raise
        except Exception as e:
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
    ) -> RestoreFileVersionResponse:
        """Restore a previous version of a file."""
        raise ConnectError(Code.UNIMPLEMENTED, "RestoreFileVersion not yet implemented")
