"""Readers for a demo content directory."""

from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path

from loguru import logger

from uniffy.core.data_files import load_documents
from uniffy.core.json_codec import JSONDecodeError, loads
from uniffy.core.types import RecurrencePattern

logger = logger.bind(component="scripts.demo_company.loader")

CONTENT_DIR = Path(__file__).parent / "content"
MAX_FILES_PER_SERIES = 500
DEMO_MESSAGE_KEY = "demo_seed_key"

# Every roster entry shares this login unless the content overrides it, which is
# only safe on a stack nobody else can reach. Pass a password to
# load_demo_content when seeding anywhere else.
DEFAULT_PERSON_PASSWORD = "admin"

MIME_BY_SUFFIX: dict[str, str] = {
    ".csv": "text/csv",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
}


@dataclass(frozen=True)
class TagSpec:
    name: str
    color: str | None


@dataclass(frozen=True)
class DemoUser:
    """The persona the demo is browsed as: an ordinary member, no elevated role."""

    email: str
    username: str
    full_name: str
    password: str
    title: str


@dataclass(frozen=True)
class PersonSpec:
    """One member of the company: the login plus their org-scoped profile facts."""

    email: str
    # Empty when the identity is created elsewhere (the demo persona); such an
    # entry only carries profile facts and is skipped when the user is missing.
    username: str
    full_name: str
    password: str
    job_title: str
    department: str
    office_location: str
    start_days_ago: int
    manager: str


@dataclass(frozen=True)
class TeamSpec:
    """A node of the org chart: nests under a parent team and carries a lead."""

    name: str
    description: str
    parent: str
    lead: str
    members: tuple[str, ...]


@dataclass(frozen=True)
class GroupMemberSpec:
    email: str
    role: str


@dataclass(frozen=True)
class GroupSpec:
    name: str
    description: str
    is_private: bool
    members: tuple[GroupMemberSpec, ...]


@dataclass(frozen=True)
class PeopleContent:
    people: tuple[PersonSpec, ...]
    teams: tuple[TeamSpec, ...]
    access_groups: tuple[GroupSpec, ...]


@dataclass(frozen=True)
class Manifest:
    company: str
    root_folder: str
    timezone: str
    history_days: int
    tags: tuple[TagSpec, ...]
    demo_user: DemoUser | None


@dataclass(frozen=True)
class NoteSpec:
    source_name: str
    title: str
    slug: str
    folder_path: tuple[str, ...]
    tags: tuple[str, ...]
    body: str


@dataclass(frozen=True)
class RoomSpec:
    name: str
    description: str
    room_type: str
    capacity: int
    building: str | None
    floor: str | None
    location: str
    amenities: tuple[str, ...]


@dataclass(frozen=True)
class EventSpec:
    title: str
    description: str
    day_offset: int
    start: str
    duration_minutes: int
    is_all_day: bool
    recurrence_pattern: RecurrencePattern
    recurrence_config: dict | None
    room: str | None
    location: str
    tags: tuple[str, ...]
    attendees: tuple[str, ...]


@dataclass(frozen=True)
class FileSpec:
    folder: str
    filename: str
    mime_type: str
    description: str
    tags: tuple[str, ...]
    data: bytes


@dataclass(frozen=True)
class MessageSpec:
    sender: str
    text: str
    minutes_ago: int
    replies: tuple[MessageSpec, ...]
    # Stable per conversation, so re-runs match rows by identity rather than by
    # text. Recurring series repeat short lines like "Seen." on purpose.
    key: str


@dataclass(frozen=True)
class ChannelSpec:
    name: str
    description: str
    channel_type: str
    category: str | None
    members: tuple[str, ...]
    messages: tuple[MessageSpec, ...]


@dataclass(frozen=True)
class DirectMessageSpec:
    participants: tuple[str, ...]
    messages: tuple[MessageSpec, ...]


