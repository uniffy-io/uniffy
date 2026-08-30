"""Files RPC handlers."""

from collections.abc import AsyncIterator
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from uniffy_proto.files.v1.files_pb2 import (
    DeleteFileRequest,
    DeleteFileResponse,
    DownloadFileRequest,
    DownloadFileResponse,
    GetFileRequest,
    GetFileResponse,
    ListFilesRequest,
    ListFilesResponse,
    RestoreFileRequest,
    RestoreFileResponse,
    UpdateFileRequest,
    UpdateFileResponse,
)

from uniffy.core.auth.permissions import resolve_access_policy, resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.login.user import User
from uniffy.core.types import ContentType, ParentSelection, SortOrder
from uniffy.domains.files.converters import (
    file_to_proto,
)
from uniffy.domains.files.operations import FileOperations
from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="files.rpc.items")

from uniffy.domains.files.rpc.support import (
    _file_urn,
    _hydrate_file_tags,
    _parse_tag_id_list,
    _resolve_file_effective_policy,
)


class FileItemHandlers:
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
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = FileOperations(session, self.storage, self.search_indexer)

                file = await ops.get_by_id(user_id, organization_id, file_id)

                storage = self.storage
                first_chunk = True

                async for chunk_data, chunk_num, total_chunks in storage.download_stream(
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
            logger.exception(f"Error downloading file: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_file(
        self,
        request: GetFileRequest,
        ctx: RequestContext,
    ) -> GetFileResponse:
        try:
            file_id = UUID(request.file_id)
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = FileOperations(session, self.storage, self.search_indexer)
                file = await ops.get_by_id(user_id, organization_id, file_id)
                user_role = await ops._resolve_role(user_id, organization_id, file)
                tags_by_urn = await _hydrate_file_tags(session, organization_id, [file])
                eff_mode, eff_baseline = await _resolve_file_effective_policy(
                    session,
                    organization_id,
                    file,
                )
                return GetFileResponse(
                    file=file_to_proto(
                        file,
                        user_role=user_role,
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
            logger.exception(f"Error getting file: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

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
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = FileOperations(session, self.storage, self.search_indexer)

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
                    members_ops = ContentMembersOperations(session, self.search_indexer)
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
                    session,
                    organization_id,
                    file,
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
            logger.exception(f"Error updating file: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_file(
        self,
        request: DeleteFileRequest,
        ctx: RequestContext,
    ) -> DeleteFileResponse:
        """Delete a file."""
        try:
            file_id = UUID(request.file_id)
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = FileOperations(session, self.storage, self.search_indexer)
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
            logger.exception(f"Error deleting file: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def restore_file(
        self,
        request: RestoreFileRequest,
        ctx: RequestContext,
    ) -> RestoreFileResponse:
        """Restore a soft-deleted file."""
        try:
            file_id = UUID(request.file_id)
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = FileOperations(session, self.storage, self.search_indexer)
                file = await ops.restore(
                    user_id=user_id,
                    organization_id=organization_id,
                    file_id=file_id,
                )
                tags_by_urn = await _hydrate_file_tags(session, organization_id, [file])
                eff_mode, eff_baseline = await _resolve_file_effective_policy(
                    session,
                    organization_id,
                    file,
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
            logger.exception(f"Error restoring file: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_files(
        self,
        request: ListFilesRequest,
        ctx: RequestContext,
    ) -> ListFilesResponse:
        """List files with filters and pagination."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = current_user_id()

        folder_id = None
        if request.HasField("folder_id"):
            if request.folder_id == ParentSelection.ALL:
                folder_id = ParentSelection.ALL
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
                ops = FileOperations(session, self.storage, self.search_indexer)
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
                    sort_order=SortOrder(request.sort_order or SortOrder.DESCENDING),
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
                    organization_id,
                    ContentType.FILE,
                )
                proto_files = []
                for f in files:
                    eff_mode, eff_baseline = resolve_effective_policy(
                        f.access_mode,
                        f.baseline_role,
                        default_mode,
                        default_baseline,
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
            logger.exception(f"Error listing files: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
