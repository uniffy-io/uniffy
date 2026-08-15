"""Built-in People directory tools for agents."""

from uuid import UUID

from uniffy.core.content.references import sanitize_mention_label
from uniffy.core.errors import NotFoundError
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.domains.agents.tools.builtin.args import clamp_int, parse_uuid
from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult

MAX_PEOPLE_RESULTS = 25
MAX_QUERY_LENGTH = 256
MAX_FILTER_LENGTH = 255


def _text_arg(
    args: dict,
    name: str,
    *,
    max_length: int,
) -> tuple[str | None, str | None]:
    raw = args.get(name)
    if raw is None or raw == "":
        return None, None
    if not isinstance(raw, str):
        return None, f"{name} must be a string"
    value = raw.strip()
    if len(value) > max_length:
        return None, f"{name} must be at most {max_length} characters"
    return value or None, None


def _uuid_arg(args: dict, name: str) -> tuple[UUID | None, str | None]:
    raw = args.get(name)
    if raw is None or raw == "":
        return None, None
    return parse_uuid(str(raw), name)


def _person_mention(person: dict) -> str:
    urn = f"urn:uniffy:content:USER:{person['user_id']}"
    return f"[[[{sanitize_mention_label(person['display_name'])}|{urn}]]]"


def _team_mention(team: dict) -> str:
    urn = f"urn:uniffy:content:TEAM:{team['group_id']}"
    return f"[[[{sanitize_mention_label(team['name'])}|{urn}]]]"


def _person_summary(person: dict) -> str:
    facts: list[str] = []
    if person.get("job_title"):
        facts.append(person["job_title"])
    if person.get("department"):
        facts.append(f"department={person['department']}")
    facts.append(f"org_role={person['org_role']}")
    if person.get("teams"):
        facts.append("teams=" + ", ".join(team["name"] for team in person["teams"]))
    if person.get("manager_user_id"):
        facts.append(f"manager_user_id={person['manager_user_id']}")
    if person.get("direct_report_count"):
        facts.append(f"direct_reports={person['direct_report_count']}")
    if person.get("email"):
        facts.append(f"email={person['email']}")
    return f"- {_person_mention(person)} — " + "; ".join(facts)


