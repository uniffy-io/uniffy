import time
from collections.abc import Callable

from loguru import logger

try:
    from fastapi import FastAPI, Request
    from fastapi.routing import APIRoute
except ImportError:
    logger.warning("FastAPI is not installed, skipping request logging")


class LoggingMiddleware:
    """
    Middleware for logging FastAPI requests and responses
    """

    async def __call__(self, request: Request, call_next: Callable):
        # Start timer
        start_time = time.time()

        # Process request
        try:
            response = await call_next(request)
            process_time = (time.time() - start_time) * 1000

            # Log successful response
            logger.info(
                "Request completed",
                path=request.url.path,
                method=request.method,
                status_code=response.status_code,
                process_time_ms=round(process_time, 2),
            )

            return response

        except Exception as e:
            process_time = (time.time() - start_time) * 1000

            # Log error response
            logger.error(
                "Request failed",
                extra={
                    "path": request.url.path,
                    "method": request.method,
                    "error": str(e),
                    "process_time_ms": round(process_time, 2),
                },
            )
            raise


def setup_request_logging(app: FastAPI):
    """
    Set up request logging for a FastAPI application
    """
    # Add logging middleware
    app.middleware("http")(LoggingMiddleware())

    # Custom route logging
    def custom_generate_unique_id(route: APIRoute):
        return f"{route.tags[0] if route.tags else 'default'}.{route.name}"

    app.router.generate_unique_id_function = custom_generate_unique_id