@dataclass(frozen=True)
class SeriesVariant:
    messages: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class SeriesSpec:
    """A recurring conversation: one variant rendered per occurrence, oldest first."""

    channel: str
    occurrences: int
    start_days_ago: int
    every_days: int
    weekdays_only: bool
    at: str
    gap_minutes: int
    messages_per_occurrence: int | None
    variants: tuple[SeriesVariant, ...]
    variables: dict[str, tuple[str, ...]]


@dataclass(frozen=True)
class ChatContent:
    categories: tuple[str, ...]
    channels: tuple[ChannelSpec, ...]
    direct_messages: tuple[DirectMessageSpec, ...]
    series: tuple[SeriesSpec, ...]


@dataclass(frozen=True)
class AgentSpec:
    provider: str
    env_var: str
    key_label: str
    name: str
    model: str
    emoji: str
    color: str


@dataclass(frozen=True)
class AgentsContent:
    soul_prompt: str
    agents: tuple[AgentSpec, ...]


@dataclass(frozen=True)
class TaskSpec:
    title: str
    description: str
    status: str
    priority: str
    task_type: str
    due_in_days: int | None
    assignees: tuple[str, ...]


@dataclass(frozen=True)
class ProjectSpec:
    name: str
    slug: str
    description: str
    color: str
    icon: str
    tags: tuple[str, ...]
    tasks: tuple[TaskSpec, ...]


@dataclass(frozen=True)
class DemoContent:
    manifest: Manifest
    people: PeopleContent
    notes: tuple[NoteSpec, ...]
    rooms: tuple[RoomSpec, ...]
    events: tuple[EventSpec, ...]
    files: tuple[FileSpec, ...]
    chat: ChatContent
    agents: AgentsContent
    projects: tuple[ProjectSpec, ...]


class ContentError(ValueError):
    """A demo content directory is missing something the seeder needs."""


def load_demo_content(directory: Path | None = None, *, password: str | None = None) -> DemoContent:
    """Read a content directory into specs; any directory with the same shape works."""
    root = directory or CONTENT_DIR
    if not root.is_dir():
        raise ContentError(f"Content directory not found: {root}")

    manifest = _load_manifest(root / "manifest.json")
    people = _load_people(root / "people.json", manifest.demo_user, manifest.history_days)
    if password is not None:
        manifest, people = _override_passwords(manifest, people, password)

    files = _merge_file_specs(
        _load_files(root / "files", root / "files.json"),
        _load_file_series(root / "file_series.json"),
    )
    if root == CONTENT_DIR:
        files = _merge_generated(files)

    content = DemoContent(
        manifest=manifest,
        people=people,
        notes=_load_notes(root / "notes"),
        rooms=_load_rooms(root / "rooms.json"),
        events=_load_events(root / "events.json"),
        files=files,
        chat=_load_chat(root / "chat.json", root / "chat_series.json"),
        agents=_load_agents(root / "agents.json"),
        projects=_load_projects(root / "projects.json"),
    )
    logger.info(
        f"Loaded {manifest.company} content from {root}: "
        f"{len(content.people.people)} people, {len(content.people.teams)} teams, "
        f"{len(content.people.access_groups)} access groups, "
        f"{len(content.notes)} notes, {len(content.files)} files, "
        f"{len(content.rooms)} rooms, {len(content.events)} events, "
        f"{len(content.projects)} projects, {len(content.agents.agents)} agents, "
        f"{len(content.chat.channels)} channels, "
        f"{len(content.chat.direct_messages)} direct conversations, "
        f"{len(content.chat.series)} recurring series"
    )
    return content


def _override_passwords(
    manifest: Manifest,
    people: PeopleContent,
    password: str,
) -> tuple[Manifest, PeopleContent]:
    """Give every seeded login the same caller-chosen password.

    Only newly created users are affected. The seeders hash the password once,
    at insert time, so a persona that already exists keeps the one it has.
    """
    if manifest.demo_user is not None:
        manifest = replace(manifest, demo_user=replace(manifest.demo_user, password=password))
    people = replace(
        people,
        people=tuple(replace(person, password=password) for person in people.people),
    )
    return manifest, people


