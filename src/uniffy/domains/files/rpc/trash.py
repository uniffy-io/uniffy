"""Files RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.files.v1.files_pb2 import (
    EmptyTrashRequest,
    EmptyTrashResponse,
    ListTrashRequest,
    ListTrashResponse,
    RestoreFolderRequest,
    RestoreFolderResponse,
)

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.types import ContentType
from uniffy.db import open_session
from uniffy.domains.files.converters import (
    file_to_proto,
    folder_to_proto,
)
from uniffy.domains.files.operations import FileOperations, FolderOperations

logger = logger.bind(component="files.rpc.trash")

from uniffy.domains.files.rpc.support import (
    _file_urn,
    _hydrate_file_tags,
    _resolve_folder_effective_policy,
)


class TrashHandlers:
    async def empty_trash(
        self,
        request: EmptyTrashRequest,
        ctx: RequestContext,
    ) -> EmptyTrashResponse:
        """Empty trash for the current user."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = current_user_id()

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
            logger.exception(f"Error emptying trash: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_trash(
        self,
        request: ListTrashRequest,
        ctx: RequestContext,
    ) -> ListTrashResponse:
        """List the authenticated user's soft-deleted files and folders."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = current_user_id()

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
                    organization_id,
                    ContentType.FILE,
                )
                folder_default_mode, folder_default_baseline = await checker.get_org_defaults(
                    organization_id,
                    ContentType.FOLDER,
                )
                proto_files = []
                for f in files:
                    eff_mode, eff_baseline = resolve_effective_policy(
                        f.access_mode,
                        f.baseline_role,
                        file_default_mode,
                        file_default_baseline,
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
            logger.exception(f"Error listing trash: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def restore_folder(
        self,
        request: RestoreFolderRequest,
        ctx: RequestContext,
    ) -> RestoreFolderResponse:
        """Restore a soft-deleted folder (and its soft-deleted contents)."""
        try:
            folder_id = UUID(request.folder_id)
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = FolderOperations(session)
                folder = await ops.restore_folder(
                    user_id=user_id,
                    organization_id=organization_id,
                    folder_id=folder_id,
                )
                eff_mode, eff_baseline = await _resolve_folder_effective_policy(
                    session,
                    organization_id,
                    folder,
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
            logger.exception(f"Error restoring folder: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
