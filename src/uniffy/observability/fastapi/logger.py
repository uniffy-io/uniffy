"""FastAPI middleware for request logging matching ConnectRPC format."""

import re
import time
from collections.abc import Callable

from loguru import logger

try:
    from fastapi import FastAPI, Request
    from fastapi.routing import APIRoute
except ImportError:
    logger.warning("FastAPI is not installed, skipping request logging")

from uniffy.domains.auth.tokens import decode_access_token
from uniffy.observability.crpc import http_version_var
from uniffy.observability.metrics import HTTP_REQUEST_DURATION, HTTP_REQUESTS_TOTAL

# Pattern to replace UUIDs in paths with a placeholder to prevent cardinality explosion
_UUID_PATTERN = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def _normalize_path(path: str) -> str:
    """Replace UUIDs in a URL path with `:id` to limit metric cardinality."""
    return _UUID_PATTERN.sub(":id", path)


def _extract_user_id_from_request(request: Request) -> str:
    """
    Extract user ID from Authorization header.

    Parameters
    ----------
    request : Request
        The FastAPI request object.

    Returns
    -------
    str
        User ID if authenticated, "unauthenticated" otherwise.

    """
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        return "unauthenticated"

    token = auth_header[7:]  # Remove "Bearer " prefix
    try:
        payload = decode_access_token(token)
        return payload.get("sub", "unauthenticated")
    except Exception:
        return "unauthenticated"


class LoggingMiddleware:
    """
    Middleware for logging FastAPI requests and responses.

    Matches the ConnectRPC LoggingInterceptor format for consistent logs.
    """

    async def __call__(self, request: Request, call_next: Callable):
        """Log request and response with timing."""
        start_time = time.time()

        # Extract request metadata
        method = request.method
        path = request.url.path
        user_id = _extract_user_id_from_request(request)
        http_version = http_version_var.get()

        # Build route name (e.g., "GET /thumbnails/{org_id}/{file_id}")
        route_name = f"{method} {path}"

        normalized_path = _normalize_path(path)

        try:
            response = await call_next(request)
            duration = time.time() - start_time

            # Record Prometheus metrics
            HTTP_REQUESTS_TOTAL.labels(
                method=method, path=normalized_path, status=str(response.status_code)
            ).inc()
            HTTP_REQUEST_DURATION.labels(method=method, path=normalized_path).observe(duration)

            # Log successful completion (matching ConnectRPC format)
            logger.info(
                f"access {route_name}",
                user_id=user_id,
                duration_ms=round(duration * 1000),
                http=http_version,
                status_code=response.status_code,
            )

            return response

        except Exception as e:
            duration = time.time() - start_time

            # Record Prometheus metrics
            HTTP_REQUESTS_TOTAL.labels(method=method, path=normalized_path, status="500").inc()
            HTTP_REQUEST_DURATION.labels(method=method, path=normalized_path).observe(duration)

            # Log error (matching ConnectRPC format)
            logger.error(
                f"error {route_name}",
                user_id=user_id,
                duration_ms=round(duration * 1000),
                http=http_version,
                error_type=type(e).__name__,
                error_message=str(e),
            )
            raise


def setup_request_logging(app: FastAPI):
    """
    Set up request logging for a FastAPI application.

    Parameters
    ----------
    app : FastAPI
        The FastAPI application to add logging to.

    """
    app.middleware("http")(LoggingMiddleware())

    def custom_generate_unique_id(route: APIRoute):
        return f"{route.tags[0] if route.tags else 'default'}.{route.name}"

    app.router.generate_unique_id_function = custom_generate_unique_id
