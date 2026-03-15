"""Singleton tool registry for agents."""

from uniffy.domains.agents.tools.definitions import ToolDefinition


def to_api_name(name: str) -> str:
    """Convert internal tool name to Anthropic API-safe format.

    The Anthropic API requires tool names to match ``^[a-zA-Z0-9_-]{1,128}$``.
    Internal names use dot notation (e.g. ``notes.search_notes``), so dots
    are replaced with hyphens.

    Parameters
    ----------
    name : str
        Internal tool name (may contain dots).

    Returns
    -------
    str
        API-safe name with dots replaced by hyphens.

    """
    return name.replace(".", "-")


def from_api_name(name: str) -> str:
    """Convert an Anthropic API tool name back to internal format.

    Reverses the dot-to-hyphen mapping applied by :func:`to_api_name`.

    Parameters
    ----------
    name : str
        API tool name (hyphens instead of dots).

    Returns
    -------
    str
        Internal tool name with hyphens restored to dots.

    """
    return name.replace("-", ".")


class ToolRegistry:
    """Registry of available tools for agents.

    Maintains a name-keyed mapping of ToolDefinition instances.
    Tools are registered at module load time and looked up per-request
    based on an agent's ``enabled_tools`` list.
    """

    def __init__(self) -> None:
        self._tools: dict[str, ToolDefinition] = {}

    def register(self, tool: ToolDefinition) -> None:
        """Register a tool definition.

        Parameters
        ----------
        tool : ToolDefinition
            The tool to register.

        Raises
        ------
        ValueError
            If a tool with the same name is already registered.

        """
        if tool.name in self._tools:
            raise ValueError(f"Tool already registered: {tool.name}")
        self._tools[tool.name] = tool

    def get(self, name: str) -> ToolDefinition | None:
        """Look up a tool by name.

        Accepts both internal (dotted) and API (hyphenated) name formats.

        Parameters
        ----------
        name : str
            Tool identifier (internal or API format).

        Returns
        -------
        ToolDefinition | None
            The tool definition, or None if not found.

        """
        tool = self._tools.get(name)
        if tool is None:
            tool = self._tools.get(from_api_name(name))
        return tool

    def get_for_agent(self, enabled_tools: list[str]) -> list[ToolDefinition]:
        """Return tool definitions for an agent's enabled tool list.

        Unknown tool names are silently skipped.

        Parameters
        ----------
        enabled_tools : list[str]
            Tool names the agent has enabled.

        Returns
        -------
        list[ToolDefinition]
            Matching tool definitions.

        """
        return [self._tools[name] for name in enabled_tools if name in self._tools]

    def is_destructive(self, name: str) -> bool:
        """Check if a tool is marked as destructive.

        Accepts both internal (dotted) and API (hyphenated) name formats.

        Parameters
        ----------
        name : str
            Tool identifier (internal or API format).

        Returns
        -------
        bool
            True if the tool is destructive and requires confirmation.

        """
        tool = self.get(name)
        return tool.destructive if tool else False

    def get_anthropic_schemas(self, enabled_tools: list[str]) -> list[dict]:
        """Convert enabled tools to Anthropic tool-use format.

        Parameters
        ----------
        enabled_tools : list[str]
            Tool names the agent has enabled.

        Returns
        -------
        list[dict]
            Tool schemas in ``{"name", "description", "input_schema"}`` format.

        """
        return [
            {
                "name": to_api_name(tool.name),
                "description": tool.description,
                "input_schema": tool.parameter_schema,
            }
            for tool in self.get_for_agent(enabled_tools)
        ]


_registry: ToolRegistry | None = None


def get_tool_registry() -> ToolRegistry:
    """Return the global tool registry, initializing on first call.

    Built-in tools are registered via the ``builtin`` package import.

    Returns
    -------
    ToolRegistry
        The singleton registry instance.

    """
    global _registry  # noqa: PLW0603
    if _registry is None:
        _registry = ToolRegistry()
        # Importing the builtin package triggers tool registration
        from uniffy.domains.agents.tools.builtin import register_all

        register_all(_registry)
    return _registry
