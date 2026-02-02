"""Development-only seeding data."""

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