def _merge_generated(files: tuple[FileSpec, ...]) -> tuple[FileSpec, ...]:
    """Rendered PDFs and images are authored for the bundled company only."""
    # Imported here: generated.py builds FileSpec instances from this module.
    from uniffy.scripts.demo_company.generated import generated_file_specs

    on_disk = {(spec.folder, spec.filename) for spec in files}
    rendered = tuple(
        spec for spec in generated_file_specs() if (spec.folder, spec.filename) not in on_disk
    )
    return files + rendered


def _read_json(path: Path) -> object:
    if not path.is_file():
        raise ContentError(f"Missing content file: {path}")
    try:
        return loads(path.read_bytes())
    except JSONDecodeError as exc:
        raise ContentError(f"{path.name} is not valid JSON: {exc}") from exc


def _load_manifest(path: Path) -> Manifest:
    raw = _read_json(path)
    if not isinstance(raw, dict):
        raise ContentError(f"{path.name} must hold a JSON object")

    for key in ("company", "root_folder", "timezone"):
        if not raw.get(key):
            raise ContentError(f"{path.name} is missing '{key}'")

    tags = tuple(
        TagSpec(name=entry["name"], color=entry.get("color"))
        for entry in raw.get("tags", [])
        if entry.get("name")
    )

    demo_user = None
    persona = raw.get("demo_user")
    if persona:
        for key in ("email", "username", "full_name", "password"):
            if not persona.get(key):
                raise ContentError(f"{path.name}: demo_user is missing '{key}'")
        demo_user = DemoUser(
            email=persona["email"],
            username=persona["username"],
            full_name=persona["full_name"],
            password=persona["password"],
            title=persona.get("title", ""),
        )

    return Manifest(
        company=raw["company"],
        root_folder=raw["root_folder"],
        timezone=raw["timezone"],
        history_days=max(1, int(raw.get("history_days", 730))),
        tags=tags,
        demo_user=demo_user,
    )


def _load_people(
    path: Path,
    demo_user: DemoUser | None,
    history_days: int,
) -> PeopleContent:
    if not path.is_file():
        return PeopleContent(people=(), teams=(), access_groups=())

    raw = _read_json(path)
    if not isinstance(raw, dict):
        raise ContentError(f"{path.name} must hold a JSON object")

    people = _load_roster(path, raw.get("people", []), history_days)
    known = {person.email for person in people}
    if demo_user:
        known.add(demo_user.email)

    for person in people:
        if person.manager and person.manager not in known:
            raise ContentError(f"{path.name}: {person.email} reports to unknown {person.manager}")

    teams = _load_teams(path, raw.get("teams", []), known)
    names = {team.name.lower() for team in teams}

    access_groups: list[GroupSpec] = []
    for entry in raw.get("access_groups", []):
        if not entry.get("name"):
            raise ContentError(f"{path.name}: every access group needs a 'name'")
        # Teams and access groups share one per-org name namespace.
        if entry["name"].lower() in names:
            raise ContentError(f"{path.name}: {entry['name']!r} is already used by a team")
        names.add(entry["name"].lower())

        members = []
        for member in entry.get("members", []):
            if not member.get("email"):
                raise ContentError(f"{path.name}: every group member needs an 'email'")
            if member["email"] not in known:
                raise ContentError(f"{path.name}: {entry['name']!r} lists unknown {member['email']}")
            members.append(GroupMemberSpec(email=member["email"], role=member.get("role", "MEMBER")))
        access_groups.append(
            GroupSpec(
                name=entry["name"],
                description=entry.get("description", ""),
                is_private=bool(entry.get("private", False)),
                members=tuple(members),
            )
        )

    return PeopleContent(
        people=people,
        teams=teams,
        access_groups=tuple(access_groups),
    )


