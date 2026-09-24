from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from typing import Any

from connectrpc.code import Code
from connectrpc.codec import Codec, proto_binary_codec, proto_json_codec
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from prometheus_client import Counter, Histogram

from uniffy.core.auth.principal import current_user_id
from uniffy.core.errors import (
    AuthenticationError,
    BudgetExceededError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitExceededError,
    RuntimeDeadlineExceededError,
    UNIFFYError,
    ValidationError,
)

logger = logger.bind(component="transport.rpc")

RPC_REQUESTS_TOTAL = Counter(
    "uniffy_rpc_requests_total",
    "Total ConnectRPC requests",
    ["service", "method", "code"],
)

RPC_REQUEST_DURATION = Histogram(
    "uniffy_rpc_request_duration_seconds",
    "ConnectRPC request duration in seconds",
    ["service", "method"],
)

# Safety net for handlers without their own mapping: a domain error that
# reaches the interceptor becomes its proper Connect code instead of INTERNAL.
# Domain error messages are client-safe by construction; anything else is not
# and gets a generic INTERNAL with no exception text attached.
DOMAIN_ERROR_CODES: dict[type[UNIFFYError], Code] = {
    NotFoundError: Code.NOT_FOUND,
    PermissionDeniedError: Code.PERMISSION_DENIED,
    ValidationError: Code.INVALID_ARGUMENT,
    ConflictError: Code.ALREADY_EXISTS,
    AuthenticationError: Code.UNAUTHENTICATED,
    RateLimitExceededError: Code.RESOURCE_EXHAUSTED,
    BudgetExceededError: Code.RESOURCE_EXHAUSTED,
    RuntimeDeadlineExceededError: Code.DEADLINE_EXCEEDED,
}


def code_for_domain_error(error: UNIFFYError) -> Code | None:
    for error_type, code in DOMAIN_ERROR_CODES.items():
        if isinstance(error, error_type):
            return code
    return None


class StrictDecodeCodec:
    """Keep parser details out of client-visible decoding errors."""

    def __init__(self, inner: Codec, name: str | None = None) -> None:
        self._inner = inner
        self._name = name if name is not None else inner.name()

    def name(self) -> str:
        return self._name

    def encode(self, message: Any) -> bytes:
        return self._inner.encode(message)

    def decode(self, data: bytes | bytearray, message_class: type[Any]) -> Any:
        try:
            return self._inner.decode(data, message_class)
        except ConnectError:
            raise
        except Exception as e:
            logger.warning(f"malformed request body ({type(e).__name__})")
            raise ConnectError(code=Code.INVALID_ARGUMENT, message="Malformed request body") from e


def strict_request_codecs() -> list[Codec]:
    json_codec = proto_json_codec(ignore_unknown_fields=False)
    return [
        StrictDecodeCodec(proto_binary_codec()),
        StrictDecodeCodec(json_codec),
        # connect-go compatibility: the charset-suffixed content type is its
        # own codec name in the registry.
        StrictDecodeCodec(json_codec, name="json; charset=utf-8"),
    ]


def _rpc_labels(ctx: RequestContext) -> tuple[str, str]:
    method_info = ctx.method
    full_method = method_info.name if method_info else "unknown"

    if full_method and full_method != "unknown" and "/" in full_method:  # noqa: PLR2004
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
    return service_name, method_name


def _rpc_user_id() -> str:
    try:
        return str(current_user_id())
    except Exception:
        # Unauthenticated endpoints (login, register) reach here too.
        return "unauthenticated"


