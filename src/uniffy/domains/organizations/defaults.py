"""Default permission settings for new organizations.

Defines the initial permission defaults that are created for every new
organization. Each content type gets a row in ``permissions_org_defaults``
with these values on org creation.

The defaults are templates for new content: when a user creates a note,
project, etc., the backend reads the matching row from this dict and
applies it to the new content item's ``access_mode`` and ``baseline_role``
columns. Users can override per content after creation.
"""

from typing import TypedDict

from uniffy.core.models.shared import AccessMode, ContentRole, ContentType


class PermissionDefaults(TypedDict):
    """Permission defaults for a single content type."""

    default_access_mode: AccessMode
    default_baseline_role: ContentRole | None


ORG_PERMISSION_DEFAULTS: dict[ContentType, PermissionDefaults] = {
    ContentType.NOTE: {
        "default_access_mode": AccessMode.OWNER_ONLY,
        "default_baseline_role": None,
    },
    ContentType.FILE: {
        "default_access_mode": AccessMode.OWNER_ONLY,
        "default_baseline_role": None,
    },
    ContentType.CALENDAR_EVENT: {
        "default_access_mode": AccessMode.OPEN_TO_ORG,
        "default_baseline_role": ContentRole.VIEWER,
    },
    ContentType.PROJECT: {
        "default_access_mode": AccessMode.OPEN_TO_ORG,
        "default_baseline_role": ContentRole.EDITOR,
    },
    ContentType.AGENT: {
        "default_access_mode": AccessMode.OPEN_TO_ORG,
        "default_baseline_role": ContentRole.VIEWER,
    },
    ContentType.ROOM: {
        "default_access_mode": AccessMode.OPEN_TO_ORG,
        "default_baseline_role": ContentRole.VIEWER,
    },
    ContentType.PROVIDER_KEY: {
        "default_access_mode": AccessMode.OWNER_ONLY,
        "default_baseline_role": None,
    },
    ContentType.PROMPT: {
        "default_access_mode": AccessMode.OPEN_TO_ORG,
        "default_baseline_role": ContentRole.VIEWER,
    },
    ContentType.AGENT_CRON_TASK: {
        "default_access_mode": AccessMode.OWNER_ONLY,
        "default_baseline_role": None,
    },
}