def _load_roster(
    path: Path,
    entries: list[dict],
    history_days: int,
) -> tuple[PersonSpec, ...]:
    people: list[PersonSpec] = []
    seen: set[str] = set()
    for entry in entries:
        email = entry.get("email")
        if not email:
            raise ContentError(f"{path.name}: every person needs an 'email'")
        if email in seen:
            raise ContentError(f"{path.name}: duplicate person {email}")
        seen.add(email)

        username = entry.get("username", "")
        if username and not entry.get("full_name"):
            raise ContentError(f"{path.name}: {email} needs a 'full_name' next to its username")
        for key in ("job_title", "department"):
            if not entry.get(key):
                raise ContentError(f"{path.name}: {email} needs '{key}'")

        start_days_ago = int(entry.get("start_days_ago", 1))
        if not 1 <= start_days_ago <= history_days:
            raise ContentError(
                f"{path.name}: {email} start_days_ago must be within 1..{history_days}"
            )
        people.append(
            PersonSpec(
                email=email,
                username=username,
                full_name=entry.get("full_name", ""),
                password=entry.get("password", DEFAULT_PERSON_PASSWORD),
                job_title=entry["job_title"],
                department=entry["department"],
                office_location=entry.get("office_location", ""),
                start_days_ago=start_days_ago,
                manager=entry.get("manager", ""),
            )
        )
    return tuple(people)


def _load_teams(path: Path, entries: list[dict], known: set[str]) -> tuple[TeamSpec, ...]:
    """Declaration order is seeding order: a parent has to come before its children."""
    teams: list[TeamSpec] = []
    declared: set[str] = set()
    for entry in entries:
        name = entry.get("name")
        if not name:
            raise ContentError(f"{path.name}: every team needs a 'name'")
        if name.lower() in {team.name.lower() for team in teams}:
            raise ContentError(f"{path.name}: duplicate team {name!r}")

        parent = entry.get("parent", "")
        if parent and parent not in declared:
            raise ContentError(f"{path.name}: team {name!r} nests under undeclared {parent!r}")

        members = tuple(entry.get("members", []))
        for email in members:
            if email not in known:
                raise ContentError(f"{path.name}: team {name!r} lists unknown {email}")

        lead = entry.get("lead", "")
        if lead and lead not in members:
            raise ContentError(f"{path.name}: the lead of {name!r} must be one of its members")

        declared.add(name)
        teams.append(
            TeamSpec(
                name=name,
                description=entry.get("description", ""),
                parent=parent,
                lead=lead,
                members=members,
            )
        )
    return tuple(teams)


def _load_notes(directory: Path) -> tuple[NoteSpec, ...]:
    documents = load_documents(directory)
    if not documents:
        raise ContentError(f"No markdown notes found in {directory}")

    notes: list[NoteSpec] = []
    seen_slugs: set[str] = set()
    for doc in documents:
        for key in ("title", "slug", "folder"):
            if key not in doc.meta:
                raise ContentError(f"{doc.path.name}: frontmatter is missing '{key}'")

        slug = doc.scalar("slug")
        if slug in seen_slugs:
            raise ContentError(f"{doc.path.name}: duplicate slug '{slug}'")
        seen_slugs.add(slug)

        folder = doc.scalar("folder").strip("/")
        notes.append(
            NoteSpec(
                source_name=doc.path.name,
                title=doc.scalar("title"),
                slug=slug,
                folder_path=tuple(part for part in folder.split("/") if part),
                tags=tuple(doc.items("tags")),
                body=doc.body,
            )
        )
    return tuple(notes)


def _load_rooms(path: Path) -> tuple[RoomSpec, ...]:
    raw = _read_json(path)
    if not isinstance(raw, list):
        raise ContentError(f"{path.name} must hold a JSON array")

    rooms: list[RoomSpec] = []
    for entry in raw:
        if not entry.get("name"):
            raise ContentError(f"{path.name}: every room needs a 'name'")
        rooms.append(
            RoomSpec(
                name=entry["name"],
                description=entry.get("description", ""),
                room_type=entry.get("room_type", "MEETING_ROOM"),
                capacity=int(entry.get("capacity", 0)),
                building=entry.get("building"),
                floor=entry.get("floor"),
                location=entry.get("location", ""),
                amenities=tuple(entry.get("amenities", [])),
            )
        )
    return tuple(rooms)


