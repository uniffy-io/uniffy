"""Initial data seeding for the database."""

import os
from pathlib import Path

from loguru import logger
from sqlalchemy import select

# Path to seed data files
SEED_DATA_DIR = Path(__file__).parent / "seed_data"


async def seed_initial_data() -> None:
    """
    Seed initial data if the database is empty.

    Creates a default organization and a system admin user.
    """
    # Lazy imports to avoid circular dependency with auth module
    from uwos.core.models import (
        Note,
        Organization,
        OrganizationMember,
        OrganizationRole,
        User,
        VisibilityScope,
    )
    from uwos.core.models.shared import NodeType
    from uwos.core.search.indexer import SearchIndexer, build_content_urn
    from uwos.core.types import ContentType
    from uwos.db.session import get_async_session
    from uwos.domains.auth.passwords import hash_password

    logger.info("Checking for existing data...")

    async for session in get_async_session():
        # Check for existing organizations
        result = await session.execute(select(Organization).limit(1))
        existing_org = result.scalar_one_or_none()

        if existing_org:
            logger.info("Database already seeded. Skipping initialization.")
            return

        logger.info("No organizations found. Seeding initial data...")

        try:
            # 1. Create Default Organization
            default_org = Organization(
                name="Default", slug="default", plan="enterprise", is_active=True
            )
            session.add(default_org)
            await session.flush()  # flush to get the ID
            await session.refresh(default_org)
            logger.info(f"Created default organization: {default_org.name}")

            # 2. Create System Admin User
            admin_password = os.getenv("INITIAL_ADMIN_PASSWORD")
            if not admin_password:
                logger.warning(
                    "INITIAL_ADMIN_PASSWORD environment variable not set. "
                    "Using default password: 'admin'"
                )
                admin_password = "admin"

            admin_user = User(
                email="admin@uwos.io",
                username="admin",
                full_name="System Administrator",
                hashed_password=hash_password(admin_password),
                is_active=True,
                is_system_admin=True,
                email_verified=True,
            )
            session.add(admin_user)
            await session.flush()
            await session.refresh(admin_user)
            logger.info(f"Created system admin user: {admin_user.username}")

            # 3. Add Admin to Organization
            member = OrganizationMember(
                user_id=admin_user.id,
                organization_id=default_org.id,
                role=OrganizationRole.OWNER,
                is_active=True,
            )
            session.add(member)

            # 4. Create Docs folder
            docs_folder = Note(
                organization_id=default_org.id,
                owner_id=admin_user.id,
                visibility=VisibilityScope.ORGANIZATION,
                node_type=NodeType.FOLDER,
                title="Docs",
                slug="docs-folder",
                note_metadata={"system_generated": "true"},
            )
            session.add(docs_folder)
            await session.flush()
            await session.refresh(docs_folder)
            logger.info("Created Docs folder")

            # 5. Create About note at root level
            about_content = (SEED_DATA_DIR / "about.md").read_text()
            about_note = Note(
                organization_id=default_org.id,
                owner_id=admin_user.id,
                parent_id=None,
                visibility=VisibilityScope.ORGANIZATION,
                node_type=NodeType.NOTE,
                title="About",
                content=about_content,
                slug="about",
                tags=["documentation", "getting-started"],
                note_metadata={"system_generated": "true"},
            )
            session.add(about_note)
            await session.flush()
            await session.refresh(about_note)
            logger.info("Created About note at root level")

            # 6. Create Searching note inside Docs folder
            searching_content = (SEED_DATA_DIR / "searching.md").read_text()
            searching_note = Note(
                organization_id=default_org.id,
                owner_id=admin_user.id,
                parent_id=docs_folder.id,
                visibility=VisibilityScope.ORGANIZATION,
                node_type=NodeType.NOTE,
                title="Searching",
                content=searching_content,
                slug="searching",
                tags=["documentation", "search", "help"],
                note_metadata={"system_generated": "true"},
            )
            session.add(searching_note)
            await session.flush()
            await session.refresh(searching_note)
            logger.info("Created Searching note in Docs folder")

            # 6. Index notes for search
            search_indexer = SearchIndexer(session)

            # Index Docs folder
            await search_indexer.index(
                urn=build_content_urn(ContentType.NOTE, docs_folder.id),
                organization_id=default_org.id,
                title=docs_folder.title,
                entity_type=ContentType.NOTE.value,
                url_path=f"/notes/{docs_folder.id}",
                visibility=docs_folder.visibility.value,
                owner_id=admin_user.id,
                keywords=" ".join([docs_folder.title] + (docs_folder.tags or [])),
                description=docs_folder.content[:200] if docs_folder.content else None,
            )

            # Index About note
            await search_indexer.index(
                urn=build_content_urn(ContentType.NOTE, about_note.id),
                organization_id=default_org.id,
                title=about_note.title,
                entity_type=ContentType.NOTE.value,
                url_path=f"/notes/{about_note.id}",
                visibility=about_note.visibility.value,
                owner_id=admin_user.id,
                keywords=" ".join(
                    [about_note.title] + (about_note.tags or []) + [about_note.content[:1000]]
                ),
                description=about_note.content[:200] if about_note.content else None,
            )

            # Index Searching note
            await search_indexer.index(
                urn=build_content_urn(ContentType.NOTE, searching_note.id),
                organization_id=default_org.id,
                title=searching_note.title,
                entity_type=ContentType.NOTE.value,
                url_path=f"/notes/{searching_note.id}",
                visibility=searching_note.visibility.value,
                owner_id=admin_user.id,
                keywords=" ".join(
                    [searching_note.title]
                    + (searching_note.tags or [])
                    + [searching_note.content[:1000]]
                ),
                description=searching_note.content[:200] if searching_note.content else None,
            )
            logger.info("Indexed seed notes for search")

            await session.commit()
            logger.info("Initial data seeding completed successfully.")

        except Exception as e:
            await session.rollback()
            logger.error(f"Failed to seed initial data: {e}")
            raise