def _sanitized_connect_error(
    e: Exception, service_name: str, method_name: str, user_id: str
) -> ConnectError:
    """One leak policy for every RPC shape: domain errors keep their message
    and code; anything else becomes a bare INTERNAL."""
    if isinstance(e, UNIFFYError):
        code = code_for_domain_error(e)
        if code is not None:
            logger.warning(
                f"error {service_name}/{method_name}",
                user_id=user_id,
                error_code=code.name,
                error_message=str(e),
            )
            return ConnectError(code=code, message=str(e))
    logger.exception(f"Unhandled exception {e} in RPC call {service_name}/{method_name}")
    return ConnectError(code=Code.INTERNAL, message="Internal server error")


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
        service_name, method_name = _rpc_labels(ctx)
        user_id = _rpc_user_id()

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

            # Auth (401) and permission (403) failures are expected client outcomes, not
            # server errors - log them as a distinct WARNING so they read clearly and do
            # not drown the ERROR stream.
            if e.code in (Code.UNAUTHENTICATED, Code.PERMISSION_DENIED):
                logger.warning(
                    f"access denied {service_name}/{method_name}",
                    user_id=user_id,
                    duration_ms=round(duration * 1000),
                    http=http_version_var.get(),
                    error_code=e.code.name,
                )
            else:
                logger.error(
                    f"error {service_name}/{method_name}",
                    user_id=user_id,
                    duration_ms=round(duration * 1000),
                    error_code=e.code.name,
                    error_message=e.message,
                )
            raise

        except UNIFFYError as e:
            duration = time.time() - start_time
            code = code_for_domain_error(e)

            if code is not None:
                RPC_REQUESTS_TOTAL.labels(
                    service=service_name, method=method_name, code=code.name
                ).inc()
                RPC_REQUEST_DURATION.labels(service=service_name, method=method_name).observe(
                    duration
                )
                # Expected client outcomes, same treatment as mapped ConnectErrors.
                logger.warning(
                    f"error {service_name}/{method_name}",
                    user_id=user_id,
                    duration_ms=round(duration * 1000),
                    error_code=code.name,
                    error_message=str(e),
                )
                raise ConnectError(code=code, message=str(e)) from e

            RPC_REQUESTS_TOTAL.labels(
                service=service_name, method=method_name, code="INTERNAL"
            ).inc()
            RPC_REQUEST_DURATION.labels(service=service_name, method=method_name).observe(duration)
            logger.exception(f"Unmapped domain error in RPC call {service_name}/{method_name}")
            raise ConnectError(code=Code.INTERNAL, message="Internal server error") from e

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
            # Exception text is server-internal; never ship it to the client.
            raise ConnectError(code=Code.INTERNAL, message="Internal server error") from e

    async def intercept_server_stream(
        self,
        call_next: Callable[[Any, RequestContext], Any],
        request: Any,
        ctx: RequestContext,
    ) -> Any:
        """Streams bypass the unary path; without this, an exception escaping a
        stream handler reaches the wire as UNKNOWN + raw `str(exc)`."""
        service_name, method_name = _rpc_labels(ctx)
        user_id = _rpc_user_id()
        start_time = time.time()
        code = "OK"
        try:
            async for response in call_next(request, ctx):
                yield response
        except ConnectError as e:
            code = e.code.name
            raise
        except Exception as e:
            error = _sanitized_connect_error(e, service_name, method_name, user_id)
            code = error.code.name
            raise error from e
        finally:
            duration = time.time() - start_time
            RPC_REQUESTS_TOTAL.labels(service=service_name, method=method_name, code=code).inc()
            RPC_REQUEST_DURATION.labels(service=service_name, method=method_name).observe(duration)
            logger.info(
                f"stream end {service_name}/{method_name}",
                user_id=user_id,
                duration_ms=round(duration * 1000),
                error_code=code,
            )

    async def intercept_bidi_stream(
        self,
        call_next: Callable[[Any, RequestContext], Any],
        request: Any,
        ctx: RequestContext,
    ) -> Any:
        service_name, method_name = _rpc_labels(ctx)
        user_id = _rpc_user_id()
        try:
            async for response in call_next(request, ctx):
                yield response
        except ConnectError:
            raise
        except Exception as e:
            raise _sanitized_connect_error(e, service_name, method_name, user_id) from e

    async def intercept_client_stream(
        self,
        call_next: Callable[[Any, RequestContext], Awaitable[Any]],
        request: Any,
        ctx: RequestContext,
    ) -> Any:
        service_name, method_name = _rpc_labels(ctx)
        user_id = _rpc_user_id()
        try:
            return await call_next(request, ctx)
        except ConnectError:
            raise
        except Exception as e:
            raise _sanitized_connect_error(e, service_name, method_name, user_id) from e
