"""Deferred tool advertisement.

Big tool sets are not advertised whole: core groups ship up front and the rest
render as a names-only index the model expands with ``tools.load_group``. The
advertised list is append-only and stably ordered (core block, then loaded
groups in load order) so a load invalidates the provider prompt cache once,
not on every turn.
"""

from dataclasses import dataclass

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from uniffy.domains.agents.tools.definitions import ToolContext
from uniffy.domains.agents.tools.registry import ToolRegistry, from_api_name

LOAD_GROUP_TOOL = "tools.load_group"
LOADED_GROUPS_METADATA_KEY = "loaded_tool_groups"

# Groups every agent needs from the first token: memory and skills are
# referenced by other prompt sections, search/people back the mention
# workflow, and System carries the time tool the date section defers to.
CORE_GROUPS = frozenset({"Memory", "Search", "People", "System"})

# At or below this many advertisable schemas deferral is pure overhead:
# advertise everything and skip the meta tool.
DEFERRAL_THRESHOLD = 16


@dataclass(frozen=True)
class AdvertisementPlan:
    """What the model sees now (``tool_schemas``) vs. what it can load."""

    tool_schemas: list[dict]
    deferred: dict[str, list[dict]]

    def deferred_names(self) -> dict[str, list[str]]:
        """Group label -> internal tool names, for the prompt index and ToolContext."""
        return {
            group: [from_api_name(s.get("name", "")) for s in schemas]
            for group, schemas in self.deferred.items()
        }


def plan_tool_advertisement(
    registry: ToolRegistry,
    schemas: list[dict] | None,
    loaded_groups: list[str] | None,
) -> AdvertisementPlan:
    """Partition fully-resolved schemas into an advertised block and a deferred pool.

    ``schemas`` must already be the final advertisable set (image schema
    swapped, integration gate applied): the plan only splits it, so a loaded
    group re-advertises exactly what a small agent would have seen up front.
    """
    schemas = schemas or []
    if len(schemas) <= DEFERRAL_THRESHOLD:
        return AdvertisementPlan(tool_schemas=list(schemas), deferred={})

    core: list[dict] = []
    by_group: dict[str, list[dict]] = {}
    for schema in schemas:
        tool = registry.get(from_api_name(schema.get("name", "")))
        if tool is None or tool.internal:
            core.append(schema)
            continue
        group = tool.group or tool.name.split(".", 1)[0].capitalize()
        if group in CORE_GROUPS:
            core.append(schema)
            continue
        by_group.setdefault(group, []).append(schema)

    if not by_group:
        return AdvertisementPlan(tool_schemas=core, deferred={})

    labels = {group.casefold(): group for group in by_group}
    loaded_ordered: list[str] = []
    for requested in loaded_groups or []:
        label = labels.get(str(requested).casefold())
        if label is not None and label not in loaded_ordered:
            loaded_ordered.append(label)

    advertised = [*core, *registry.get_anthropic_schemas([LOAD_GROUP_TOOL])]
    for group in loaded_ordered:
        advertised.extend(by_group.pop(group))
    return AdvertisementPlan(tool_schemas=advertised, deferred=by_group)


async def persist_loaded_group(ctx: ToolContext, group: str) -> None:
    """Record a loaded group on the run's destination so later turns start with it.

    Chat destinations upsert the (channel, agent) binding: an agent can be
    talking in a channel that never had one.
    """
    groups = [*ctx.loaded_tool_groups, group]
    if ctx.session_id is not None:
        from uniffy.core.models.agents.session import AgentSession

        await ctx.session.execute(
            update(AgentSession)
            .where(AgentSession.id == ctx.session_id)
            .values(loaded_tool_groups=groups)
        )
        return
    if ctx.channel_id is not None and ctx.agent_id is not None:
        from uniffy.core.models.agents.channel_binding import AgentChannelBinding
        from uniffy.core.types import generate_id

        stmt = pg_insert(AgentChannelBinding).values(
            id=generate_id(),
            channel_id=ctx.channel_id,
            agent_id=ctx.agent_id,
            created_by_user_id=ctx.user_id,
            loaded_tool_groups=groups,
        )
        await ctx.session.execute(
            stmt.on_conflict_do_update(
                index_elements=["channel_id", "agent_id"],
                set_={"loaded_tool_groups": groups},
            )
        )
