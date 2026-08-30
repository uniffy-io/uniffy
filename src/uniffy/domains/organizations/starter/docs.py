"""Starter workspace docs provisioned into every new organization."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID

from loguru import logger

from uniffy.domains.organizations.starter.canvas import seed_welcome_canvas

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from uniffy.core.models import Organization, User
    from uniffy.core.search.indexer import SearchIndexer
    from uniffy.core.storage import ObjectStorage

logger = logger.bind(component="organizations.starter.docs")

DOCS_DIR = Path(__file__).parents[5] / "docs"


def starter_content_enabled() -> bool:
    """Gate for the docs notes and the Welcome canvas."""
    raw = os.getenv("SEED_STARTER_CONTENT", "").strip().lower()
    if not raw:
        return True
    return raw in {"1", "true", "yes", "on"}


def workspace_docs_available() -> bool:
    """The docs tree is part of the repo/image; a deployment without it
    skips starter docs instead of failing org creation.
    """
    return (DOCS_DIR / "ABOUT.md").exists()


FILE_PATH_TO_SLUG: dict[str, str] = {
    "ABOUT.md": "about",
    "PLANS.md": "plans",
    "TRANSPARENCY.md": "transparency",
    "LICENSES.md": "licenses",
    "documentation/SEARCHING.md": "searching",
    "documentation/SHARING.md": "sharing",
    "documentation/ENCRYPTION.md": "encryption",
}


def replace_markdown_links_with_urns(
    content: str,
    slug_to_urn: dict[str, str],
) -> str:
    """Rewrite internal markdown links to `[[[label|urn]]]` mentions."""
    link_pattern = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")

    def replace_link(match: re.Match[str]) -> str:
        label = match.group(1)
        path = match.group(2)

        if path.startswith(("http://", "https://", "#")):
            return match.group(0)

        normalized_path = path.lstrip("./")

        slug = FILE_PATH_TO_SLUG.get(normalized_path)
        if slug and slug in slug_to_urn:
            urn = slug_to_urn[slug]
            return f"[[[{label}|{urn}]]]"

        return match.group(0)

    return link_pattern.sub(replace_link, content)


def build_note_urn(note_id: UUID) -> str:
    """Build a URN string for a note."""
    return f"urn:uniffy:content:NOTE:{note_id}"


async def seed_workspace_docs(
    *,
    session: AsyncSession,
    org: Organization,
    admin_user: User,
    search_indexer: SearchIndexer,
    storage: ObjectStorage | None,
) -> None:
    """Create the Uniffy folder tree, the docs notes and the Welcome canvas."""
    from uniffy.core.models import Note
    from uniffy.core.search.indexer import build_content_urn
    from uniffy.core.types import AccessMode, ContentRole, ContentType, NodeType

    uniffy_folder = Note(
        organization_id=org.id,
        owner_id=admin_user.id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
        node_type=NodeType.FOLDER,
        title="Uniffy",
        slug="uniffy-folder",
        note_metadata={"system_generated": "true"},
    )
    session.add(uniffy_folder)
    await session.flush()
    await session.refresh(uniffy_folder)
    logger.info("Created Uniffy root folder")

    docs_folder = Note(
        organization_id=org.id,
        owner_id=admin_user.id,
        parent_id=uniffy_folder.id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
        node_type=NodeType.FOLDER,
        title="Docs",
        slug="docs-folder",
        note_metadata={"system_generated": "true"},
    )
    session.add(docs_folder)
    await session.flush()
    await session.refresh(docs_folder)
    logger.info("Created Docs subfolder inside Uniffy")

    # Notes are created with empty content first so all IDs exist
    # before markdown link rewriting resolves slugs to URNs.
    about_note = Note(
        organization_id=org.id,
        owner_id=admin_user.id,
        parent_id=uniffy_folder.id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
        node_type=NodeType.NOTE,
        title="About",
        content="",
        slug="about",
        note_metadata={"system_generated": "true"},
    )
    session.add(about_note)

    plans_note = Note(
        organization_id=org.id,
        owner_id=admin_user.id,
        parent_id=uniffy_folder.id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
        node_type=NodeType.NOTE,
        title="Plans",
        content="",
        slug="plans",
        note_metadata={"system_generated": "true"},
    )
    session.add(plans_note)

    transparency_note = Note(
        organization_id=org.id,
        owner_id=admin_user.id,
        parent_id=uniffy_folder.id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
        node_type=NodeType.NOTE,
        title="Transparency",
        content="",
        slug="transparency",
        note_metadata={"system_generated": "true"},
    )
    session.add(transparency_note)

    licenses_note = Note(
        organization_id=org.id,
        owner_id=admin_user.id,
        parent_id=uniffy_folder.id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
        node_type=NodeType.NOTE,
        title="Licenses",
        content="",
        slug="licenses",
        note_metadata={"system_generated": "true"},
    )
    session.add(licenses_note)

    searching_note = Note(
        organization_id=org.id,
        owner_id=admin_user.id,
        parent_id=docs_folder.id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
        node_type=NodeType.NOTE,
        title="Searching",
        content="",
        slug="searching",
        note_metadata={"system_generated": "true"},
    )
    session.add(searching_note)

    sharing_note = Note(
        organization_id=org.id,
        owner_id=admin_user.id,
        parent_id=docs_folder.id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
        node_type=NodeType.NOTE,
        title="Sharing",
        content="",
        slug="sharing",
        note_metadata={"system_generated": "true"},
    )
    session.add(sharing_note)

    encryption_note = Note(
        organization_id=org.id,
        owner_id=admin_user.id,
        parent_id=docs_folder.id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
        node_type=NodeType.NOTE,
        title="Encryption",
        content="",
        slug="encryption",
        note_metadata={"system_generated": "true"},
    )
    session.add(encryption_note)

    await session.flush()
    await session.refresh(about_note)
    await session.refresh(plans_note)
    await session.refresh(transparency_note)
    await session.refresh(licenses_note)
    await session.refresh(searching_note)
    await session.refresh(sharing_note)
    await session.refresh(encryption_note)
    logger.info("Created note placeholders")

    slug_to_urn: dict[str, str] = {
        "about": build_note_urn(about_note.id),
        "plans": build_note_urn(plans_note.id),
        "transparency": build_note_urn(transparency_note.id),
        "licenses": build_note_urn(licenses_note.id),
        "searching": build_note_urn(searching_note.id),
        "sharing": build_note_urn(sharing_note.id),
        "encryption": build_note_urn(encryption_note.id),
    }

    from uniffy.core.content.references import extract_urns_from_content

    about_content = (DOCS_DIR / "ABOUT.md").read_text()
    about_note.content = replace_markdown_links_with_urns(about_content, slug_to_urn)
    about_note.outgoing_references = extract_urns_from_content(about_note.content) or None

    plans_content = (DOCS_DIR / "PLANS.md").read_text()
    plans_note.content = replace_markdown_links_with_urns(plans_content, slug_to_urn)
    plans_note.outgoing_references = extract_urns_from_content(plans_note.content) or None

    transparency_content = (DOCS_DIR / "TRANSPARENCY.md").read_text()
    transparency_note.content = replace_markdown_links_with_urns(transparency_content, slug_to_urn)
    transparency_note.outgoing_references = (
        extract_urns_from_content(transparency_note.content) or None
    )

    licenses_content = (DOCS_DIR / "LICENSES.md").read_text()
    licenses_note.content = replace_markdown_links_with_urns(licenses_content, slug_to_urn)
    licenses_note.outgoing_references = extract_urns_from_content(licenses_note.content) or None

    searching_content = (DOCS_DIR / "documentation" / "SEARCHING.md").read_text()
    searching_note.content = replace_markdown_links_with_urns(searching_content, slug_to_urn)
    searching_note.outgoing_references = extract_urns_from_content(searching_note.content) or None

    sharing_content = (DOCS_DIR / "documentation" / "SHARING.md").read_text()
    sharing_note.content = replace_markdown_links_with_urns(sharing_content, slug_to_urn)
    sharing_note.outgoing_references = extract_urns_from_content(sharing_note.content) or None

    encryption_content = (DOCS_DIR / "documentation" / "ENCRYPTION.md").read_text()
    encryption_note.content = replace_markdown_links_with_urns(encryption_content, slug_to_urn)
    encryption_note.outgoing_references = extract_urns_from_content(encryption_note.content) or None

    await session.flush()
    logger.info("Updated notes with URN-based mentions and outgoing references")

    all_notes = [
        about_note,
        plans_note,
        transparency_note,
        licenses_note,
        searching_note,
        sharing_note,
        encryption_note,
    ]

    # Shared documentation + uniffy tags assigned to every seeded
    # item so the org tree pre-populates the tag filters new orgs use.
    from uniffy.domains.tags.operations import TagOperations

    tag_ops = TagOperations(session)
    doc_tag = await tag_ops.create(
        actor_id=admin_user.id,
        organization_id=org.id,
        name="documentation",
    )
    uniffy_tag = await tag_ops.create(
        actor_id=admin_user.id,
        organization_id=org.id,
        name="uniffy",
    )
    seed_tag_ids = [doc_tag.id, uniffy_tag.id]
    seed_tag_slugs = [doc_tag.slug, uniffy_tag.slug]

    for tagged in (uniffy_folder, docs_folder, *all_notes):
        await tag_ops.assign(
            actor_id=admin_user.id,
            organization_id=org.id,
            content_urn=build_content_urn(ContentType.NOTE, tagged.id),
            tag_ids=seed_tag_ids,
        )
    logger.info("Tagged seed notes with documentation + uniffy")

    await search_indexer.index(
        urn=build_content_urn(ContentType.NOTE, uniffy_folder.id),
        organization_id=org.id,
        title=uniffy_folder.title,
        entity_type=ContentType.NOTE.value,
        url_path=f"/notes/{uniffy_folder.id}",
        access_mode=uniffy_folder.access_mode.value,
        baseline_role=(
            uniffy_folder.baseline_role.value if uniffy_folder.baseline_role is not None else None
        ),
        owner_id=admin_user.id,
        keywords=uniffy_folder.title,
        description=uniffy_folder.content[:200] if uniffy_folder.content else None,
        tags=seed_tag_slugs,
    )

    await search_indexer.index(
        urn=build_content_urn(ContentType.NOTE, docs_folder.id),
        organization_id=org.id,
        title=docs_folder.title,
        entity_type=ContentType.NOTE.value,
        url_path=f"/notes/{docs_folder.id}",
        access_mode=docs_folder.access_mode.value,
        baseline_role=(
            docs_folder.baseline_role.value if docs_folder.baseline_role is not None else None
        ),
        owner_id=admin_user.id,
        keywords=docs_folder.title,
        description=docs_folder.content[:200] if docs_folder.content else None,
        tags=seed_tag_slugs,
    )

    for note in all_notes:
        await search_indexer.index(
            urn=build_content_urn(ContentType.NOTE, note.id),
            organization_id=org.id,
            title=note.title,
            entity_type=ContentType.NOTE.value,
            url_path=f"/notes/{note.id}",
            access_mode=note.access_mode.value,
            baseline_role=(note.baseline_role.value if note.baseline_role is not None else None),
            owner_id=admin_user.id,
            keywords=" ".join([note.title, note.content[:1000]]),
            description=note.content[:200] if note.content else None,
            tags=seed_tag_slugs,
        )

    logger.info("Indexed seed notes for search")

    await seed_welcome_canvas(
        session=session,
        org=org,
        admin_user=admin_user,
        uniffy_folder=uniffy_folder,
        seed_notes={
            "about": about_note,
            "plans": plans_note,
            "searching": searching_note,
            "sharing": sharing_note,
        },
        search_indexer=search_indexer,
        storage=storage,
        tag_ids=seed_tag_ids,
        tag_slugs=seed_tag_slugs,
    )
