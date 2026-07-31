"""Development-only seeding data."""

import os

from loguru import logger

from uniffy.core.types import RoomType


async def seed_development_data(
    session,
    default_org,
    admin_user,
    admin_password: str,
    search_indexer,
) -> None:
    """Seed test users and groups, plus provider keys, agents and rooms when
    starter content is on.
    """
    from uniffy.core.models import Group, OrganizationMember, OrganizationRole, User
    from uniffy.core.models.login.group_member import GroupMember, GroupRole
    from uniffy.core.search.indexer import build_content_urn
    from uniffy.core.types import AccessMode, ContentRole, ContentType
    from uniffy.domains.auth.passwords import hash_password

    logger.info("Creating 5 test users...")

    test_users = []
    user_data = [
        ("alice@uniffy.io", "alice", "Alice Johnson"),
        ("bob@uniffy.io", "bob", "Bob Smith"),
        ("charlie@uniffy.io", "charlie", "Charlie Brown"),
        ("diana@uniffy.io", "diana", "Diana Prince"),
        ("eve@uniffy.io", "eve", "Eve Martinez"),
    ]

    for email, username, full_name in user_data:
        user = User(
            email=email,
            username=username,
            full_name=full_name,
            hashed_password=hash_password(admin_password),
            is_active=True,
            is_system_admin=False,
            email_verified=True,
        )
        session.add(user)
        test_users.append(user)

    await session.flush()
    for user in test_users:
        await session.refresh(user)

    logger.info("Created 5 test users")

    for user in test_users:
        member = OrganizationMember(
            user_id=user.id,
            organization_id=default_org.id,
            role=OrganizationRole.MEMBER,
            is_active=True,
        )
        session.add(member)

    await session.flush()
    logger.info("Added test users to organization")

    from uniffy.domains.chat.channels.operations import ChatChannelOperations

    chat_ops = ChatChannelOperations(session)
    for user in test_users:
        await chat_ops.join_default_channels(user.id, default_org.id)
    await session.flush()
    logger.info("Joined test users to default chat channels")

    logger.info("Creating 2 test groups...")

    group_engineering = Group(
        organization_id=default_org.id,
        name="Engineering",
        slug="engineering",
        description="Engineering team group",
        is_private=False,
        is_default=False,
        created_by_user_id=admin_user.id,
    )
    session.add(group_engineering)

    group_product = Group(
        organization_id=default_org.id,
        name="Product",
        slug="product",
        description="Product team group",
        is_private=False,
        is_default=False,
        created_by_user_id=admin_user.id,
    )
    session.add(group_product)

    await session.flush()
    await session.refresh(group_engineering)
    await session.refresh(group_product)
    logger.info("Created Engineering and Product groups")

    logger.info("Adding users to groups...")

    # charlie is intentionally a member of both groups to exercise multi-group permission resolution.
    for user, role in [
        (test_users[0], GroupRole.MEMBER),
        (test_users[1], GroupRole.ADMIN),
        (test_users[2], GroupRole.MEMBER),
    ]:
        member = GroupMember(
            user_id=user.id,
            group_id=group_engineering.id,
            role=role,
            is_active=True,
        )
        session.add(member)

    for user, role in [
        (test_users[2], GroupRole.MEMBER),
        (test_users[3], GroupRole.ADMIN),
        (test_users[4], GroupRole.MEMBER),
    ]:
        member = GroupMember(
            user_id=user.id,
            group_id=group_product.id,
            role=role,
            is_active=True,
        )
        session.add(member)

    await session.flush()
    logger.info("Added users to groups (charlie is in both groups)")

    for user in test_users:
        await search_indexer.index(
            urn=build_content_urn(ContentType.USER, user.id),
            organization_id=default_org.id,
            title=user.full_name,
            entity_type=ContentType.USER.value,
            url_path=f"/admin/users/{user.id}",
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
            owner_id=user.id,
            keywords=f"{user.full_name} {user.username} {user.email}",
            description=user.email,
        )

    logger.info("Indexed test users for search")

    from uniffy.db.seed import starter_content_enabled

    if not starter_content_enabled():
        logger.info(
            "SEED_STARTER_CONTENT off: skipping provider keys, dev agents and rooms"
        )
        return

    provider_keys = await _seed_provider_keys(session, default_org, admin_user)

    await _seed_dev_agents(session, default_org, admin_user, provider_keys)

    await _seed_dev_rooms(session, default_org, admin_user)


