from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from uniffy.core.types import AccessMode, ContentRole, ContentType


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
class ResolvedResourcePolicy:
    content_type: ContentType
    access_mode: AccessMode
    baseline_role: ContentRole | None


@dataclass(frozen=True, slots=True)
class ResourceAccessDecision:
    key: ResourceKey
    row_state: ResourceRowState
    can_view: bool
    role: ContentRole | None = None
    request_target: RequestTarget | None = None
    target_policy: ResolvedResourcePolicy | None = None
    # Visible as a row but not in substance (a private calendar event shown as busy): its
    # comments, attachments and other side surfaces stay closed.
    details_hidden: bool = False

    @property
    def can_read_details(self) -> bool:
        return self.can_view and not self.details_hidden


def missing_decision(key: ResourceKey) -> ResourceAccessDecision:
    return ResourceAccessDecision(
        key=key,
        row_state=ResourceRowState.MISSING,
        can_view=False,
    )
