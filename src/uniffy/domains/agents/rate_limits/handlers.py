"""RateLimitsService RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.agents.v1.rate_limits_pb2 import (
    DeleteRateLimitRequest,
    DeleteRateLimitResponse,
    GetRateLimitsRequest,
    GetRateLimitsResponse,
    UpsertRateLimitRequest,
    UpsertRateLimitResponse,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.agents.rate_limits.converters import (
    rate_limit_kind_from_proto,
    rate_limit_row_to_proto,
)
from uniffy.domains.agents.rate_limits.operations import RateLimitsOperations
from uniffy.domains.auth.context import get_user_id_from_context


class RateLimitsHandlers:
    """RPC handlers for the agents RateLimitsService."""

    async def get_rate_limits(
        self,
        request: GetRateLimitsRequest,
        ctx: RequestContext,
    ) -> GetRateLimitsResponse:
        """Return all effective rate-limit buckets for the organization."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        try:
            async with open_session() as session:
                ops = RateLimitsOperations(session)
                rows = await ops.list_effective_limits(
                    user_id=user_id,
                    organization_id=org_id,
                )
                return GetRateLimitsResponse(
                    limits=[rate_limit_row_to_proto(r) for r in rows],
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing rate limits: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def upsert_rate_limit(
        self,
        request: UpsertRateLimitRequest,
        ctx: RequestContext,
    ) -> UpsertRateLimitResponse:
        """Create or update a rate-limit override for the organization."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        kind = rate_limit_kind_from_proto(request.kind)
        if kind is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "kind is required")

        try:
            async with open_session() as session:
                ops = RateLimitsOperations(session)
                row = await ops.upsert(
                    user_id=user_id,
                    organization_id=org_id,
                    kind=kind,
                    limit=request.limit,
                    window_seconds=request.window_seconds,
                )
                return UpsertRateLimitResponse(limit=rate_limit_row_to_proto(row))

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error upserting rate limit: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_rate_limit(
        self,
        request: DeleteRateLimitRequest,
        ctx: RequestContext,
    ) -> DeleteRateLimitResponse:
        """Delete a rate-limit override so the bucket reverts to the default."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        kind = rate_limit_kind_from_proto(request.kind)
        if kind is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "kind is required")

        try:
            async with open_session() as session:
                ops = RateLimitsOperations(session)
                await ops.delete(
                    user_id=user_id,
                    organization_id=org_id,
                    kind=kind,
                )
                return DeleteRateLimitResponse(success=True)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Rate limit override not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting rate limit: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