def _load_events(path: Path) -> tuple[EventSpec, ...]:
    raw = _read_json(path)
    if not isinstance(raw, list):
        raise ContentError(f"{path.name} must hold a JSON array")

    events: list[EventSpec] = []
    for entry in raw:
        for key in ("title", "start"):
            if not entry.get(key):
                raise ContentError(f"{path.name}: every event needs '{key}'")

        recurrence = entry.get("recurrence") or {}
        try:
            pattern = RecurrencePattern(recurrence.get("pattern", RecurrencePattern.NONE))
        except ValueError as exc:
            raise ContentError(f"{path.name}: invalid recurrence pattern") from exc
        config = None
        if pattern != RecurrencePattern.NONE:
            # An empty config makes the expander return zero occurrences.
            config = {k: v for k, v in recurrence.items() if k != "pattern"}  # noqa: PLR2004
            config.setdefault("interval", 1)

        events.append(
            EventSpec(
                title=entry["title"],
                description=entry.get("description", ""),
                day_offset=int(entry.get("day_offset", 0)),
                start=entry["start"],
                duration_minutes=int(entry.get("duration_minutes", 30)),
                is_all_day=bool(entry.get("all_day", False)),
                recurrence_pattern=pattern,
                recurrence_config=config,
                room=entry.get("room"),
                location=entry.get("location", ""),
                tags=tuple(entry.get("tags", [])),
                attendees=tuple(entry.get("attendees", [])),
            )
        )
    return tuple(events)


def _load_chat(path: Path, series_path: Path) -> ChatContent:
    series = _load_series(series_path)
    if not path.is_file():
        return ChatContent(categories=(), channels=(), direct_messages=(), series=series)

    raw = _read_json(path)
    if not isinstance(raw, dict):
        raise ContentError(f"{path.name} must hold a JSON object")

    categories: list[str] = []
    channels: list[ChannelSpec] = []
    for entry in raw.get("categories", []):
        if not entry.get("name"):
            raise ContentError(f"{path.name}: every category needs a 'name'")
        categories.append(entry["name"])
        for channel in entry.get("channels", []):
            channels.append(_channel_spec(path, channel, category=entry["name"]))

    for channel in raw.get("channels", []):
        channels.append(_channel_spec(path, channel, category=None))

    direct: list[DirectMessageSpec] = []
    for entry in raw.get("direct_messages", []):
        participants = tuple(entry.get("participants", []))
        if len(participants) < 2:
            raise ContentError(f"{path.name}: a direct conversation needs 2+ participants")
        direct.append(
            DirectMessageSpec(
                participants=participants,
                messages=_message_specs(path, entry.get("messages", [])),
            )
        )

    return ChatContent(
        categories=tuple(categories),
        channels=tuple(channels),
        direct_messages=tuple(direct),
        series=series,
    )


def _load_series(path: Path) -> tuple[SeriesSpec, ...]:
    if not path.is_file():
        return ()

    raw = _read_json(path)
    if not isinstance(raw, list):
        raise ContentError(f"{path.name} must hold a JSON array")

    series: list[SeriesSpec] = []
    for entry in raw:
        if not entry.get("channel"):
            raise ContentError(f"{path.name}: every series needs a 'channel'")
        variants = tuple(
            SeriesVariant(
                messages=tuple(
                    (message["from"], message["text"]) for message in variant.get("messages", [])
                )
            )
            for variant in entry.get("variants", [])
        )
        if not variants:
            raise ContentError(f"{path.name}: series for #{entry['channel']} has no variants")

        series.append(
            SeriesSpec(
                channel=entry["channel"],
                occurrences=int(entry.get("occurrences", len(variants))),
                start_days_ago=int(entry.get("start_days_ago", 30)),
                every_days=max(1, int(entry.get("every_days", 1))),
                weekdays_only=bool(entry.get("weekdays_only", True)),
                at=entry.get("at", "09:00"),
                gap_minutes=int(entry.get("gap_minutes", 4)),
                messages_per_occurrence=(
                    max(1, int(entry["messages_per_occurrence"]))
                    if entry.get("messages_per_occurrence") is not None
                    else None
                ),
                variants=variants,
                variables={
                    name: tuple(values)
                    for name, values in entry.get("variables", {}).items()
                    if values
                },
            )
        )
    return tuple(series)


