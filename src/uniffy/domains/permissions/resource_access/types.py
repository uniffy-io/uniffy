from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from uniffy.core.types import ContentRole, ContentType


class ResourceRowState(StrEnum):
    LIVE = "LIVE"
    DELETED = "DELETED"
    MISSING = "MISSING"


class ResourceAccessPurpose(StrEnum):
    SEARCH = "SEARCH"
    REFERENCE = "REFERENCE"
    ACCESS_REQUEST = "ACCESS_REQUEST"
    LIST = "LIST"


class AccessGrantKind(StrEnum):
    STANDARD = "STANDARD"
    CHAT = "CHAT"


@dataclass(frozen=True, slots=True)
class ResourceKey:
    content_type: ContentType
    content_id: UUID


@dataclass(frozen=True, slots=True)
class RequestTarget:
    content_type: ContentType
    content_id: UUID
    grant_kind: AccessGrantKind


@dataclass(frozen=True, slots=True)
class ResourceAccessDecision:
    key: ResourceKey
    row_state: ResourceRowState
    can_view: bool
    role: ContentRole | None = None
    request_target: RequestTarget | None = None


def missing_decision(key: ResourceKey) -> ResourceAccessDecision:
    return ResourceAccessDecision(
        key=key,
        row_state=ResourceRowState.MISSING,
        can_view=False,
    )
