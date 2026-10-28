"""Request parsing and error mapping shared by the projects RPC handlers."""

from datetime import date
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from loguru import logger

from uniffy.core.errors import NotFoundError, PermissionDeniedError, UNIFFYError, ValidationError

logger = logger.bind(component="projects.rpc")


def parse_uuid(value: str, field: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def parse_date(value: str, field: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: expected YYYY-MM-DD") from exc


def map_domain_error(operation: str, exc: Exception) -> ConnectError:
    """Projects-specific codes; any other domain error propagates to the transport's mapping."""
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc) or "Not found")
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc) or "Access denied")
    if isinstance(exc, UNIFFYError):
        raise exc
    logger.exception(f"Error in {operation}: {exc}")
    return ConnectError(Code.INTERNAL, "Internal server error")