def _channel_spec(path: Path, entry: dict, *, category: str | None) -> ChannelSpec:
    if not entry.get("name"):
        raise ContentError(f"{path.name}: every channel needs a 'name'")
    return ChannelSpec(
        name=entry["name"],
        description=entry.get("description", ""),
        channel_type=entry.get("type", "PUBLIC"),
        category=category,
        members=tuple(entry.get("members", [])),
        messages=_message_specs(path, entry.get("messages", [])),
    )


def _message_specs(
    path: Path,
    entries: list[dict],
    prefix: str = "written",
) -> tuple[MessageSpec, ...]:
    messages: list[MessageSpec] = []
    for index, entry in enumerate(entries):
        for key in ("from", "text"):
            if not entry.get(key):
                raise ContentError(f"{path.name}: every message needs '{key}'")
        position = f"{prefix}:{index}"
        messages.append(
            MessageSpec(
                sender=entry["from"],
                text=entry["text"],
                minutes_ago=int(entry.get("minutes_ago", 0)),
                replies=_message_specs(path, entry.get("replies", []), prefix=position),
                key=position,
            )
        )
    return tuple(messages)


def _load_agents(path: Path) -> AgentsContent:
    """Agent NAMES and models are content; the credentials come from env vars."""
    if not path.is_file():
        return AgentsContent(soul_prompt="", agents=())

    raw = _read_json(path)
    if not isinstance(raw, dict):
        raise ContentError(f"{path.name} must hold a JSON object")

    soul_prompt = raw.get("soul_prompt", "")
    agents: list[AgentSpec] = []
    for entry in raw.get("agents", []):
        for key in ("provider", "env_var", "key_label", "name", "model"):
            if not entry.get(key):
                raise ContentError(f"{path.name}: every agent needs '{key}'")
        agents.append(
            AgentSpec(
                provider=entry["provider"],
                env_var=entry["env_var"],
                key_label=entry["key_label"],
                name=entry["name"],
                model=entry["model"],
                emoji=entry.get("emoji", ""),
                color=entry.get("color", ""),
            )
        )
    return AgentsContent(soul_prompt=soul_prompt, agents=tuple(agents))


def _load_projects(path: Path) -> tuple[ProjectSpec, ...]:
    if not path.is_file():
        return ()

    raw = _read_json(path)
    if not isinstance(raw, list):
        raise ContentError(f"{path.name} must hold a JSON array")

    projects: list[ProjectSpec] = []
    for entry in raw:
        for key in ("name", "slug"):
            if not entry.get(key):
                raise ContentError(f"{path.name}: every project needs '{key}'")

        tasks: list[TaskSpec] = []
        for task in entry.get("tasks", []):
            if not task.get("title"):
                raise ContentError(f"{path.name}: every task needs a 'title'")
            tasks.append(
                TaskSpec(
                    title=task["title"],
                    description=task.get("description", ""),
                    status=task.get("status", "status_todo"),
                    priority=task.get("priority", "priority_medium"),
                    task_type=task.get("type", "task"),
                    due_in_days=task.get("due_in_days"),
                    assignees=tuple(task.get("assignees", [])),
                )
            )

        projects.append(
            ProjectSpec(
                name=entry["name"],
                slug=entry["slug"],
                description=entry.get("description", ""),
                color=entry.get("color", "#0d9488"),
                icon=entry.get("icon", "folder"),
                tags=tuple(entry.get("tags", [])),
                tasks=tuple(tasks),
            )
        )
    return tuple(projects)


