"""Files RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.files.v1.files_pb2 import (
    CreatedFolderInfo,
    CreateFolderTreeRequest,
    CreateFolderTreeResponse,
    EnsureRecordingsFolderRequest,
    EnsureRecordingsFolderResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.errors import ValidationError
from uniffy.domains.files.converters import (
    folder_to_proto,
)
from uniffy.domains.files.operations import FolderOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="files.rpc.tree")

from uniffy.domains.files.rpc.support import (
    _resolve_folder_effective_policy,
)


class TreeHandlers:
    async def create_folder_tree(
        self,
        request: CreateFolderTreeRequest,
        ctx: RequestContext,
    ) -> CreateFolderTreeResponse:
        """Create a folder tree in a single transaction for recursive upload."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = current_user_id()

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
                ops = FolderOperations(session, self.storage, self.search_indexer)
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
            logger.exception(f"Error creating folder tree: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def ensure_recordings_folder(
        self,
        request: EnsureRecordingsFolderRequest,
        ctx: RequestContext,
    ) -> EnsureRecordingsFolderResponse:
        """Lazily create or fetch the per-user "Recordings" system folder."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = FolderOperations(session, self.storage, self.search_indexer)
                folder = await ops.ensure_named_folder(
                    user_id=user_id,
                    organization_id=organization_id,
                    name="Recordings",
                )
                eff_mode, eff_baseline = await _resolve_folder_effective_policy(
                    session,
                    organization_id,
                    folder,
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
            logger.exception(f"Error ensuring recordings folder: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
