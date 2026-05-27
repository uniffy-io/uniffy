"""Action whitelist for the platform-scope audit feed.

The whitelist is the privacy contract: a platform operator viewing
``/platform/audit`` must only see actions that pertain to platform
operations or cross-tenant lifecycle. Tenant content actions
(notes/files/chat/calendar/permissions/projects/tasks/groups/agents)
are excluded by construction.

Adding a new entry here is a security review item -- think twice
before broadening the surface.
"""

from __future__ import annotations

from uniffy.core.audit.actions import Action, tool_call_action  # noqa: F401

PLATFORM_ACTION_PREFIXES: frozenset[str] = frozenset(
    {
        "auth.",
        "user.",
        "organization.",
        "support_session.",
        "system.",
        "deployment.",
        # Mail: only system + force-clear are platform-initiated. The
        # per-org ``mail.sent`` / ``mail.send_failed`` rows belong to
        # tenant audit and are excluded.
        "mail.system_config_",
        "mail.config_force_cleared",
        "mail.suppression_removed",
    }
)


def is_platform_action(action: str) -> bool:
    """True when ``action`` belongs to the platform-scope whitelist."""
    if not action:
        return False
    return any(action.startswith(prefix) for prefix in PLATFORM_ACTION_PREFIXES)


def platform_action_catalog() -> list[tuple[str, str]]:
    """Enumerate every platform action declared on :class:`Action`.

    Returns ``[(action, group), ...]`` for the UI filter dropdown.
    Pulled by reflection so the catalog stays in sync with
    ``core.audit.actions`` without a parallel list to maintain.
    """
    entries: list[tuple[str, str]] = []
    for attr in vars(Action).values():
        if not isinstance(attr, str):
            continue
        if not is_platform_action(attr):
            continue
        group = attr.split(".", 1)[0]
        entries.append((attr, group))
    entries.sort()
    return entries


__all__ = [
    "PLATFORM_ACTION_PREFIXES",
    "is_platform_action",
    "platform_action_catalog",
]
