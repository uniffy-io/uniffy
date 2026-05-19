"""PricingService RPC handlers."""

from datetime import datetime
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.agents.v1.pricing_pb2 import (
    DeleteModelPricingRequest,
    DeleteModelPricingResponse,
    ListModelPricingRequest,
    ListModelPricingResponse,
    ModelPricingResponse,
    UpsertModelPricingRequest,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.agents.pricing_service.converters import model_pricing_to_proto
from uniffy.domains.agents.pricing_service.operations import PricingServiceOperations
from uniffy.domains.auth.context import get_user_id_from_context


def _ts_to_dt(ts) -> datetime | None:
    """Convert a proto Timestamp to a timezone-aware datetime, or None."""
    if ts is None or (ts.seconds == 0 and ts.nanos == 0):
        return None
    return ts.ToDatetime().astimezone()


class PricingHandlers:
    """Handlers for ``agents.v1.PricingService``."""

    async def list_model_pricing(
        self,
        request: ListModelPricingRequest,
        ctx: RequestContext,
    ) -> ListModelPricingResponse:
        """Return pricing rows, optionally filtered by provider/kind/as_of."""
        get_user_id_from_context(ctx)  # authenticated but no role check

        provider = request.provider if request.HasField("provider") else None
        kind = request.kind if request.HasField("kind") else None
        as_of = _ts_to_dt(request.as_of) if request.HasField("as_of") else None

        try:
            async with open_session() as session:
                ops = PricingServiceOperations(session)
                rows = await ops.list_pricing(
                    provider=provider,
                    kind=kind,
                    as_of=as_of,
                )
                return ListModelPricingResponse(
                    rows=[model_pricing_to_proto(r) for r in rows],
                )

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing model pricing: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def upsert_model_pricing(
        self,
        request: UpsertModelPricingRequest,
        ctx: RequestContext,
    ) -> ModelPricingResponse:
        """Create or overwrite a pricing row (system-admin only)."""
        user_id = get_user_id_from_context(ctx)

        effective_from = _ts_to_dt(request.effective_from)
        if effective_from is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "effective_from is required")
        effective_to = (
            _ts_to_dt(request.effective_to) if request.HasField("effective_to") else None
        )

        image_prices = [
            (p.size, p.quality, p.price) for p in request.image_prices
        ]

        try:
            async with open_session() as session:
                ops = PricingServiceOperations(session)
                row = await ops.upsert_pricing(
                    actor_user_id=user_id,
                    provider=request.provider,
                    model=request.model,
                    kind=request.kind,
                    input_per_1m=(
                        request.input_per_1m
                        if request.HasField("input_per_1m")
                        else None
                    ),
                    output_per_1m=(
                        request.output_per_1m
                        if request.HasField("output_per_1m")
                        else None
                    ),
                    cached_input_per_1m=(
                        request.cached_input_per_1m
                        if request.HasField("cached_input_per_1m")
                        else None
                    ),
                    thinking_per_1m=(
                        request.thinking_per_1m
                        if request.HasField("thinking_per_1m")
                        else None
                    ),
                    image_prices=image_prices or None,
                    effective_from=effective_from,
                    effective_to=effective_to,
                )
                return ModelPricingResponse(row=model_pricing_to_proto(row))

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error upserting model pricing: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_model_pricing(
        self,
        request: DeleteModelPricingRequest,
        ctx: RequestContext,
    ) -> DeleteModelPricingResponse:
        """Delete a pricing row by id (system-admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            pricing_id = UUID(request.id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid pricing id format")

        try:
            async with open_session() as session:
                ops = PricingServiceOperations(session)
                await ops.delete_pricing(
                    actor_user_id=user_id,
                    pricing_id=pricing_id,
                )
                return DeleteModelPricingResponse(success=True)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Pricing row not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting model pricing: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
