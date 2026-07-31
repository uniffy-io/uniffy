"""Built-in tool implementations for agents."""

from uniffy.domains.agents.tools.builtin.calendar import CALENDAR_TOOLS
from uniffy.domains.agents.tools.builtin.cron import CRON_TOOLS
from uniffy.domains.agents.tools.builtin.discovery import DISCOVERY_TOOLS
from uniffy.domains.agents.tools.builtin.files import FILES_TOOLS
from uniffy.domains.agents.tools.builtin.images import IMAGES_TOOLS
from uniffy.domains.agents.tools.builtin.memory import MEMORY_TOOLS
from uniffy.domains.agents.tools.builtin.notes import NOTES_TOOLS
from uniffy.domains.agents.tools.builtin.projects import PROJECT_TOOLS, TASK_TOOLS
from uniffy.domains.agents.tools.builtin.rooms import ROOMS_TOOLS
from uniffy.domains.agents.tools.builtin.search import PEOPLE_TOOLS, SEARCH_TOOLS
from uniffy.domains.agents.tools.builtin.skills import SKILL_TOOLS
from uniffy.domains.agents.tools.builtin.system import SYSTEM_TOOLS
from uniffy.domains.agents.tools.registry import ToolRegistry


def register_all(registry: ToolRegistry) -> None:
    """Register all built-in tools on the given registry.

    Parameters
    ----------
    registry : ToolRegistry
        The registry to populate.

    """
    for tool in NOTES_TOOLS:
        registry.register(tool)
    for tool in FILES_TOOLS:
        registry.register(tool)
    for tool in CALENDAR_TOOLS:
        registry.register(tool)
    for tool in ROOMS_TOOLS:
        registry.register(tool)
    for tool in PROJECT_TOOLS:
        registry.register(tool)
    for tool in TASK_TOOLS:
        registry.register(tool)
    for tool in SEARCH_TOOLS:
        registry.register(tool)
    for tool in PEOPLE_TOOLS:
        registry.register(tool)
    for tool in MEMORY_TOOLS:
        registry.register(tool)
    for tool in IMAGES_TOOLS:
        registry.register(tool)
    for tool in CRON_TOOLS:
        registry.register(tool)
    for tool in SKILL_TOOLS:
        registry.register(tool)
    for tool in SYSTEM_TOOLS:
        registry.register(tool)
    for tool in DISCOVERY_TOOLS:
        registry.register(tool)

    # Integration tool packs live with their integration (domains/integrations/
    # providers/*), not in this package; the registry aggregates them here.
    from uniffy.domains.integrations.registry import get_integration_registry

    for tool in get_integration_registry().all_tools():
        registry.register(tool)
