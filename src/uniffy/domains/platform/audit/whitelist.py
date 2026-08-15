"""Privacy contract for the platform audit feed; tenant content actions
are excluded by construction.
"""

from __future__ import annotations

from uniffy.core.audit.actions import Action, tool_call_action  # noqa: F401

PLATFORM_ACTION_PREFIXES: frozenset[str] = frozenset({
    "auth.",
    "user.",
    "organization.",
    "support_session.",
    "system.",
    "deployment.",
    # Per-org mail.sent/send_failed belong to tenant audit; only system
    # + force-clear are platform-initiated.
    "mail.system_config_",
    "mail.config_force_cleared",
    "mail.suppression_removed",
})


def is_platform_action(action: str) -> bool:
    if not action:
        return False
    return any(action.startswith(prefix) for prefix in PLATFORM_ACTION_PREFIXES)


def platform_action_catalog() -> list[tuple[str, str]]:
    """Reflection over :class:`Action` so the catalog stays in sync without a parallel list."""
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
