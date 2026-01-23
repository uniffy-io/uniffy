"""Initial data seeding for the database."""

import os
import re
from pathlib import Path
from uuid import UUID

from loguru import logger
from sqlalchemy import select

# Path to docs folder in repository root
DOCS_DIR = Path(__file__).parent.parent.parent.parent / "docs"

# Mapping of file paths (relative to docs/) to note slugs for URN resolution
FILE_PATH_TO_SLUG: dict[str, str] = {
    "ABOUT.md": "about",
    "PLANS.md": "plans",
    "TRANSPARENCY.md": "transparency",
    "documentation/SEARCHING.md": "searching",
}


def replace_markdown_links_with_urns(
    content: str,
    slug_to_urn: dict[str, str],
) -> str:
    """
    Replace markdown file links with URN mentions.

    Converts [label](path/to/file.md) to [[[label|urn:uwos:content:NOTE:uuid]]]
    for internal documentation links.

    Args:
        content: The markdown content to process.
        slug_to_urn: Mapping of note slugs to their URNs.

    Returns:
        Content with markdown links replaced by URN mentions.
    """
    # Pattern to match markdown links: [text](path)
    link_pattern = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")

    def replace_link(match: re.Match[str]) -> str:
        label = match.group(1)
        path = match.group(2)

        # Skip external links (http/https)
        if path.startswith(("http://", "https://", "#")):
            return match.group(0)

        # Normalize the path (remove leading ./ if present)
        normalized_path = path.lstrip("./")

        # Check if this path maps to a known note
        slug = FILE_PATH_TO_SLUG.get(normalized_path)
        if slug and slug in slug_to_urn:
            urn = slug_to_urn[slug]
            return f"[[[{label}|{urn}]]]"

        # Keep original link if not a known internal doc
        return match.group(0)

    return link_pattern.sub(replace_link, content)


def build_note_urn(note_id: UUID) -> str:
    """Build a URN string for a note."""
    return f"urn:uwos:content:NOTE:{note_id}"


