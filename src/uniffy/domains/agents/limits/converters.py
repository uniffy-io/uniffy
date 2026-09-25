"""Proto <-> domain converters for the rate_limits sub-domain."""

from uniffy_proto.agents.v1.rate_limits_pb import RateLimit
from uniffy_proto.common.v1.common_pb import RateLimitKind
from uniffy_proto.common.v1.common_pb import RateLimitKind as _ProtoRateLimitKind

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
    AGENT_MSG_USER: _ProtoRateLimitKind.AGENT_MSG_USER,
    AGENT_MSG_ORG: _ProtoRateLimitKind.AGENT_MSG_ORG,
    AGENT_MSG_AGENT: _ProtoRateLimitKind.AGENT_MSG_AGENT,
    IMAGE_GEN_USER: _ProtoRateLimitKind.IMAGE_GEN_USER,
    IMAGE_GEN_ORG: _ProtoRateLimitKind.IMAGE_GEN_ORG,
}

RATE_LIMIT_KIND_FROM_PROTO: dict[int, str] = {
    _ProtoRateLimitKind.AGENT_MSG_USER: AGENT_MSG_USER,
    _ProtoRateLimitKind.AGENT_MSG_ORG: AGENT_MSG_ORG,
    _ProtoRateLimitKind.AGENT_MSG_AGENT: AGENT_MSG_AGENT,
    _ProtoRateLimitKind.IMAGE_GEN_USER: IMAGE_GEN_USER,
    _ProtoRateLimitKind.IMAGE_GEN_ORG: IMAGE_GEN_ORG,
}


def rate_limit_kind_to_proto(kind: str) -> RateLimitKind:
    """Convert a domain ``limit_kind`` string to the proto enum."""
    return RATE_LIMIT_KIND_TO_PROTO.get(kind, _ProtoRateLimitKind.UNSPECIFIED)


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
        msg.created_at = datetime_to_timestamp(row.created_at)
    if row.updated_at is not None:
        msg.updated_at = datetime_to_timestamp(row.updated_at)
    return msg
