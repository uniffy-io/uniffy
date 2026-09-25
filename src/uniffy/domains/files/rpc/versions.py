"""Files RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.files.v1.files_pb import (
    ListFileVersionsRequest,
    ListFileVersionsResponse,
    RestoreFileVersionRequest,
    RestoreFileVersionResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.domains.files.converters import (
    file_to_proto,
    file_version_to_proto,
)
from uniffy.domains.files.operations import FileOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="files.rpc.versions")

from uniffy.domains.files.rpc.support import (
    _file_urn,
    _hydrate_file_tags,
    _resolve_file_effective_policy,
)


class VersionHandlers:
    async def list_file_versions(
        self,
        request: ListFileVersionsRequest,
        ctx: RequestContext,
    ) -> ListFileVersionsResponse:
        """List version history for a file."""
        try:
            file_id = UUID(request.file_id)
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = FileOperations(session, self.storage, self.search_indexer)

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
            logger.exception(f"Error listing file versions: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def restore_file_version(
        self,
        request: RestoreFileVersionRequest,
        ctx: RequestContext,
    ) -> RestoreFileVersionResponse:
        """Restore a previous version of a file as a new current version."""
        try:
            file_id = UUID(request.file_id)
            organization_id = resolve_organization_id(request.organization_id)
            version_id = UUID(request.version_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = FileOperations(session, self.storage, self.search_indexer)
                file = await ops.restore_file_version(user_id, organization_id, file_id, version_id)
                user_role = await ops._resolve_role(user_id, organization_id, file)
                tags_by_urn = await _hydrate_file_tags(session, organization_id, [file])
                eff_mode, eff_baseline = await _resolve_file_effective_policy(
                    session,
                    organization_id,
                    file,
                )
                return RestoreFileVersionResponse(
                    file=file_to_proto(
                        file,
                        user_role=user_role,
                        tags=tags_by_urn.get(_file_urn(file.id), []),
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "File version not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error restoring file version: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
