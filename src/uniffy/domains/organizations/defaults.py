"""Default permission settings for new organizations.

Defines the initial permission defaults that are created for every new
organization. Each content type gets a row in permissions_org_defaults
with these values on org creation.
"""

from typing import TypedDict

from uniffy.core.models.shared import ContentType, VisibilityScope


class PermissionDefaults(TypedDict):
    """Permission defaults for a single content type."""

    default_visibility: VisibilityScope
    members_can_view: bool
    members_can_edit: bool
    members_can_delete: bool
    members_can_share: bool


ORG_PERMISSION_DEFAULTS: dict[ContentType, PermissionDefaults] = {
    ContentType.NOTE: {
        "default_visibility": VisibilityScope.PRIVATE,
        "members_can_view": True,
        "members_can_edit": False,
        "members_can_delete": False,
        "members_can_share": False,
    },
    ContentType.FILE: {
        "default_visibility": VisibilityScope.PRIVATE,
        "members_can_view": True,
        "members_can_edit": False,
        "members_can_delete": False,
        "members_can_share": False,
    },
    ContentType.PROJECT: {
        "default_visibility": VisibilityScope.ORGANIZATION,
        "members_can_view": True,
        "members_can_edit": True,
        "members_can_delete": False,
        "members_can_share": False,
    },
    ContentType.CALENDAR_EVENT: {
        "default_visibility": VisibilityScope.ORGANIZATION,
        "members_can_view": True,
        "members_can_edit": True,
        "members_can_delete": False,
        "members_can_share": False,
    },
    ContentType.AGENT: {
        "default_visibility": VisibilityScope.ORGANIZATION,
        "members_can_view": True,
        "members_can_edit": False,
        "members_can_delete": False,
        "members_can_share": False,
    },
}
