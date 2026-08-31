"""Viewer relation for a person record.

Member-record gating by org role, NOT content permissions: it must import
nothing from `core/auth/permissions/` and never touches `PermissionChecker` or
`effective_role`. The relation decides edit affordances only - every profile
field an org member fills in is readable by the whole org.
"""

from enum import Enum
from uuid import UUID


class ViewerRelation(str, Enum):
    SELF = "SELF"
    ORG_ADMIN = "ORG_ADMIN"
    MEMBER = "MEMBER"


def relation_for(viewer_id: UUID, target_id: UUID, *, is_admin: bool) -> ViewerRelation:
    if viewer_id == target_id:
        return ViewerRelation.SELF
    return ViewerRelation.ORG_ADMIN if is_admin else ViewerRelation.MEMBER
