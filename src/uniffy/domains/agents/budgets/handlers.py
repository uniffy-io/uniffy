"""BudgetsService RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.agents.v1.budgets_pb2 import (
    DeleteOrgBudgetRequest,
    DeleteOrgBudgetResponse,
    DeleteUserQuotaRequest,
    DeleteUserQuotaResponse,
    GetCurrentSpendRequest,
    GetCurrentSpendResponse,
    GetOrgBudgetRequest,
    GetOrgBudgetResponse,
    GetUserQuotaRequest,
    GetUserQuotaResponse,
    ListUserQuotasRequest,
    ListUserQuotasResponse,
    OrgBudgetResponse,
    UpdateOrgBudgetRequest,
    UpdateUserQuotaRequest,
    UserQuotaResponse,
)
from uniffy_proto.common.v1.common_pb2 import PaginationResponse

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.agents.budgets.converters import (
    org_budget_to_proto,
    spend_summary_to_proto,
    user_quota_to_proto,
)
from uniffy.domains.agents.budgets.operations import BudgetsOperations
from uniffy.domains.auth.context import get_user_id_from_context


class BudgetsHandlers:
    """Handlers for ``agents.v1.BudgetsService``."""

    async def get_org_budget(
        self,
        request: GetOrgBudgetRequest,
        ctx: RequestContext,
    ) -> GetOrgBudgetResponse:
        """Return the org budget row (or unset when absent)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        try:
            async with open_session() as session:
                ops = BudgetsOperations(session)
                row = await ops.get_org_budget(
                    user_id=user_id, organization_id=org_id
                )
                resp = GetOrgBudgetResponse()
                if row is not None:
                    resp.budget.CopyFrom(org_budget_to_proto(row))
                return resp

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting org budget: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_org_budget(
        self,
        request: UpdateOrgBudgetRequest,
        ctx: RequestContext,
    ) -> OrgBudgetResponse:
        """Create or update the org budget row (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        monthly = (
            request.monthly_limit_usd
            if request.HasField("monthly_limit_usd")
            else None
        )
        image_monthly = (
            request.image_monthly_limit
            if request.HasField("image_monthly_limit")
            else None
        )

        try:
            async with open_session() as session:
                ops = BudgetsOperations(session)
                row = await ops.upsert_org_budget(
                    user_id=user_id,
                    organization_id=org_id,
                    monthly_limit_usd=monthly,
                    image_monthly_limit=image_monthly,
                    hard_limit=bool(request.hard_limit),
                    alert_thresholds=list(request.alert_thresholds),
                    reset_day=int(request.reset_day) or 1,
                )
                return OrgBudgetResponse(budget=org_budget_to_proto(row))

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating org budget: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_org_budget(
        self,
        request: DeleteOrgBudgetRequest,
        ctx: RequestContext,
    ) -> DeleteOrgBudgetResponse:
        """Delete the org budget row."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        try:
            async with open_session() as session:
                ops = BudgetsOperations(session)
                await ops.delete_org_budget(
                    user_id=user_id, organization_id=org_id
                )
                return DeleteOrgBudgetResponse(success=True)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Org budget not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting org budget: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_user_quota(
        self,
        request: GetUserQuotaRequest,
        ctx: RequestContext,
    ) -> GetUserQuotaResponse:
        """Return a user's quota row."""
        actor_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = BudgetsOperations(session)
                row = await ops.get_user_quota(
                    actor_user_id=actor_id,
                    organization_id=org_id,
                    target_user_id=target_id,
                )
                resp = GetUserQuotaResponse()
                if row is not None:
                    resp.quota.CopyFrom(user_quota_to_proto(row))
                return resp

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting user quota: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_user_quota(
        self,
        request: UpdateUserQuotaRequest,
        ctx: RequestContext,
    ) -> UserQuotaResponse:
        """Create or update a per-user quota row (org admin only)."""
        actor_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        daily_dollar = (
            request.daily_limit_usd if request.HasField("daily_limit_usd") else None
        )
        monthly_dollar = (
            request.monthly_limit_usd
            if request.HasField("monthly_limit_usd")
            else None
        )
        daily_img = (
            request.daily_image_limit
            if request.HasField("daily_image_limit")
            else None
        )
        monthly_img = (
            request.monthly_image_limit
            if request.HasField("monthly_image_limit")
            else None
        )

        try:
            async with open_session() as session:
                ops = BudgetsOperations(session)
                row = await ops.upsert_user_quota(
                    actor_user_id=actor_id,
                    organization_id=org_id,
                    target_user_id=target_id,
                    daily_limit_usd=daily_dollar,
                    monthly_limit_usd=monthly_dollar,
                    daily_image_limit=daily_img,
                    monthly_image_limit=monthly_img,
                    hard_limit=bool(request.hard_limit),
                )
                return UserQuotaResponse(quota=user_quota_to_proto(row))

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating user quota: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_user_quota(
        self,
        request: DeleteUserQuotaRequest,
        ctx: RequestContext,
    ) -> DeleteUserQuotaResponse:
        """Delete a per-user quota row."""
        actor_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = BudgetsOperations(session)
                await ops.delete_user_quota(
                    actor_user_id=actor_id,
                    organization_id=org_id,
                    target_user_id=target_id,
                )
                return DeleteUserQuotaResponse(success=True)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "User quota not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting user quota: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_user_quotas(
        self,
        request: ListUserQuotasRequest,
        ctx: RequestContext,
    ) -> ListUserQuotasResponse:
        """List all per-user quota rows in an org (org admin only)."""
        actor_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        page = 1
        page_size = 50
        if request.HasField("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            page_size = min(
                request.pagination.page_size
                if request.pagination.page_size > 0
                else 50,
                100,
            )

        try:
            async with open_session() as session:
                ops = BudgetsOperations(session)
                rows, total = await ops.list_user_quotas(
                    user_id=actor_id,
                    organization_id=org_id,
                    page=page,
                    page_size=page_size,
                )
                total_pages = (
                    (total + page_size - 1) // page_size if total > 0 else 0
                )
                return ListUserQuotasResponse(
                    quotas=[user_quota_to_proto(r) for r in rows],
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing user quotas: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_current_spend(
        self,
        request: GetCurrentSpendRequest,
        ctx: RequestContext,
    ) -> GetCurrentSpendResponse:
        """Return current-period spend + image count."""
        actor_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        target_id: UUID | None = None
        if request.HasField("user_id"):
            try:
                target_id = UUID(request.user_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid user_id format")

        try:
            async with open_session() as session:
                ops = BudgetsOperations(session)
                summary = await ops.get_current_spend(
                    actor_user_id=actor_id,
                    organization_id=org_id,
                    target_user_id=target_id,
                )
                return GetCurrentSpendResponse(
                    summary=spend_summary_to_proto(summary),
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting current spend: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
