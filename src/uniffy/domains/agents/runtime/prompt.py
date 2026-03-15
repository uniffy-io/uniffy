"""System prompt assembler for agent runtime."""

from datetime import UTC, datetime

from uniffy.domains.agents.tools.registry import get_tool_registry


def build_system_prompt(
    *,
    agent_name: str,
    soul_prompt: str,
    org_name: str,
    user_name: str | None = None,
    user_role: str | None = None,
    enabled_tools: list[str] | None = None,
    skill_contents: list[str] | None = None,
    memory_context: list[str] | None = None,
    prompt_content: str | None = None,
    user_timezone: str | None = None,
) -> str:
    """Assemble the system prompt from modular sections.

    Combines agent personality, metadata, temporal context,
    user identity, skill instructions, tool descriptions,
    memory context, and organization context into a single
    system prompt string.

    Parameters
    ----------
    agent_name : str
        Display name of the agent.
    soul_prompt : str
        Free-form personality, tone, and instruction text.
    org_name : str
        Organization name for context.
    user_name : str | None
        Name of the user talking to the agent.
    user_role : str | None
        User's role in the organization (e.g. "member", "admin", "owner").
    enabled_tools : list[str] | None
        Tool names enabled for this agent. When provided, tool
        descriptions are included in the prompt.
    skill_contents : list[str] | None
        Markdown instruction content from active skills.
    memory_context : list[str] | None
        Relevant memory entries to include in context.
    prompt_content : str | None
        When provided, replaces the default workspace section with
        the content from a prompt template.

    Returns
    -------
    str
        Assembled system prompt.

    """
    sections: list[str] = []

    # Section 1: Soul prompt (personality, instructions)
    if soul_prompt:
        sections.append(soul_prompt)

    # Section 2: Agent name and metadata
    sections.append(f"Your name is {agent_name}.")

    # Section 3: Current date/time and timezone
    now = datetime.now(UTC)
    time_parts = [f"Current date and time: {now.strftime('%Y-%m-%d %H:%M UTC')}."]
    if user_timezone:
        time_parts.append(f"The user's local timezone is {user_timezone}.")
    sections.append(" ".join(time_parts))

    # Section 4: User identity
    user_section = _build_user_section(user_name, user_role, org_name)
    if user_section:
        sections.append(user_section)

    # Section 5: Active skill instructions
    if skill_contents:
        sections.append(
            "The following skill instructions are active for this session:\n\n"
            + "\n\n---\n\n".join(skill_contents)
        )

    # Section 6: Memory context
    if memory_context:
        sections.append(
            "The following are relevant memories from previous interactions "
            "with this user:\n\n" + "\n".join(f"- {m}" for m in memory_context)
        )

    # Section 7: Prompt template content (if selected)
    if prompt_content:
        sections.append(prompt_content)

    # Section 8: Tool descriptions (last so tools are near the conversation)
    tool_section = _build_tool_section(enabled_tools)
    if tool_section:
        sections.append(tool_section)

    return "\n\n".join(sections)


def _build_user_section(
    user_name: str | None,
    user_role: str | None,
    org_name: str,
) -> str | None:
    """Build the user identity section for the system prompt.

    Parameters
    ----------
    user_name : str | None
        Name of the user.
    user_role : str | None
        User's organization role.
    org_name : str
        Organization name.

    Returns
    -------
    str | None
        Formatted user identity section, or None if no user info.

    """
    if not user_name:
        return None

    parts = [f"You are talking to {user_name}"]
    if user_role:
        parts[0] += f" ({user_role} of {org_name})"
    parts[0] += "."

    return parts[0]


def _build_tool_section(enabled_tools: list[str] | None) -> str | None:
    """Build the tool descriptions section for the system prompt.

    Parameters
    ----------
    enabled_tools : list[str] | None
        Tool names the agent has enabled.

    Returns
    -------
    str | None
        Formatted tool description section, or None if no tools.

    """
    if not enabled_tools:
        return None

    registry = get_tool_registry()
    tools = registry.get_for_agent(enabled_tools)
    if not tools:
        return None

    lines = [
        "### Tools",
        "",
        "You have access to the following tools to help the user. "
        "Use them when appropriate to answer questions or perform actions:",
        "",
    ]
    for tool in tools:
        lines.append(f"- {tool.name}: {tool.description}")

    return "\n".join(lines)
