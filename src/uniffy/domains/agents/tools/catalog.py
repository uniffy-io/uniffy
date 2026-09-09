"""The builder-facing view of the tool registry.

The registry knows what a tool does; this module knows how the agent builder
presents it. It is the only source of that copy - the frontend renders whatever
``ListTools`` returns rather than keeping its own list.
"""

from __future__ import annotations

from dataclasses import dataclass

from uniffy.domains.agents.tools.definitions import CATEGORY_EXTERNAL, CATEGORY_PLATFORM
from uniffy.domains.agents.tools.registry import ToolRegistry, get_tool_registry

# Presentation order for the builder. A group missing here sorts last, so a new
# tool shows up in the UI without an edit; adding its group here places it.
GROUP_ORDER: list[str] = [
    "Notes",
    "Files",
    "Projects",
    "Tasks",
    "Calendar",
    "Rooms",
    "Search",
    "People",
    "Memory",
    "Scheduling",
    "System",
    "Images",
    "GitHub",
]

CATEGORY_ORDER: list[str] = [CATEGORY_PLATFORM, CATEGORY_EXTERNAL]


@dataclass(frozen=True)
class ToolCatalogEntry:
    """One selectable capability in the agent builder."""

    name: str
    display_name: str
    description: str
    group: str
    category: str
    destructive: bool
    # Integration provider id whose org connection this tool calls through,
    # empty for platform tools. The builder uses it to show the connection
    # picker and to explain why a group is unavailable.
    requires_connection: str


def _fallback_display_name(name: str) -> str:
    action = name.split(".")[-1]
    return " ".join(word.capitalize() for word in action.split("_"))


def _fallback_group(name: str) -> str:
    return name.split(".")[0].capitalize()


def _sort_key(entry: ToolCatalogEntry, registry_order: dict[str, int]) -> tuple:
    category = (
        CATEGORY_ORDER.index(entry.category)
        if entry.category in CATEGORY_ORDER
        else len(CATEGORY_ORDER)
    )
    group = GROUP_ORDER.index(entry.group) if entry.group in GROUP_ORDER else len(GROUP_ORDER)
    return (category, group, entry.group, registry_order.get(entry.name, 0))


def list_tool_catalog(registry: ToolRegistry | None = None) -> list[ToolCatalogEntry]:
    """Every builder-selectable tool, ordered as the builder renders it."""
    from uniffy.domains.integrations.registry import get_integration_registry

    registry = registry or get_tool_registry()
    integrations = get_integration_registry()

    tools = list(registry.all())
    registry_order = {tool.name: index for index, tool in enumerate(tools)}

    entries = [
        ToolCatalogEntry(
            name=tool.name,
            display_name=tool.display_name or _fallback_display_name(tool.name),
            description=tool.description,
            group=tool.group or _fallback_group(tool.name),
            category=tool.category,
            destructive=tool.destructive,
            requires_connection=(
                prefix if integrations.get(prefix := tool.name.split(".", 1)[0]) else ""
            ),
        )
        for tool in tools
        if not tool.internal
    ]

    return sorted(entries, key=lambda e: _sort_key(e, registry_order))