def _load_files(directory: Path, metadata_path: Path) -> tuple[FileSpec, ...]:
    if not directory.is_dir():
        return ()

    metadata: dict[str, dict] = {}
    if metadata_path.is_file():
        raw = _read_json(metadata_path)
        if not isinstance(raw, dict):
            raise ContentError(f"{metadata_path.name} must hold a JSON object")
        metadata = raw

    files: list[FileSpec] = []
    for path in sorted(directory.rglob("*")):
        if not path.is_file():
            continue

        relative = path.relative_to(directory)
        if len(relative.parts) != 2:
            raise ContentError(
                f"{relative}: files live exactly one folder deep "
                f"(the folder name becomes the workspace folder)"
            )

        mime_type = MIME_BY_SUFFIX.get(path.suffix.lower())
        if mime_type is None:
            raise ContentError(f"{relative}: unknown extension, add it to MIME_BY_SUFFIX")

        entry = metadata.get(relative.as_posix(), {})
        files.append(
            FileSpec(
                folder=relative.parts[0],
                filename=path.name,
                mime_type=mime_type,
                description=entry.get("description", ""),
                tags=tuple(entry.get("tags", [])),
                data=path.read_bytes(),
            )
        )
    return tuple(files)


def _load_file_series(path: Path) -> tuple[FileSpec, ...]:
    if not path.is_file():
        return ()

    raw = _read_json(path)
    if not isinstance(raw, list):
        raise ContentError(f"{path.name} must hold a JSON array")

    files: list[FileSpec] = []
    for entry in raw:
        for key in ("folder", "filename", "content"):
            if not entry.get(key):
                raise ContentError(f"{path.name}: every file series needs '{key}'")

        count = int(entry.get("count", 0))
        if count < 1 or count > MAX_FILES_PER_SERIES:
            raise ContentError(
                f"{path.name}: file series count must be between 1 and {MAX_FILES_PER_SERIES}"
            )

        variables = entry.get("variables", {})
        if not isinstance(variables, dict) or any(
            not isinstance(values, list) or not values for values in variables.values()
        ):
            raise ContentError(f"{path.name}: file series variables need non-empty arrays")

        for offset in range(count):
            index = offset + 1
            values = {
                "index": str(index),
                "sequence": f"{index:03d}",
            }
            for stride, name in enumerate(sorted(variables), start=1):
                pool = variables[name]
                values[name] = str(pool[(offset * stride) % len(pool)])

            filename = _render_file_template(entry["filename"], values)
            suffix = Path(filename).suffix.lower()
            mime_type = MIME_BY_SUFFIX.get(suffix)
            if mime_type is None:
                raise ContentError(
                    f"{path.name}: unknown extension in {filename!r}, add it to MIME_BY_SUFFIX"
                )

            files.append(
                FileSpec(
                    folder=entry["folder"],
                    filename=filename,
                    mime_type=mime_type,
                    description=_render_file_template(entry.get("description", ""), values),
                    tags=tuple(entry.get("tags", [])),
                    data=_render_file_template(entry["content"], values).encode(),
                )
            )
    return tuple(files)


def _render_file_template(template: str, values: dict[str, str]) -> str:
    for name, value in values.items():
        template = template.replace("{" + name + "}", value)
    return template


def _merge_file_specs(
    existing: tuple[FileSpec, ...],
    generated: tuple[FileSpec, ...],
) -> tuple[FileSpec, ...]:
    merged = list(existing)
    identities = {(spec.folder, spec.filename) for spec in existing}
    for spec in generated:
        identity = (spec.folder, spec.filename)
        if identity in identities:
            raise ContentError(
                f"Duplicate demo file {spec.folder}/{spec.filename} across file sources"
            )
        identities.add(identity)
        merged.append(spec)
    return tuple(merged)
