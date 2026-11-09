"""Outbound HTTP: typed URLs through ``fetch_public``, fixed provider hosts through ``ApiClient``."""

from uniffy.infrastructure.outbound.addresses import (
    OutboundFailure,
    OutboundFetchError,
    normalize_public_url,
)
from uniffy.infrastructure.outbound.api import ApiClient, ApiError, ApiResponse, parse_retry_after
from uniffy.infrastructure.outbound.fetch import FetchResult, fetch_public

__all__ = [
    "ApiClient",
    "ApiError",
    "ApiResponse",
    "FetchResult",
    "OutboundFailure",
    "OutboundFetchError",
    "fetch_public",
    "normalize_public_url",
    "parse_retry_after",
]