async def _seed_provider_keys(session, default_org, admin_user) -> list:
    """Seed LLM provider keys for the default org from `*_API_KEY` env vars."""
    from uniffy.core.crypto import OrgCipher
    from uniffy.core.models.agents.provider_key import ProviderKey
    from uniffy.core.types import AccessMode, ContentRole
    from uniffy.domains.agents.providers.utils import build_key_hint

    org_cipher = OrgCipher(session)

    provider_key_configs = [
        {
            "env_var": "CLAUDE_API_KEY",
            "provider": "anthropic",
            "label": "anthropic-dev",
        },
        {
            "env_var": "OPENAI_API_KEY",
            "provider": "openai",
            "label": "openai-gt-prod",
        },
        {
            "env_var": "GOOGLE_GENAI_API_KEY",
            "provider": "google",
            "label": "google-g-prod",
        },
        {
            "env_var": "OPENROUTER_API_KEY",
            "provider": "openrouter",
            "label": "Dev OpenRouter Key",
        },
        {
            "env_var": "XAI_API_KEY",
            "provider": "xai",
            "label": "Dev xAI Key",
        },
    ]

    seeded_keys: list[tuple[str, ProviderKey]] = []
    for config in provider_key_configs:
        credential = os.getenv(config["env_var"])
        if not credential:
            logger.warning(f"{config['env_var']} not set, skipping {config['label']} provider key")
            continue

        credential = credential.strip()
        encrypted = await org_cipher.encrypt(default_org.id, credential)
        key = ProviderKey(
            organization_id=default_org.id,
            provider=config["provider"],
            label=config["label"],
            encrypted_credential=encrypted,
            key_hint=build_key_hint(credential),
            is_valid=True,
            is_enabled=True,
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
            created_by=admin_user.id,
        )
        session.add(key)
        seeded_keys.append((config["provider"], key))
        logger.info(f"Seeded provider key: {config['label']} ({config['provider']})")

    if seeded_keys:
        await session.flush()
        for _, key in seeded_keys:
            await session.refresh(key)
    logger.info(f"Seeded {len(seeded_keys)} LLM provider keys")

    return seeded_keys


ALL_TOOL_NAMES: list[str] = [
    "notes.search_notes",
    "notes.list_notes",
    "notes.read_note",
    "notes.create_note",
    "notes.update_note",
    "notes.delete_note",
    "files.search_files",
    "files.list_files",
    "files.get_file_info",
    "files.read_file_content",
    "files.update_file",
    "files.delete_file",
    "calendar.list_events",
    "calendar.create_event",
    "calendar.update_event",
    "calendar.delete_event",
    "projects.list_projects",
    "projects.create_project",
    "projects.update_project",
    "projects.delete_project",
    "tasks.list_tasks",
    "tasks.create_task",
    "tasks.update_task",
    "tasks.delete_task",
    "tasks.move_task",
    "search.query",
    "people.list_members",
    "memory.save",
    "memory.read",
    "memory.forget",
    "images.generate_image",
    "cron.create",
    "cron.list",
    "cron.update",
    "cron.delete",
    "cron.get_runs",
    "system.current_time",
]

PROVIDER_AGENT_CONFIGS: dict[str, dict[str, str]] = {
    "anthropic": {
        "name": "Uniffy Anthropic",
        "primary_model": "claude-sonnet-4-6",
        "avatar_emoji": "A",
        "theme_color": "#d97706",
    },
    "openai": {
        "name": "Uniffy OpenAI",
        "primary_model": "gpt-4o",
        "avatar_emoji": "O",
        "theme_color": "#10a37f",
    },
    "google": {
        "name": "Uniffy Google",
        # Gemini 2.5+ required for implicit prompt caching; 2.0-flash always
        # reports cached_content_token_count=0.
        "primary_model": "gemini-2.5-flash",
        "avatar_emoji": "G",
        "theme_color": "#4285f4",
    },
    "openrouter": {
        "name": "Uniffy OpenRouter",
        "primary_model": "anthropic/claude-sonnet-5",
        "avatar_emoji": "R",
        "theme_color": "#6467f2",
    },
    "xai": {
        "name": "Uniffy xAI",
        "primary_model": "grok-4.5",
        "avatar_emoji": "X",
        "theme_color": "#71717a",
    },
}


