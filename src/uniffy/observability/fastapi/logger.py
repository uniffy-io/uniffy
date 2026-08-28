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

from uniffy.core.auth.cookies import resolve_asset_cookie_config
from uniffy.core.auth.tokens import decode_access_token, decode_asset_read_token
from uniffy.observability.crpc import http_version_var
from uniffy.observability.metrics import HTTP_REQUEST_DURATION, HTTP_REQUESTS_TOTAL

# UUIDs collapse to `:id` so Prometheus path labels stay bounded.
_UUID_PATTERN = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def _normalize_path(path: str) -> str:
    return _UUID_PATTERN.sub(":id", path)


def _extract_user_id_from_request(request: Request) -> str:
    # Mirrors the asset-route dep: Bearer access token, else the asset_read cookie. Decode only -
    # the route's own dependency does the revocation/permission gate; this is best-effort logging.
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token, decode = auth_header[7:], decode_access_token
    else:
        token = request.cookies.get(resolve_asset_cookie_config().name) or ""
        decode = decode_asset_read_token

    if not token:
        return "unauthenticated"

    try:
        payload = decode(token)
        return payload.get("sub", "unauthenticated")
    except Exception:
        return "unauthenticated"


class LoggingMiddleware:
    """FastAPI request logger mirroring the ConnectRPC interceptor format."""

    async def __call__(self, request: Request, call_next: Callable):
        start_time = time.time()

        method = request.method
        path = request.url.path
        user_id = _extract_user_id_from_request(request)
        http_version = http_version_var.get()

        route_name = path

        normalized_path = _normalize_path(path)

        try:
            response = await call_next(request)
            duration = time.time() - start_time

            HTTP_REQUESTS_TOTAL.labels(
                method=method, path=normalized_path, status=str(response.status_code)
            ).inc()
            HTTP_REQUEST_DURATION.labels(method=method, path=normalized_path).observe(duration)

            # 401/403 come back as a normal Response (FastAPI handles HTTPException), so
            # surface access denials as a distinct WARNING rather than a routine access log.
            if response.status_code in (401, 403):
                logger.warning(
                    f"access denied {route_name}",
                    user_id=user_id,
                    duration_ms=round(duration * 1000),
                    http=http_version,
                    status_code=response.status_code,
                )
            else:
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

            HTTP_REQUESTS_TOTAL.labels(method=method, path=normalized_path, status="500").inc()
            HTTP_REQUEST_DURATION.labels(method=method, path=normalized_path).observe(duration)

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
    """Attach the access-log middleware and a stable operation-id generator."""
    app.middleware("http")(LoggingMiddleware())

    def custom_generate_unique_id(route: APIRoute):
        return f"{route.tags[0] if route.tags else 'default'}.{route.name}"

    app.router.generate_unique_id_function = custom_generate_unique_id