async def seed_initial_data() -> None:
    """
    Seed initial data if the database is empty.

    Creates a default organization, system admin user, and seed notes from docs/.
    Internal markdown links are converted to URN mentions.
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
            await session.flush()
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

            # 4. Create UWOS root folder
            uwos_folder = Note(
                organization_id=default_org.id,
                owner_id=admin_user.id,
                visibility=VisibilityScope.ORGANIZATION,
                node_type=NodeType.FOLDER,
                title="UWOS",
                slug="uwos-folder",
                note_metadata={"system_generated": "true"},
            )
            session.add(uwos_folder)
            await session.flush()
            await session.refresh(uwos_folder)
            logger.info("Created UWOS root folder")

            # 5. Create Docs subfolder inside UWOS
            docs_folder = Note(
                organization_id=default_org.id,
                owner_id=admin_user.id,
                parent_id=uwos_folder.id,
                visibility=VisibilityScope.ORGANIZATION,
                node_type=NodeType.FOLDER,
                title="Docs",
                slug="docs-folder",
                note_metadata={"system_generated": "true"},
            )
            session.add(docs_folder)
            await session.flush()
            await session.refresh(docs_folder)
            logger.info("Created Docs subfolder inside UWOS")

            # 6. Create all notes first with placeholder content
            # We need all note IDs before we can replace links with URNs

            # About note
            about_note = Note(
                organization_id=default_org.id,
                owner_id=admin_user.id,
                parent_id=uwos_folder.id,
                visibility=VisibilityScope.ORGANIZATION,
                node_type=NodeType.NOTE,
                title="About",
                content="",  # Placeholder, will be updated
                slug="about",
                tags=["documentation", "getting-started"],
                note_metadata={"system_generated": "true"},
            )
            session.add(about_note)

            # Plans note
            plans_note = Note(
                organization_id=default_org.id,
                owner_id=admin_user.id,
                parent_id=uwos_folder.id,
                visibility=VisibilityScope.ORGANIZATION,
                node_type=NodeType.NOTE,
                title="Plans",
                content="",
                slug="plans",
                tags=["documentation", "pricing"],
                note_metadata={"system_generated": "true"},
            )
            session.add(plans_note)

            # Transparency note
            transparency_note = Note(
                organization_id=default_org.id,
                owner_id=admin_user.id,
                parent_id=uwos_folder.id,
                visibility=VisibilityScope.ORGANIZATION,
                node_type=NodeType.NOTE,
                title="Transparency",
                content="",
                slug="transparency",
                tags=["documentation", "license", "privacy"],
                note_metadata={"system_generated": "true"},
            )
            session.add(transparency_note)

            # Searching note (in Docs subfolder)
            searching_note = Note(
                organization_id=default_org.id,
                owner_id=admin_user.id,
                parent_id=docs_folder.id,
                visibility=VisibilityScope.ORGANIZATION,
                node_type=NodeType.NOTE,
                title="Searching",
                content="",
                slug="searching",
                tags=["documentation", "search", "help"],
                note_metadata={"system_generated": "true"},
            )
            session.add(searching_note)

            # Flush to get all IDs
            await session.flush()
            await session.refresh(about_note)
            await session.refresh(plans_note)
            await session.refresh(transparency_note)
            await session.refresh(searching_note)
            logger.info("Created note placeholders")

            # 7. Build slug-to-URN mapping for link replacement
            slug_to_urn: dict[str, str] = {
                "about": build_note_urn(about_note.id),
                "plans": build_note_urn(plans_note.id),
                "transparency": build_note_urn(transparency_note.id),
                "searching": build_note_urn(searching_note.id),
            }

            # 8. Read content, replace markdown links with URN mentions,
            # and extract outgoing references for the knowledge graph
            from uwos.domains.notes.queries import extract_urns_from_content

            about_content = (DOCS_DIR / "ABOUT.md").read_text()
            about_note.content = replace_markdown_links_with_urns(
                about_content, slug_to_urn
            )
            about_note.outgoing_references = extract_urns_from_content(about_note.content) or None

            plans_content = (DOCS_DIR / "PLANS.md").read_text()
            plans_note.content = replace_markdown_links_with_urns(
                plans_content, slug_to_urn
            )
            plans_note.outgoing_references = extract_urns_from_content(plans_note.content) or None

            transparency_content = (DOCS_DIR / "TRANSPARENCY.md").read_text()
            transparency_note.content = replace_markdown_links_with_urns(
                transparency_content, slug_to_urn
            )
            transparency_note.outgoing_references = (
                extract_urns_from_content(transparency_note.content) or None
            )

            searching_content = (DOCS_DIR / "documentation" / "SEARCHING.md").read_text()
            searching_note.content = replace_markdown_links_with_urns(
                searching_content, slug_to_urn
            )
            searching_note.outgoing_references = (
                extract_urns_from_content(searching_note.content) or None
            )

            await session.flush()
            logger.info("Updated notes with URN-based mentions and outgoing references")

            # Collect all notes for indexing
            all_notes = [about_note, plans_note, transparency_note, searching_note]

            # 9. Index all notes for search
            search_indexer = SearchIndexer(session)

            # Index UWOS folder
            await search_indexer.index(
                urn=build_content_urn(ContentType.NOTE, uwos_folder.id),
                organization_id=default_org.id,
                title=uwos_folder.title,
                entity_type=ContentType.NOTE.value,
                url_path=f"/notes/{uwos_folder.id}",
                visibility=uwos_folder.visibility.value,
                owner_id=admin_user.id,
                keywords=" ".join([uwos_folder.title] + (uwos_folder.tags or [])),
                description=uwos_folder.content[:200] if uwos_folder.content else None,
            )

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

            # Index all notes
            for note in all_notes:
                await search_indexer.index(
                    urn=build_content_urn(ContentType.NOTE, note.id),
                    organization_id=default_org.id,
                    title=note.title,
                    entity_type=ContentType.NOTE.value,
                    url_path=f"/notes/{note.id}",
                    visibility=note.visibility.value,
                    owner_id=admin_user.id,
                    keywords=" ".join(
                        [note.title] + (note.tags or []) + [note.content[:1000]]
                    ),
                    description=note.content[:200] if note.content else None,
                )

            logger.info("Indexed seed notes for search")

            await session.commit()
            logger.info("Initial data seeding completed successfully.")

        except Exception as e:
            await session.rollback()
            logger.error(f"Failed to seed initial data: {e}")
            raise
