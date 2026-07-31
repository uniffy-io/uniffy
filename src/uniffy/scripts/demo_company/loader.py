"""Readers for a demo content directory."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from loguru import logger

from uniffy.core.data_files import load_documents

logger = logger.bind(component="scripts.demo_company.loader")

CONTENT_DIR = Path(__file__).parent / "content"

MIME_BY_SUFFIX: dict[str, str] = {
    ".csv": "text/csv",
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
class Manifest:
    company: str
    root_folder: str
    timezone: str
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
    recurrence_pattern: str
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
    variants: tuple[SeriesVariant, ...]
    variables: dict[str, tuple[str, ...]]


@dataclass(frozen=True)
class ChatContent:
    categories: tuple[str, ...]
    channels: tuple[ChannelSpec, ...]
    direct_messages: tuple[DirectMessageSpec, ...]
    series: tuple[SeriesSpec, ...]


@dataclass(frozen=True)
class DemoContent:
    manifest: Manifest
    notes: tuple[NoteSpec, ...]
    rooms: tuple[RoomSpec, ...]
    events: tuple[EventSpec, ...]
    files: tuple[FileSpec, ...]
    chat: ChatContent


class ContentError(ValueError):
    """A demo content directory is missing something the seeder needs."""


def load_demo_content(directory: Path | None = None) -> DemoContent:
    """Read a content directory into specs; any directory with the same shape works."""
    root = directory or CONTENT_DIR
    if not root.is_dir():
        raise ContentError(f"Content directory not found: {root}")

    manifest = _load_manifest(root / "manifest.json")
    content = DemoContent(
        manifest=manifest,
        notes=_load_notes(root / "notes"),
        rooms=_load_rooms(root / "rooms.json"),
        events=_load_events(root / "events.json"),
        files=_load_files(root / "files", root / "files.json"),
        chat=_load_chat(root / "chat.json", root / "chat_series.json"),
    )
    logger.info(
        f"Loaded {manifest.company} content from {root}: "
        f"{len(content.notes)} notes, {len(content.files)} files, "
        f"{len(content.rooms)} rooms, {len(content.events)} events, "
        f"{len(content.chat.channels)} channels, "
        f"{len(content.chat.direct_messages)} direct conversations, "
        f"{len(content.chat.series)} recurring series"
    )
    return content


def _read_json(path: Path) -> object:
    if not path.is_file():
        raise ContentError(f"Missing content file: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
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
        tags=tags,
        demo_user=demo_user,
    )


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
        pattern = recurrence.get("pattern", "NONE")
        config = None
        if pattern != "NONE":
            # An empty config makes the expander return zero occurrences.
            config = {k: v for k, v in recurrence.items() if k != "pattern"}
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