MOCK_ROOMS: list[dict] = [
    {
        "name": "Phone Booth A",
        "description": "Solo phone booth for quick 1:1s and focused calls.",
        "room_type": RoomType.OFFICE,
        "capacity": 1,
        "building": "HQ",
        "floor": "1",
        "location": "HQ, Floor 1, near reception",
        "amenities": ["phone", "soundproof"],
    },
    {
        "name": "Phone Booth B",
        "description": "Second solo booth - sound-dampened with a small desk.",
        "room_type": RoomType.OFFICE,
        "capacity": 1,
        "building": "HQ",
        "floor": "1",
        "location": "HQ, Floor 1, west wing",
        "amenities": ["phone", "soundproof", "monitor"],
    },
    {
        "name": "Huddle Room",
        "description": "Small huddle space for 2-3 people. Whiteboard and TV.",
        "room_type": RoomType.MEETING_ROOM,
        "capacity": 3,
        "building": "HQ",
        "floor": "1",
        "location": "HQ, Floor 1, east wing",
        "amenities": ["whiteboard", "tv", "video"],
    },
    {
        "name": "Sync Room",
        "description": "4-person meeting room with a circular table.",
        "room_type": RoomType.MEETING_ROOM,
        "capacity": 4,
        "building": "HQ",
        "floor": "2",
        "location": "HQ, Floor 2, north corner",
        "amenities": ["whiteboard", "video"],
    },
    {
        "name": "Standup Room",
        "description": "Standing meeting room - no chairs, quick sessions only.",
        "room_type": RoomType.MEETING_ROOM,
        "capacity": 6,
        "building": "HQ",
        "floor": "2",
        "location": "HQ, Floor 2, west wing",
        "amenities": ["whiteboard", "tv"],
    },
    {
        "name": "Boardroom",
        "description": "Executive boardroom with conference video and projector.",
        "room_type": RoomType.CONFERENCE_ROOM,
        "capacity": 12,
        "building": "HQ",
        "floor": "3",
        "location": "HQ, Floor 3, executive suite",
        "amenities": ["whiteboard", "video", "projector", "phone", "catering"],
    },
    {
        "name": "Conference Room A",
        "description": "Large conference room for cross-team meetings.",
        "room_type": RoomType.CONFERENCE_ROOM,
        "capacity": 16,
        "building": "HQ",
        "floor": "2",
        "location": "HQ, Floor 2, central",
        "amenities": ["whiteboard", "video", "projector", "phone"],
    },
    {
        "name": "Conference Room B",
        "description": "Conference room with dual displays for hybrid meetings.",
        "room_type": RoomType.CONFERENCE_ROOM,
        "capacity": 14,
        "building": "Annex",
        "floor": "1",
        "location": "Annex, Floor 1",
        "amenities": ["whiteboard", "video", "projector"],
    },
    {
        "name": "Training Room",
        "description": "Workshop and training space with movable furniture.",
        "room_type": RoomType.CONFERENCE_ROOM,
        "capacity": 24,
        "building": "Annex",
        "floor": "2",
        "location": "Annex, Floor 2",
        "amenities": ["whiteboard", "video", "projector", "wifi-extender"],
    },
    {
        "name": "All Hands Hall",
        "description": "Auditorium-style room for org-wide events and demos.",
        "room_type": RoomType.OTHER,
        "capacity": 80,
        "building": "Annex",
        "floor": "3",
        "location": "Annex, Floor 3, top floor",
        "amenities": ["stage", "video", "projector", "phone", "live-stream"],
    },
]


async def _seed_dev_rooms(session, default_org, admin_user) -> None:
    """Seed mock rooms for the rooms agent tools; skips names that already exist."""
    from sqlalchemy import select

    from uniffy.core.models.rooms.room import Room
    from uniffy.core.types import AccessMode, ContentRole
    from uniffy.domains.rooms.operations import RoomOperations

    existing_names = {
        row[0]
        for row in (
            await session.execute(
                select(Room.name).where(
                    Room.organization_id == default_org.id,
                    Room.is_deleted.is_(False),
                )
            )
        ).all()
    }

    ops = RoomOperations(session)
    created = 0
    for spec in MOCK_ROOMS:
        if spec["name"] in existing_names:
            continue
        await ops.create_room(
            user_id=admin_user.id,
            organization_id=default_org.id,
            name=spec["name"],
            description=spec["description"],
            room_type=spec["room_type"],
            capacity=spec["capacity"],
            floor=spec["floor"],
            building=spec["building"],
            location=spec["location"],
            amenities=list(spec["amenities"]),
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )
        created += 1

    logger.info(f"Seeded {created} mock rooms")


async def _seed_dev_agents(session, default_org, admin_user, provider_keys: list) -> None:
    """Seed one agent per provider key with all tools enabled."""
    from uniffy.core.models.agents.agent import Agent
    from uniffy.core.types import AccessMode, ContentRole

    if not provider_keys:
        logger.info("No provider keys seeded, skipping dev agent creation")
        return

    for provider_name, provider_key in provider_keys:
        config = PROVIDER_AGENT_CONFIGS.get(provider_name)
        if not config:
            logger.warning(f"No agent config for provider {provider_name}, skipping")
            continue

        agent = Agent(
            organization_id=default_org.id,
            owner_id=admin_user.id,
            name=config["name"],
            soul_prompt=(
                "You are a helpful AI assistant within the Uniffy workspace. "
                "You can help users manage their notes, files, calendar events, projects, and tasks."
                "Be concise and helpful."
            ),
            primary_model=config["primary_model"],
            fallback_models=[],
            primary_provider_key_id=provider_key.id,
            enabled_tools=ALL_TOOL_NAMES,
            enabled_skills=[],
            avatar_emoji=config["avatar_emoji"],
            theme_color=config["theme_color"],
            # Org bootstrap already seeds the one is_default agent per org;
            # a second claim trips uq_agents_agents_default_per_org.
            is_default=False,
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )
        session.add(agent)
        logger.info(f"Seeded dev agent: {config['name']}")

    await session.flush()
    logger.info(f"Seeded {len(provider_keys)} dev agents")
