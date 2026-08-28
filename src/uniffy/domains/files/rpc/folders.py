"""Files RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.files.v1.files_pb2 import (
    CreateFolderRequest,
    CreateFolderResponse,
    DeleteFolderRequest,
    DeleteFolderResponse,
    GetFilesTreeRequest,
    GetFilesTreeResponse,
    TreeNode,
    UpdateFolderRequest,
    UpdateFolderResponse,
)

from uniffy.core.auth.permissions import resolve_access_policy, resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.types import AccessMode, ContentType
from uniffy.db import open_session
from uniffy.domains.files.converters import (
    folder_to_proto,
    tree_node_from_file,
    tree_node_from_folder,
)
from uniffy.domains.files.operations import FileOperations, FolderOperations
from uniffy.domains.permissions.members import ContentMembersOperations

logger = logger.bind(component="files.rpc.folders")

from uniffy.domains.files.rpc.support import (
    _resolve_folder_effective_policy,
)


class FolderHandlers:
    async def create_folder(
        self,
        request: CreateFolderRequest,
        ctx: RequestContext,
    ) -> CreateFolderResponse:
        """Create a new folder."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = current_user_id()

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
                    session,
                    organization_id,
                    folder,
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
            logger.exception(f"Error creating folder: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_folder(
        self,
        request: UpdateFolderRequest,
        ctx: RequestContext,
    ) -> UpdateFolderResponse:
        """Update a folder."""
        try:
            folder_id = UUID(request.folder_id)
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = current_user_id()

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
                    session,
                    organization_id,
                    folder,
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
            logger.exception(f"Error updating folder: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_folder(
        self,
        request: DeleteFolderRequest,
        ctx: RequestContext,
    ) -> DeleteFolderResponse:
        """Delete a folder."""
        try:
            folder_id = UUID(request.folder_id)
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = current_user_id()

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
            logger.exception(f"Error deleting folder: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_files_tree(
        self,
        request: GetFilesTreeRequest,
        ctx: RequestContext,
    ) -> GetFilesTreeResponse:
        """Get the file/folder tree."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = current_user_id()

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
                    organization_id,
                    ContentType.FILE,
                )
                folder_default_mode, folder_default_baseline = await checker.get_org_defaults(
                    organization_id,
                    ContentType.FOLDER,
                )

                def _file_eff_mode(f: File) -> AccessMode | None:
                    mode, _ = resolve_effective_policy(
                        f.access_mode,
                        f.baseline_role,
                        file_default_mode,
                        file_default_baseline,
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

                async def folder_subtree(folder: Folder, present_as_root: bool) -> TreeNode:
                    child_nodes, children_size = await build_folder_tree(folder.id)
                    child_files, _ = await file_ops.list_files(
                        user_id=user_id,
                        organization_id=organization_id,
                        folder_id=folder.id,
                        personal_only=request.personal_only,
                    )
                    folder_total_size = sum(f.size_bytes for f in child_files) + children_size
                    if request.include_files:
                        for file in child_files:
                            child_nodes.append(
                                tree_node_from_file(
                                    file,
                                    effective_access_mode=_file_eff_mode(file),
                                )
                            )
                    file_count = 0 if request.include_files else len(child_files)
                    node = tree_node_from_folder(
                        folder,
                        len(child_nodes) + file_count,
                        folder_total_size,
                        effective_access_mode=_folder_eff_mode(folder),
                        present_as_root=present_as_root,
                    )
                    node.children.extend(child_nodes)
                    return node

                nodes, _ = await build_folder_tree(root_folder_id)

                # The top-down recursion never reaches a shared folder nested
                # under an inaccessible parent; graft those as extra roots
                # without echoing the hidden parent.
                if root_folder_id is None and not request.personal_only:
                    accessible = await folder_ops.list_accessible_folders(
                        user_id=user_id,
                        organization_id=organization_id,
                    )
                    accessible_ids = {f.id for f in accessible}
                    included: set[UUID] = set()

                    def collect_folder_ids(tree_nodes: list[TreeNode]) -> None:
                        for tree_node in tree_nodes:
                            if tree_node.is_folder:
                                included.add(UUID(tree_node.id))
                                collect_folder_ids(list(tree_node.children))

                    collect_folder_ids(nodes)
                    for folder in accessible:
                        if folder.id in included:
                            continue
                        # An accessible parent grafts (or already carries) it.
                        if folder.parent_id is not None and folder.parent_id in accessible_ids:
                            continue
                        orphan_node = await folder_subtree(folder, present_as_root=True)
                        collect_folder_ids([orphan_node])
                        nodes.append(orphan_node)

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
            logger.exception(f"Error getting files tree: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
