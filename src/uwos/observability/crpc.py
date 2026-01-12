from __future__ import annotations

"""ConnectRPC interceptors for observability and logging."""

import time
from collections.abc import Awaitable, Callable
from typing import Any

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uwos.domains.auth.context import get_user_id_from_context


class LoggingInterceptor:
    """
    ConnectRPC interceptor for logging requests and responses with loguru.

    Logs the following information:
    - Request start (method name, service name)
    - Request completion (duration, status code)
    - Request errors (error code, error message)
    - Request metadata (headers, user info if available)
    """

    def __init__(self):
        """Initialize the logging interceptor."""
        logger.debug("LoggingInterceptor initialized")

    async def intercept_unary(
        self,
        call_next: Callable[[Any, RequestContext], Awaitable[Any]],
        request: Any,
        ctx: RequestContext,
    ) -> Any:
        """
        Intercept unary RPC calls.

        Args:
            call_next: The next handler in the interceptor chain.
            request: The request message.
            ctx: The request context containing headers and metadata.

        Returns:
            The response from the next handler.

        Raises:
            ConnectError: If the RPC call fails.
        """
        start_time = time.time()

        # Extract request metadata from context
        method_info = ctx.method()
        full_method = method_info.name if method_info else "unknown"

        # Parse service and method names
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

        # Extract user info from auth context
        try:
            user_id = str(get_user_id_from_context(ctx))
        except Exception:
            # If auth fails, user is not authenticated (e.g., login/register endpoints)
            user_id = "unauthenticated"

        # Extract request ID from headers if available

        try:
            # Call the next handler
            response = await call_next(request, ctx)

            # Calculate duration
            duration = time.time() - start_time

            # Log successful completion
            logger.info(
                f"access {service_name}/{method_name}",
                user_id=user_id,
                duration_seconds=round(duration, 3),
            )
            return response

        except ConnectError as e:
            # Calculate duration
            duration = time.time() - start_time

            # Log error
            logger.error(
                f"error {service_name}/{method_name}",
                user_id=user_id,
                duration_seconds=round(duration, 3),
                error_code=e.code.name,
                error_message=e.message,
            )
            raise

        except Exception as e:
            # Calculate duration
            duration = time.time() - start_time
            logger.error(
                f"error {service_name}/{method_name}",
                user_id=user_id,
                duration_seconds=round(duration, 3),
                error_type=type(e).__name__,
                error_message=str(e),
            )
            logger.exception(f"Unhandled exception {e} in RPC call {service_name}/{method_name}")
            raise ConnectError(
                code=Code.INTERNAL,
                message=f"Internal server error: {str(e)}",
            ) from e
