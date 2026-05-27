"""Initial permission defaults seeded into ``permissions_org_defaults`` on org creation."""

from typing import Any, TypedDict

from uniffy.core.models.shared import AccessMode, ContentRole, ContentType


class PermissionDefaults(TypedDict):
    default_access_mode: AccessMode
    default_baseline_role: ContentRole | None


DEFAULT_ORG_SETTINGS: dict[str, Any] = {
    "chat": {
        "agents_enabled": True,
    },
}


ORG_PERMISSION_DEFAULTS: dict[ContentType, PermissionDefaults] = {
    ContentType.NOTE: {
        "default_access_mode": AccessMode.OPEN_TO_ORG,
        "default_baseline_role": ContentRole.EDITOR,
    },
    ContentType.FILE: {
        "default_access_mode": AccessMode.OPEN_TO_ORG,
        "default_baseline_role": ContentRole.VIEWER,
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
