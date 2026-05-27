from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from typing import Any

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uniffy.observability.metrics import RPC_REQUEST_DURATION, RPC_REQUESTS_TOTAL

# `auth.context` is imported lazily inside `intercept_unary` because the auth
# domain transitively imports the audit writer, which imports this module.
# Importing at top level closes the package-init cycle when the writer wins.

http_version_var: ContextVar[str] = ContextVar("http_version", default="unknown")


class LoggingInterceptor:
    """ConnectRPC unary interceptor that emits access logs + Prometheus metrics."""

    def __init__(self):
        logger.debug("LoggingInterceptor initialized")

    async def intercept_unary(
        self,
        call_next: Callable[[Any, RequestContext], Awaitable[Any]],
        request: Any,
        ctx: RequestContext,
    ) -> Any:
        start_time = time.time()

        method_info = ctx.method()
        full_method = method_info.name if method_info else "unknown"

        if full_method and full_method != "unknown" and "/" in full_method:
            parts = full_method.rsplit("/", 1)
            service_name = parts[0] if len(parts) > 0 else "unknown"
            method_name = parts[1] if len(parts) > 1 else "unknown"
        else:
            service_name = (
                method_info.service_name
                if method_info and hasattr(method_info, "service_name")
                else "unknown"
            )
            method_name = (
                method_info.name if method_info and hasattr(method_info, "name") else full_method
            )

        try:
            from uniffy.domains.auth.context import get_user_id_from_context

            user_id = str(get_user_id_from_context(ctx))
        except Exception:
            # Unauthenticated endpoints (login, register) reach here too.
            user_id = "unauthenticated"

        try:
            response = await call_next(request, ctx)

            duration = time.time() - start_time

            RPC_REQUESTS_TOTAL.labels(service=service_name, method=method_name, code="OK").inc()
            RPC_REQUEST_DURATION.labels(service=service_name, method=method_name).observe(duration)

            logger.info(
                f"access {service_name}/{method_name}",
                user_id=user_id,
                duration_ms=round(duration * 1000),
                http=http_version_var.get(),
            )
            return response

        except ConnectError as e:
            duration = time.time() - start_time

            RPC_REQUESTS_TOTAL.labels(
                service=service_name, method=method_name, code=e.code.name
            ).inc()
            RPC_REQUEST_DURATION.labels(service=service_name, method=method_name).observe(duration)

            logger.error(
                f"error {service_name}/{method_name}",
                user_id=user_id,
                duration_ms=round(duration * 1000),
                error_code=e.code.name,
                error_message=e.message,
            )
            raise

        except Exception as e:
            duration = time.time() - start_time

            RPC_REQUESTS_TOTAL.labels(
                service=service_name, method=method_name, code="INTERNAL"
            ).inc()
            RPC_REQUEST_DURATION.labels(service=service_name, method=method_name).observe(duration)

            logger.error(
                f"error {service_name}/{method_name}",
                user_id=user_id,
                duration_ms=round(duration * 1000),
                error_type=type(e).__name__,
                error_message=str(e),
            )
            logger.exception(f"Unhandled exception {e} in RPC call {service_name}/{method_name}")
            raise ConnectError(
                code=Code.INTERNAL,
                message=f"Internal server error: {str(e)}",
            ) from e
