"""Proto <-> domain converters for the rate_limits sub-domain."""

from uniffy_proto.agents.v1.rate_limits_pb2 import RateLimit
from uniffy_proto.common.v1.common_pb2 import (
    RATE_LIMIT_KIND_AGENT_MSG_AGENT,
    RATE_LIMIT_KIND_AGENT_MSG_ORG,
    RATE_LIMIT_KIND_AGENT_MSG_USER,
    RATE_LIMIT_KIND_IMAGE_GEN_ORG,
    RATE_LIMIT_KIND_IMAGE_GEN_USER,
    RATE_LIMIT_KIND_UNSPECIFIED,
    RateLimitKind,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.domains.agents.limits.operations import RateLimitRow
from uniffy.domains.agents.limits.policy import (
    AGENT_MSG_AGENT,
    AGENT_MSG_ORG,
    AGENT_MSG_USER,
    IMAGE_GEN_ORG,
    IMAGE_GEN_USER,
)

RATE_LIMIT_KIND_TO_PROTO: dict[str, RateLimitKind] = {
    AGENT_MSG_USER: RATE_LIMIT_KIND_AGENT_MSG_USER,
    AGENT_MSG_ORG: RATE_LIMIT_KIND_AGENT_MSG_ORG,
    AGENT_MSG_AGENT: RATE_LIMIT_KIND_AGENT_MSG_AGENT,
    IMAGE_GEN_USER: RATE_LIMIT_KIND_IMAGE_GEN_USER,
    IMAGE_GEN_ORG: RATE_LIMIT_KIND_IMAGE_GEN_ORG,
}

RATE_LIMIT_KIND_FROM_PROTO: dict[int, str] = {
    RATE_LIMIT_KIND_AGENT_MSG_USER: AGENT_MSG_USER,
    RATE_LIMIT_KIND_AGENT_MSG_ORG: AGENT_MSG_ORG,
    RATE_LIMIT_KIND_AGENT_MSG_AGENT: AGENT_MSG_AGENT,
    RATE_LIMIT_KIND_IMAGE_GEN_USER: IMAGE_GEN_USER,
    RATE_LIMIT_KIND_IMAGE_GEN_ORG: IMAGE_GEN_ORG,
}


def rate_limit_kind_to_proto(kind: str) -> RateLimitKind:
    """Convert a domain ``limit_kind`` string to the proto enum."""
    return RATE_LIMIT_KIND_TO_PROTO.get(kind, RATE_LIMIT_KIND_UNSPECIFIED)


def rate_limit_kind_from_proto(kind: RateLimitKind) -> str | None:
    """Convert a proto ``RateLimitKind`` enum to the domain string.

    Returns ``None`` for ``RATE_LIMIT_KIND_UNSPECIFIED`` so callers can
    raise an explicit validation error.
    """
    return RATE_LIMIT_KIND_FROM_PROTO.get(kind)


def rate_limit_row_to_proto(row: RateLimitRow) -> RateLimit:
    """Convert a ``RateLimitRow`` (override or default) to proto."""
    msg = RateLimit(
        kind=rate_limit_kind_to_proto(row.kind),
        limit=row.limit,
        window_seconds=row.window_seconds,
        is_override=row.is_override,
    )
    if row.created_at is not None:
        msg.created_at.CopyFrom(datetime_to_timestamp(row.created_at))
    if row.updated_at is not None:
        msg.updated_at.CopyFrom(datetime_to_timestamp(row.updated_at))
    return msg
