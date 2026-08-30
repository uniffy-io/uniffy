"""Files RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.files.v1.files_pb2 import (
    BulkDeleteRequest,
    BulkDeleteResponse,
    CopyItemsRequest,
    CopyItemsResponse,
    MoveItemsRequest,
    MoveItemsResponse,
)

from uniffy.core.auth.permissions import resolve_access_policy
from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.types import ContentType
from uniffy.domains.files.operations import FileOperations, FolderOperations
from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="files.rpc.bulk")


class BulkHandlers:
    async def move_items(
        self,
        request: MoveItemsRequest,
        ctx: RequestContext,
    ) -> MoveItemsResponse:
        """Move files / folders to a new parent and/or change their access mode."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        user_id = current_user_id()

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
                file_ops = FileOperations(session, self.storage, self.search_indexer)
                folder_ops = FolderOperations(session, self.storage, self.search_indexer)
                members_ops = ContentMembersOperations(session, self.search_indexer)

                # Per-item stat refreshes are skipped and each affected folder
                # is refreshed once after the loops: a 200-file move must not
                # recompute the same two folders 400 times.
                affected_folder_ids: set[UUID | None] = set()

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
                        previous_folder_id = file.folder_id
                        try:
                            await file_ops.move_file(
                                user_id=user_id,
                                organization_id=organization_id,
                                file_id=file_id,
                                folder_id=target_folder_id,
                                refresh_stats=False,
                            )
                        except PermissionDeniedError:
                            # One unmovable item does not sink the batch.
                            continue
                        affected_folder_ids.add(previous_folder_id)
                        affected_folder_ids.add(target_folder_id)

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
                        previous_parent_id = folder.parent_id
                        try:
                            await folder_ops.update(
                                user_id=user_id,
                                organization_id=organization_id,
                                folder_id=folder_id,
                                parent_id=target_folder_id if target_folder_id else "",
                                refresh_parent_stats=False,
                            )
                        except PermissionDeniedError:
                            continue
                        affected_folder_ids.add(previous_parent_id)
                        affected_folder_ids.add(target_folder_id)

                    await session.commit()
                    folders_moved += 1

                for affected_id in affected_folder_ids:
                    await folder_ops.refresh_folder_stats(affected_id, organization_id)

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
            logger.exception(f"Error moving items: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

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
