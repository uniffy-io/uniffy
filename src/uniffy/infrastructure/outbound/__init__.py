"""The one way to fetch a URL a person typed: public addresses only, pinned, capped."""

from uniffy.infrastructure.outbound.addresses import (
    OutboundFailure,
    OutboundFetchError,
    normalize_public_url,
)
from uniffy.infrastructure.outbound.fetch import FetchResult, fetch_public

__all__ = [
    "FetchResult",
    "OutboundFailure",
    "OutboundFetchError",
    "fetch_public",
    "normalize_public_url",
]
