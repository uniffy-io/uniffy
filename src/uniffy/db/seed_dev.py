"""Development-only seeding data."""

import os

from loguru import logger


async def seed_development_data(
    session,
    default_org,
    admin_user,
    admin_password: str,
    search_indexer,
) -> None:
    """
    Seed additional test data for development environment.

    Creates 5 test users and 2 groups for testing purposes.

    Parameters
    ----------
    session
        Database session.
    default_org
        Default organization.
    admin_user
        Admin user.
    admin_password : str
        Password to use for test users.
    search_indexer
        Search indexer instance.

    """
    from uniffy.core.models import Group, OrganizationMember, OrganizationRole, User
    from uniffy.core.models.login.group_member import GroupMember, GroupRole
    from uniffy.core.search.indexer import build_content_urn
    from uniffy.core.types import ContentType
    from uniffy.domains.auth.passwords import hash_password

    logger.info("Creating 5 test users...")

    # Create 5 test users
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

    # Add all test users to the default organization
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

    # Join test users to default chat channels (e.g., #general)
    from uniffy.domains.chat.channels.operations import ChatChannelOperations

    chat_ops = ChatChannelOperations(session)
    for user in test_users:
        await chat_ops.join_default_channels(user.id, default_org.id)
    await session.flush()
    logger.info("Joined test users to default chat channels")

    # Create 2 groups
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

    # Add users to groups
    # Engineering: alice, bob, charlie (charlie will be in both)
    # Product: charlie, diana, eve (charlie is in both)
    logger.info("Adding users to groups...")

    # Engineering group members
    for user, role in [
        (test_users[0], GroupRole.MEMBER),  # alice
        (test_users[1], GroupRole.ADMIN),  # bob (admin)
        (test_users[2], GroupRole.MEMBER),  # charlie (in both groups)
    ]:
        member = GroupMember(
            user_id=user.id,
            group_id=group_engineering.id,
            role=role,
            is_active=True,
        )
        session.add(member)

    # Product group members
    for user, role in [
        (test_users[2], GroupRole.MEMBER),  # charlie (in both groups)
        (test_users[3], GroupRole.ADMIN),  # diana (admin)
        (test_users[4], GroupRole.MEMBER),  # eve
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

    # Index test users for search
    for user in test_users:
        await search_indexer.index(
            urn=build_content_urn(ContentType.USER, user.id),
            organization_id=default_org.id,
            title=user.full_name,
            entity_type=ContentType.USER.value,
            url_path=f"/admin/users/{user.id}",
            visibility="ORGANIZATION",  # Users are visible to org members
            owner_id=user.id,
            keywords=f"{user.full_name} {user.username} {user.email}",
            description=user.email,
        )

    logger.info("Indexed test users for search")

    # Seed LLM provider keys from environment variables
    provider_keys = await _seed_provider_keys(session, default_org, admin_user)

    # Seed dev agents (one per provider key, all tools enabled)
    await _seed_dev_agents(session, default_org, admin_user, provider_keys)


async def _seed_provider_keys(session, default_org, admin_user) -> list:
    """Seed LLM provider keys from environment variables.

    Reads CLAUDE_SETUP_TOKEN, OPENAI_API_KEY, and GOOGLE_GENAI_API_KEY
    from the environment and creates provider key records for the default org.

    Parameters
    ----------
    session
        Database session.
    default_org
        Default organization.
    admin_user
        Admin user who owns the keys.

    Returns
    -------
    list
        List of (provider_name, ProviderKey) tuples for successfully seeded keys.

    """
    from uniffy.core.crypto import encrypt_value
    from uniffy.core.models.agents.provider_key import ProviderKey
    from uniffy.core.types import VisibilityScope
    from uniffy.domains.agents.providers.utils import build_key_hint

    provider_key_configs = [
        {
            "env_var": "CLAUDE_SETUP_TOKEN",
            "provider": "anthropic",
            "credential_type": "setup_token",
            "label": "anthropic-gt-cc",
        },
        {
            "env_var": "OPENAI_API_KEY",
            "provider": "openai",
            "credential_type": "api_key",
            "label": "openai-gt-prod",
        },
        {
            "env_var": "GOOGLE_GENAI_API_KEY",
            "provider": "google",
            "credential_type": "api_key",
            "label": "google-g-prod",
        },
    ]

    seeded_keys: list[tuple[str, ProviderKey]] = []
    for config in provider_key_configs:
        credential = os.getenv(config["env_var"])
        if not credential:
            logger.warning(f"{config['env_var']} not set, skipping {config['label']} provider key")
            continue

        credential = credential.strip()
        key = ProviderKey(
            organization_id=default_org.id,
            provider=config["provider"],
            credential_type=config["credential_type"],
            label=config["label"],
            encrypted_credential=encrypt_value(credential),
            key_hint=build_key_hint(credential),
            is_valid=True,
            is_enabled=True,
            visibility=VisibilityScope.ORGANIZATION,
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
    "memory.recall",
    "memory.list",
    "memory.forget",
    "images.generate_image",
    "cron.create",
    "cron.list",
    "cron.update",
    "cron.delete",
    "cron.get_runs",
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
        "primary_model": "gemini-2.0-flash",
        "avatar_emoji": "G",
        "theme_color": "#4285f4",
    },
}


async def _seed_dev_agents(session, default_org, admin_user, provider_keys: list) -> None:
    """Seed one agent per provider key with all tools enabled.

    Parameters
    ----------
    session
        Database session.
    default_org
        Default organization.
    admin_user
        Admin user who owns the agents.
    provider_keys
        List of (provider_name, ProviderKey) tuples from _seed_provider_keys.

    """
    from sqlalchemy import select

    from uniffy.core.models.agents.agent import Agent
    from uniffy.core.models.agents.prompt import AgentPrompt
    from uniffy.core.types import VisibilityScope

    if not provider_keys:
        logger.info("No provider keys seeded, skipping dev agent creation")
        return

    # Look up the bundled default prompt (seeded before dev data)
    result = await session.execute(
        select(AgentPrompt).where(
            AgentPrompt.organization_id.is_(None),
            AgentPrompt.name == "uniffy_default",
        )
    )
    default_prompt = result.scalar_one_or_none()
    prompt_id = default_prompt.id if default_prompt else None
    if default_prompt:
        logger.info(f"Attaching bundled prompt '{default_prompt.name}' to dev agents")
    else:
        logger.warning("Bundled prompt 'uniffy_default' not found, agents will have no prompt")

    is_first = True
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
            prompt_id=prompt_id,
            enabled_tools=ALL_TOOL_NAMES,
            enabled_skills=[],
            avatar_emoji=config["avatar_emoji"],
            theme_color=config["theme_color"],
            is_default=is_first,
            visibility=VisibilityScope.ORGANIZATION,
        )
        session.add(agent)
        is_first = False
        logger.info(f"Seeded dev agent: {config['name']}")

    await session.flush()
    logger.info(f"Seeded {len(provider_keys)} dev agents")