async def _execute_list_members(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.people.reader import PeopleReader

    query, error = _text_arg(args, "query", max_length=MAX_QUERY_LENGTH)
    if error:
        return ToolResult(success=False, data="", error=error)
    job_title, error = _text_arg(args, "job_title", max_length=MAX_FILTER_LENGTH)
    if error:
        return ToolResult(success=False, data="", error=error)
    department, error = _text_arg(args, "department", max_length=MAX_FILTER_LENGTH)
    if error:
        return ToolResult(success=False, data="", error=error)

    team_id, error = _uuid_arg(args, "team_id")
    if error:
        return ToolResult(success=False, data="", error=error)
    manager_user_id, error = _uuid_arg(args, "manager_user_id")
    if error:
        return ToolResult(success=False, data="", error=error)

    role_filter = None
    raw_role = args.get("organization_role")
    if raw_role:
        try:
            role_filter = OrganizationRole(str(raw_role).upper())
        except ValueError:
            return ToolResult(
                success=False,
                data="",
                error="organization_role must be OWNER, ADMIN, or MEMBER",
            )

    limit = clamp_int(args.get("limit"), 10, 1, MAX_PEOPLE_RESULTS)
    page = await PeopleReader(ctx.session).list_people(
        actor_user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        page_size=limit,
        search=query,
        job_title=job_title,
        department=department,
        role_filter=role_filter,
        team_id=team_id,
        manager_user_id=manager_user_id,
    )
    if not page.people:
        return ToolResult(success=True, data="No active organization members matched.")

    lines = [f"Found {page.total} people (showing {len(page.people)}):"]
    lines.extend(_person_summary(person) for person in page.people)
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_get_person(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.people.reader import PeopleReader

    user_id, error = _uuid_arg(args, "user_id")
    if error:
        return ToolResult(success=False, data="", error=error)
    if user_id is None:
        return ToolResult(success=False, data="", error="user_id is required")

    reader = PeopleReader(ctx.session)
    person, _ = await reader.get_person(
        actor_user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        target_user_id=user_id,
    )
    lines = [f"Person: {_person_mention(person)}"]
    fields = (
        ("Job title", "job_title"),
        ("Department", "department"),
        ("Organization role", "org_role"),
        ("Email", "email"),
        ("Work phone", "work_phone"),
        ("Office", "office_location"),
        ("Timezone", "timezone"),
        ("Pronouns", "pronouns"),
    )
    for label, key in fields:
        if person.get(key):
            lines.append(f"{label}: {person[key]}")

    manager_id = person.get("manager_user_id")
    if manager_id:
        parsed_manager_id, _ = parse_uuid(manager_id, "manager_user_id")
        try:
            if parsed_manager_id is None:
                raise NotFoundError("Person", manager_id)
            manager, _ = await reader.get_person(
                actor_user_id=ctx.user_id,
                organization_id=ctx.organization_id,
                target_user_id=parsed_manager_id,
            )
        except NotFoundError:
            lines.append(f"Manager user id: {manager_id}")
        else:
            lines.append(f"Manager: {_person_mention(manager)}")

    if person.get("teams"):
        lines.append("Teams: " + ", ".join(_team_mention(team) for team in person["teams"]))
    lines.append(f"Direct reports: {person.get('direct_report_count', 0)}")
    if person.get("bio"):
        lines.append(f"Bio: {person['bio'][:1000]}")
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_list_teams(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.organizations.operations import OrganizationOperations
    from uniffy.domains.people.teams import search_team_nodes

    query, error = _text_arg(args, "query", max_length=MAX_QUERY_LENGTH)
    if error:
        return ToolResult(success=False, data="", error=error)
    limit = clamp_int(args.get("limit"), 10, 1, MAX_PEOPLE_RESULTS)

    await OrganizationOperations(ctx.session).require_org_member(ctx.user_id, ctx.organization_id)
    teams, total = await search_team_nodes(
        ctx.session,
        ctx.organization_id,
        search=query,
        limit=limit,
    )
    if not teams:
        return ToolResult(success=True, data="No organization teams matched.")

    lines = [f"Found {total} teams (showing {len(teams)}):"]
    for team in teams:
        facts: list[str] = []
        if team.get("lead_user_id"):
            facts.append(f"lead_user_id={team['lead_user_id']}")
        if team.get("parent_group_id"):
            facts.append(f"parent_team_id={team['parent_group_id']}")
        if team.get("description"):
            facts.append(team["description"][:200])
        suffix = f" — {'; '.join(facts)}" if facts else ""
        lines.append(f"- {_team_mention(team)}{suffix}")
    return ToolResult(success=True, data="\n".join(lines))


list_members = ToolDefinition(
    name="people.list_members",
    display_name="Find People",
    group="People",
    description=(
        "Find active organization members by name, email, job title, department, "
        "organization role, team, or manager. Filters may be combined."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Name, username, email, job title, or department text.",
                "maxLength": MAX_QUERY_LENGTH,
            },
            "job_title": {
                "type": "string",
                "description": "Job title or position text to match.",
                "maxLength": MAX_FILTER_LENGTH,
            },
            "department": {
                "type": "string",
                "description": "Exact department name.",
                "maxLength": MAX_FILTER_LENGTH,
            },
            "organization_role": {
                "type": "string",
                "enum": ["OWNER", "ADMIN", "MEMBER"],
                "description": "Exact organization membership role.",
            },
            "team_id": {
                "type": "string",
                "description": "Team UUID from people.list_teams or a TEAM mention.",
            },
            "manager_user_id": {
                "type": "string",
                "description": "Return direct reports of this manager UUID.",
            },
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": MAX_PEOPLE_RESULTS,
                "description": "Maximum results; defaults to 10.",
            },
        },
    },
    executor=_execute_list_members,
    read_only=True,
    timeout_seconds=30,
)

get_person = ToolDefinition(
    name="people.get_person",
    display_name="Get Person",
    group="People",
    description=(
        "Read an active organization member's work profile, reporting line, and teams. "
        "Resolve the user UUID with people.list_members first."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "user_id": {
                "type": "string",
                "description": "Organization member UUID.",
            }
        },
        "required": ["user_id"],
    },
    executor=_execute_get_person,
    read_only=True,
)

list_teams = ToolDefinition(
    name="people.list_teams",
    display_name="Find Teams",
    group="People",
    description="Find organization teams and their lead and parent-team identifiers.",
    parameter_schema={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Optional team name or description text.",
                "maxLength": MAX_QUERY_LENGTH,
            },
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": MAX_PEOPLE_RESULTS,
                "description": "Maximum results; defaults to 10.",
            },
        },
    },
    executor=_execute_list_teams,
    read_only=True,
)

PEOPLE_TOOLS: list[ToolDefinition] = [list_members, get_person, list_teams]
