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
    chat_context: str | None = None,
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

    # Section 3: Current date and timezone. Day-level granularity only --
    # a minute-level timestamp here would invalidate the prompt cache on
    # every turn. The agent calls a tool when it needs the actual time.
    now = datetime.now(UTC)
    time_parts = [f"Today's date is {now.strftime('%Y-%m-%d')} (UTC)."]
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

    # Section 7b: Chat-channel context (only set on chat-triggered turns).
    # Placed just before the tools section so the agent has a fresh picture
    # of where it is and who it's talking to right before the conversation
    # history starts.
    if chat_context:
        sections.append(chat_context)

    # Section 7c: Output formatting rules. Some providers reach for
    # remark-directive syntax (`::: note`, `::: warning`, `::: writing
    # block`, ...) when producing long-form content. Standard CommonMark
    # (which the chat renderer uses) does not parse those fences, so
    # they leak as raw `:::` lines in the bubble. Constrain the model
    # explicitly.
    sections.append(_OUTPUT_FORMATTING_RULES)

    # Section 8: Tool descriptions (last so tools are near the conversation)
    tool_section = _build_tool_section(enabled_tools)
    if tool_section:
        sections.append(tool_section)

    return "\n\n".join(sections)


_OUTPUT_FORMATTING_RULES = (
    "## Output formatting\n"
    "\n"
    "Reply in standard CommonMark only. Do not use directive blocks "
    "(no `::: note`, `::: warning`, `::: writing block`, or any other "
    "`:::` fences) -- the chat renderer treats them as plain text and "
    "they appear as raw `:::` lines to the user. Use blockquotes (`>`), "
    "headings, lists, and fenced code blocks instead.\n"
    "\n"
    "Mention chips use the `[[[label|urn:uniffy:...]]]` syntax and the "
    "renderer expands them into a card on a line of their own. Two "
    "rules when you write one:\n"
    "\n"
    "1. Never put a colon (`:`) directly after a mention chip. The "
    "card already labels itself, so a trailing colon shows up as a "
    "stray `:` floating above the next paragraph (e.g. write "
    '"Here is a summary of [[[Foo|urn:...]]]" then a sentence on '
    'the next line, NOT "Summary of [[[Foo|urn:...]]]:").\n'
    "2. Always put a blank line (or a list-item break) immediately "
    "after a mention chip before continuing with prose -- otherwise "
    "the chip and the following text collapse into the same line and "
    "the layout breaks."
)


def build_chat_context_section(
    *,
    channel_type: str,
    channel_name: str,
    channel_description: str | None,
    participant_users: list[str],
    participant_agents: list[str],
    trigger_user_name: str,
    trigger_rule: str | None,
    in_thread: bool,
) -> str:
    """Assemble the chat-channel orientation block for the system prompt.

    Surfaces what the agent needs to stay coherent in a shared conversation:
    channel identity, who the other participants are (so references like
    "Alice" / "@Bob" land), and how this turn was triggered. The writer
    separately prefixes each user/agent message in the conversation
    history with its author name, so the agent can match names here to
    speakers below.
    """
    surface = _describe_surface(channel_type)
    lines: list[str] = ["## Chat context", "", f'You are replying in {surface} "{channel_name}".']

    if channel_description:
        lines.append(f"Channel description: {channel_description}")

    other_users = [n for n in participant_users if n and n != trigger_user_name]
    other_agents = [n for n in participant_agents if n and n != "self"]
    roster_parts: list[str] = []
    if other_users:
        roster_parts.append("users: " + ", ".join(other_users))
    if other_agents:
        roster_parts.append("other agents: " + ", ".join(other_agents))
    if roster_parts:
        lines.append("Other participants in this conversation — " + "; ".join(roster_parts) + ".")
    else:
        lines.append("You are alone in this conversation with the requester.")

    trigger_desc = _describe_trigger_rule(trigger_rule, in_thread)
    lines.append(f"This turn was triggered by {trigger_user_name} via {trigger_desc}.")
    lines.append(
        "Conversation history below is prefixed with each speaker's name in "
        "square brackets, e.g. `[Alice]: hello`. Address people by the names "
        "shown in the roster; do not invent new ones."
    )

    return "\n".join(lines)


def _describe_surface(channel_type: str) -> str:
    """Short human-readable name for a ChannelType value."""
    mapping = {
        "DIRECT": "a direct message (1:1)",
        "GROUP_DM": "a group direct message",
        "PUBLIC": "a public channel",
        "PRIVATE": "a private channel",
    }
    return mapping.get(channel_type, "a chat channel")


def _describe_trigger_rule(rule: str | None, in_thread: bool) -> str:
    """Short human-readable name for a detector rule token."""
    if in_thread and rule in (None, "thread"):
        return "a reply in a thread you're following"
    mapping = {
        "dm": "a direct message",
        "mention": "an @-mention in a channel message",
        "reply": "a reply to one of your messages",
        "thread": "a reply in a thread you're following",
    }
    return mapping.get(rule or "", "a chat trigger")


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
