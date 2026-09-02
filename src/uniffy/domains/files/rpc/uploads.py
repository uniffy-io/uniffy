"""Files RPC handlers."""

from collections.abc import AsyncIterator
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.files.v1.files_pb2 import (
    AbortUploadRequest,
    AbortUploadResponse,
    CompleteUploadRequest,
    CompleteUploadResponse,
    GetUploadStatusRequest,
    GetUploadStatusResponse,
    InitiateUploadRequest,
    InitiateUploadResponse,
    UploadChunkRequest,
    UploadChunkResponse,
    UploadChunksRequest,
    UploadChunksResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.files.multipart_upload import UploadStatus
from uniffy.domains.files.converters import (
    file_to_proto,
    upload_to_proto_status,
)
from uniffy.domains.files.operations import FileOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="files.rpc.uploads")

from uniffy.domains.files.rpc.support import (
    _file_urn,
    _hydrate_file_tags,
    _parse_tag_id_list,
    _resolve_file_effective_policy,
)


class UploadHandlers:
    async def initiate_upload(
        self,
        request: InitiateUploadRequest,
        ctx: RequestContext,
    ) -> InitiateUploadResponse:
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = FileOperations(session, self.storage, self.search_indexer)

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
            logger.exception(f"Error initiating upload: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

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

        user_id = current_user_id()
        storage = self.storage

        try:
            async with open_session() as session:
                ops = FileOperations(session, storage, self.search_indexer)

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

                etag = await storage.upload_part(
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
            logger.exception(f"Error uploading chunk: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

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

        user_id = current_user_id()

        tag_ids = _parse_tag_id_list(list(request.tag_ids)) if request.tag_ids else None

        version_of_file_id: UUID | None = None
        if request.version_of_file_id:
            try:
                version_of_file_id = UUID(request.version_of_file_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid version_of_file_id")

        try:
            async with open_session() as session:
                ops = FileOperations(session, self.storage, self.search_indexer)

                file = await ops.complete_upload(
                    upload_id=upload_id,
                    user_id=user_id,
                    tag_ids=tag_ids,
                    version_of_file_id=version_of_file_id,
                )

                tags_by_urn = await _hydrate_file_tags(session, file.organization_id, [file])
                eff_mode, eff_baseline = await _resolve_file_effective_policy(
                    session,
                    file.organization_id,
                    file,
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
            logger.exception(f"Error completing upload: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def upload_chunks(
        self,
        request_iterator: AsyncIterator[UploadChunksRequest],
        ctx: RequestContext,
    ) -> UploadChunksResponse:
        """Client-streaming chunk upload; returns the completed file."""
        user_id = current_user_id()
        storage = self.storage

        upload_id: UUID | None = None
        storage_key: str | None = None
        s3_upload_id: str | None = None

        try:
            async with open_session() as session:
                ops = FileOperations(session, storage, self.search_indexer)

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

                    etag = await storage.upload_part(
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
                        tags_by_urn = await _hydrate_file_tags(session, file.organization_id, [file])
                        eff_mode, eff_baseline = await _resolve_file_effective_policy(
                            session,
                            file.organization_id,
                            file,
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
            logger.exception(f"Error in upload_chunks: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_upload_status(
        self,
        request: GetUploadStatusRequest,
        ctx: RequestContext,
    ) -> GetUploadStatusResponse:
        try:
            upload_id = UUID(request.upload_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid upload_id")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = FileOperations(session, self.storage, self.search_indexer)
                upload = await ops.get_upload_status(upload_id)

                # Same not-found shape for a foreign upload as for a missing one,
                # so the id space is not probeable.
                if not upload or upload.user_id != user_id:
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
            logger.exception(f"Error getting upload status: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

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

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = FileOperations(session, self.storage, self.search_indexer)
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
            logger.exception(f"Error aborting upload: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
