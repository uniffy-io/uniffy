"""Initial data seeding for the database."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from uniffy.core.models import Note, Organization, User
    from uniffy.core.models.files.file import File
    from uniffy.core.search.indexer import SearchIndexer

DOCS_DIR = Path(__file__).parent.parent.parent.parent / "docs"
SEED_DATA_DIR = Path(__file__).parent / "seed_data"

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


async def seed_initial_data() -> None:
    """Seed the default org + docs if the database is empty.

    Serialised across workers via advisory lock; the existing-org check inside
    keeps the body idempotent for followers.
    """
    from uniffy.db.session import SEED_LOCK_ID, startup_advisory_lock

    with startup_advisory_lock(SEED_LOCK_ID, "initial seed"):
        await _seed_initial_data_locked()


async def _seed_initial_data_locked() -> None:
    # Lazy imports avoid the auth-module circular dependency.
    from uniffy.core.models import (
        Note,
        Organization,
        User,
    )
    from uniffy.core.search.indexer import SearchIndexer, build_content_urn
    from uniffy.core.types import AccessMode, ContentRole, ContentType, NodeType
    from uniffy.db.session import open_session
    from uniffy.domains.auth.passwords import hash_password

    logger.info("Checking for existing data...")

    async with open_session() as session:
        result = await session.execute(select(Organization).limit(1))
        existing_org = result.scalar_one_or_none()

        if existing_org:
            logger.info("Database already seeded. Skipping initialization.")
            return

        logger.info("No organizations found. Seeding initial data...")

        try:
            # Bootstrap users. When INITIAL_ADMIN_EMAIL == INITIAL_PLATFORM_ADMIN_EMAIL
            # (case-insensitive) one user holds both roles - the self-hosted
            # single-tenant default. Otherwise admin owns the org and a separate
            # platform user is sysadmin-only with no org membership.
            admin_password = os.getenv("INITIAL_ADMIN_PASSWORD")
            if not admin_password:
                logger.warning(
                    "INITIAL_ADMIN_PASSWORD environment variable not set. "
                    "Using default password: 'admin'"
                )
                admin_password = "admin"

            admin_email = os.getenv("INITIAL_ADMIN_EMAIL", "admin@uniffy.io")
            platform_email = (
                os.getenv("INITIAL_PLATFORM_ADMIN_EMAIL", "").strip() or admin_email
            )
            platform_password = (
                os.getenv("INITIAL_PLATFORM_ADMIN_PASSWORD", "").strip()
                or admin_password
            )

            collapsed = admin_email.strip().lower() == platform_email.strip().lower()

            admin_user = User(
                email=admin_email,
                username="admin",
                full_name="System Administrator",
                hashed_password=hash_password(admin_password),
                is_active=True,
                is_system_admin=collapsed,
                email_verified=True,
            )
            session.add(admin_user)
            await session.flush()
            await session.refresh(admin_user)

            if collapsed:
                logger.info(
                    f"Created combined admin + platform user: {admin_user.email}"
                )
            else:
                logger.info(f"Created org-owner user: {admin_user.email}")
                platform_user = User(
                    email=platform_email,
                    username="platform",
                    full_name="Platform Operator",
                    hashed_password=hash_password(platform_password),
                    is_active=True,
                    is_system_admin=True,
                    email_verified=True,
                )
                session.add(platform_user)
                await session.flush()
                await session.refresh(platform_user)
                logger.info(
                    f"Created platform-admin-only user: {platform_user.email}"
                )

            from uniffy.domains.organizations.operations import OrganizationOperations

            org_name = os.getenv("DEFAULT_ORG_NAME", "Default")
            org_slug = os.getenv("DEFAULT_ORG_SLUG")
            if not org_slug:
                from uniffy.core.types import slugify

                org_slug = slugify(org_name)

            org_ops = OrganizationOperations(session)
            default_org = await org_ops.create(
                name=org_name,
                slug=org_slug,
                owner_user_id=admin_user.id,
                plan="enterprise",
            )
            logger.info(f"Created default organization: {default_org.name} ({default_org.slug})")

            uniffy_folder = Note(
                organization_id=default_org.id,
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
                organization_id=default_org.id,
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
                organization_id=default_org.id,
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
                organization_id=default_org.id,
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
                organization_id=default_org.id,
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
                organization_id=default_org.id,
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
                organization_id=default_org.id,
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
                organization_id=default_org.id,
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
                organization_id=default_org.id,
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
            transparency_note.content = replace_markdown_links_with_urns(
                transparency_content, slug_to_urn
            )
            transparency_note.outgoing_references = (
                extract_urns_from_content(transparency_note.content) or None
            )

            licenses_content = (DOCS_DIR / "LICENSES.md").read_text()
            licenses_note.content = replace_markdown_links_with_urns(licenses_content, slug_to_urn)
            licenses_note.outgoing_references = (
                extract_urns_from_content(licenses_note.content) or None
            )

            searching_content = (DOCS_DIR / "documentation" / "SEARCHING.md").read_text()
            searching_note.content = replace_markdown_links_with_urns(searching_content, slug_to_urn)
            searching_note.outgoing_references = (
                extract_urns_from_content(searching_note.content) or None
            )

            sharing_content = (DOCS_DIR / "documentation" / "SHARING.md").read_text()
            sharing_note.content = replace_markdown_links_with_urns(sharing_content, slug_to_urn)
            sharing_note.outgoing_references = (
                extract_urns_from_content(sharing_note.content) or None
            )

            encryption_content = (DOCS_DIR / "documentation" / "ENCRYPTION.md").read_text()
            encryption_note.content = replace_markdown_links_with_urns(
                encryption_content, slug_to_urn
            )
            encryption_note.outgoing_references = (
                extract_urns_from_content(encryption_note.content) or None
            )

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
                organization_id=default_org.id,
                name="documentation",
            )
            uniffy_tag = await tag_ops.create(
                actor_id=admin_user.id,
                organization_id=default_org.id,
                name="uniffy",
            )
            seed_tag_ids = [doc_tag.id, uniffy_tag.id]
            seed_tag_slugs = [doc_tag.slug, uniffy_tag.slug]

            for tagged in (uniffy_folder, docs_folder, *all_notes):
                await tag_ops.assign(
                    actor_id=admin_user.id,
                    organization_id=default_org.id,
                    content_urn=build_content_urn(ContentType.NOTE, tagged.id),
                    tag_ids=seed_tag_ids,
                )
            logger.info("Tagged seed notes with documentation + uniffy")

            search_indexer = SearchIndexer(session)

            await search_indexer.index(
                urn=build_content_urn(ContentType.NOTE, uniffy_folder.id),
                organization_id=default_org.id,
                title=uniffy_folder.title,
                entity_type=ContentType.NOTE.value,
                url_path=f"/notes/{uniffy_folder.id}",
                access_mode=uniffy_folder.access_mode.value,
                baseline_role=(
                    uniffy_folder.baseline_role.value
                    if uniffy_folder.baseline_role is not None
                    else None
                ),
                owner_id=admin_user.id,
                keywords=uniffy_folder.title,
                description=uniffy_folder.content[:200] if uniffy_folder.content else None,
                tags=seed_tag_slugs,
            )

            await search_indexer.index(
                urn=build_content_urn(ContentType.NOTE, docs_folder.id),
                organization_id=default_org.id,
                title=docs_folder.title,
                entity_type=ContentType.NOTE.value,
                url_path=f"/notes/{docs_folder.id}",
                access_mode=docs_folder.access_mode.value,
                baseline_role=(
                    docs_folder.baseline_role.value
                    if docs_folder.baseline_role is not None
                    else None
                ),
                owner_id=admin_user.id,
                keywords=docs_folder.title,
                description=docs_folder.content[:200] if docs_folder.content else None,
                tags=seed_tag_slugs,
            )

            for note in all_notes:
                await search_indexer.index(
                    urn=build_content_urn(ContentType.NOTE, note.id),
                    organization_id=default_org.id,
                    title=note.title,
                    entity_type=ContentType.NOTE.value,
                    url_path=f"/notes/{note.id}",
                    access_mode=note.access_mode.value,
                    baseline_role=(
                        note.baseline_role.value if note.baseline_role is not None else None
                    ),
                    owner_id=admin_user.id,
                    keywords=" ".join([note.title, note.content[:1000]]),
                    description=note.content[:200] if note.content else None,
                    tags=seed_tag_slugs,
                )

            logger.info("Indexed seed notes for search")

            await _seed_welcome_canvas(
                session=session,
                org=default_org,
                admin_user=admin_user,
                uniffy_folder=uniffy_folder,
                seed_notes={
                    "about": about_note,
                    "plans": plans_note,
                    "searching": searching_note,
                    "sharing": sharing_note,
                },
                search_indexer=search_indexer,
                tag_ids=seed_tag_ids,
                tag_slugs=seed_tag_slugs,
            )

            await _seed_bundled_skills(session)
            await _seed_bundled_prompts(session)

            environment = os.getenv("ENVIRONMENT", "production")
            if environment == "development":
                from uniffy.db.seed_dev import seed_development_data

                logger.info("Development environment detected. Adding test data...")
                await seed_development_data(
                    session,
                    default_org,
                    admin_user,
                    admin_password,
                    search_indexer,
                )
                logger.info("Development test data seeding completed")

            await _seed_vapid_keys(session, admin_email)

            await session.commit()
            logger.info("Initial data seeding completed successfully.")

        except Exception as e:
            await session.rollback()
            logger.error(f"Failed to seed initial data: {e}")
            raise


def _parse_simple_yaml(text: str) -> dict[str, str]:
    """Parse `key: value` lines; avoids a PyYAML dep for trivial frontmatter."""
    result: dict[str, str] = {}
    for line in text.strip().splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        key, _, value = line.partition(":")
        result[key.strip()] = value.strip()
    return result


def _load_seed_markdown(directory: Path) -> list[dict[str, Any]]:
    """Load `*.md` files whose frontmatter holds name/display_name/description."""
    items: list[dict[str, Any]] = []
    if not directory.is_dir():
        return items

    for md_file in sorted(directory.glob("*.md")):
        raw = md_file.read_text()

        if not raw.startswith("---"):
            logger.warning(f"Seed file {md_file.name} missing YAML frontmatter, skipping")
            continue

        parts = raw.split("---", 2)
        if len(parts) < 3:
            logger.warning(f"Seed file {md_file.name} has malformed frontmatter, skipping")
            continue

        frontmatter = _parse_simple_yaml(parts[1])
        content = parts[2].strip()

        items.append({
            "name": frontmatter["name"],
            "display_name": frontmatter["display_name"],
            "description": frontmatter["description"],
            "content": content,
        })

    return items


async def _seed_bundled_skills(session: AsyncSession) -> None:
    """Seed bundled agent skills from `seed_data/skills/`."""
    from uniffy.core.models.agents.skill import AgentSkill

    skills = _load_seed_markdown(SEED_DATA_DIR / "skills")

    for skill_data in skills:
        existing = await session.execute(
            select(AgentSkill).where(
                AgentSkill.organization_id.is_(None),
                AgentSkill.name == skill_data["name"],
            )
        )
        if existing.scalar_one_or_none():
            continue

        skill = AgentSkill(
            organization_id=None,
            name=skill_data["name"],
            display_name=skill_data["display_name"],
            description=skill_data["description"],
            content=skill_data["content"],
            source="bundled",
            always_active=False,
        )
        session.add(skill)

    await session.flush()
    logger.info(f"Seeded {len(skills)} bundled agent skills")


async def _seed_bundled_prompts(session: AsyncSession) -> None:
    """Seed bundled agent prompts from `seed_data/prompts/`."""
    from uniffy.core.models.agents.prompt import AgentPrompt

    prompts = _load_seed_markdown(SEED_DATA_DIR / "prompts")

    for prompt_data in prompts:
        existing = await session.execute(
            select(AgentPrompt).where(
                AgentPrompt.organization_id.is_(None),
                AgentPrompt.name == prompt_data["name"],
            )
        )
        if existing.scalar_one_or_none():
            continue

        prompt = AgentPrompt(
            organization_id=None,
            name=prompt_data["name"],
            display_name=prompt_data["display_name"],
            description=prompt_data["description"],
            content=prompt_data["content"],
            source="bundled",
        )
        session.add(prompt)

    await session.flush()
    logger.info(f"Seeded {len(prompts)} bundled agent prompts")


async def _seed_welcome_canvas(
    *,
    session: AsyncSession,
    org: Organization,
    admin_user: User,
    uniffy_folder: Note,
    seed_notes: dict[str, Note],
    search_indexer: SearchIndexer,
    tag_ids: list[UUID],
    tag_slugs: list[str],
) -> None:
    """Seed the org logo file and the Welcome canvas.

    S3 unavailability is non-fatal: the canvas drops the media node and the
    rest of the seed continues.
    """
    from uniffy.core.content.references import (
        extract_all_outgoing_references_from_canvas,
    )
    from uniffy.core.models.files.file import ExtractionStatus, File
    from uniffy.core.models.notes.note import Note
    from uniffy.core.search.indexer import build_content_urn
    from uniffy.core.storage import get_s3_client
    from uniffy.core.types import AccessMode, ContentRole, ContentType, NodeType

    logo_source = SEED_DATA_DIR / "assets" / "logo-512.png"
    logo_file: File | None = None

    if logo_source.is_file():
        try:
            logo_bytes = logo_source.read_bytes()
            s3 = get_s3_client()
            await s3.ensure_bucket_exists()
            logo_file = File(
                organization_id=org.id,
                owner_id=admin_user.id,
                access_mode=AccessMode.OPEN_TO_ORG,
                baseline_role=ContentRole.VIEWER,
                filename="uniffy-logo.png",
                original_filename="uniffy-logo.png",
                mime_type="image/png",
                size_bytes=len(logo_bytes),
                storage_key=f"{org.id}/assets/uniffy-logo.png",
                storage_bucket=s3.config.bucket_name,
                folder_id=None,
                description="Official Uniffy logo (512x512).",
                extraction_status=ExtractionStatus.SKIPPED,
            )
            session.add(logo_file)
            await session.flush()
            await session.refresh(logo_file)
            await s3.upload_bytes(
                key=logo_file.storage_key,
                data=logo_bytes,
                content_type="image/png",
            )
            await search_indexer.index(
                urn=build_content_urn(ContentType.FILE, logo_file.id),
                organization_id=org.id,
                title=logo_file.filename,
                entity_type=ContentType.FILE.value,
                url_path=f"/files/{logo_file.id}",
                owner_id=admin_user.id,
                access_mode=logo_file.access_mode.value,
                baseline_role=logo_file.baseline_role.value,
                keywords=logo_file.filename,
                description=logo_file.description,
            )
            logger.info(f"Seeded organization logo file ({len(logo_bytes)} bytes)")
        except Exception as exc:
            logger.warning(f"Skipping logo seed (S3 unavailable): {exc}")
            logo_file = None
    else:
        logger.warning(f"Logo asset missing at {logo_source}, skipping")

    canvas_content = _build_welcome_canvas(
        seed_notes=seed_notes,
        logo_file=logo_file,
    )

    canvas_note = Note(
        organization_id=org.id,
        owner_id=admin_user.id,
        parent_id=uniffy_folder.id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
        node_type=NodeType.CANVAS,
        title="Welcome to Uniffy",
        content="",
        canvas_content=canvas_content,
        slug="welcome-canvas",
        note_metadata={"system_generated": "true"},
        outgoing_references=(
            extract_all_outgoing_references_from_canvas(canvas_content, org.id) or None
        ),
    )
    session.add(canvas_note)
    await session.flush()
    await session.refresh(canvas_note)

    from uniffy.domains.tags.operations import TagOperations

    tag_ops = TagOperations(session)
    await tag_ops.assign(
        actor_id=admin_user.id,
        organization_id=org.id,
        content_urn=build_content_urn(ContentType.NOTE, canvas_note.id),
        tag_ids=tag_ids,
    )

    await search_indexer.index(
        urn=build_content_urn(ContentType.NOTE, canvas_note.id),
        organization_id=org.id,
        title=canvas_note.title,
        entity_type=ContentType.NOTE.value,
        url_path=f"/notes/{canvas_note.id}",
        access_mode=canvas_note.access_mode.value,
        baseline_role=canvas_note.baseline_role.value,
        owner_id=admin_user.id,
        keywords=" ".join(
            [canvas_note.title, "canvas", "overview", "workspace"]
        ),
        description=(
            "Visual tour of Uniffy - notes, files, chat, calendar, "
            "projects, and agents connected on one canvas."
        ),
        tags=tag_slugs,
    )
    logger.info("Seeded Welcome canvas note with interlinked content")


def _build_welcome_canvas(
    *,
    seed_notes: dict[str, Note],
    logo_file: File | None,
) -> dict[str, Any]:
    """Build the canvas JSON for the seeded Welcome note."""
    about = seed_notes["about"]
    plans = seed_notes["plans"]
    searching = seed_notes["searching"]
    sharing = seed_notes["sharing"]

    def note_urn(note: Note) -> str:
        return f"urn:uniffy:content:NOTE:{note.id}"

    domain_shapes = [
        ("domain-notes", "Notes", 180, 380, "#8b5cf6"),
        ("domain-chat", "Chat", 280, 580, "#a78bfa"),
        ("domain-files", "Files", 540, 660, "#3b82f6"),
        ("domain-calendar", "Calendar", 820, 580, "#f43f5e"),
        ("domain-projects", "Projects", 920, 380, "#f97316"),
        ("domain-agents", "Agents", 760, 180, "#06b6d4"),
    ]

    nodes: list[dict[str, Any]] = [
        {
            "id": "hub",
            "type": "shape",
            "position": {"x": 500, "y": 360},
            "width": 180,
            "height": 120,
            "data": {
                "type": "shape",
                "shape": "ellipse",
                "label": "Uniffy",
                "color": "#6366f1",
                "borderColor": "#4338ca",
                "borderWidth": 3,
            },
        },
        {
            "id": "mindmap-root",
            "type": "mindmap",
            "position": {"x": 80, "y": 240},
            "width": 200,
            "height": 48,
            "data": {
                "type": "mindmap",
                "label": "Uniffy is...",
                "mindmapId": "welcome-mindmap",
                "parentNodeId": None,
                "children": ["mindmap-c1", "mindmap-c2", "mindmap-c3"],
                "isRoot": True,
                "direction": "right",
                "branchColor": "#6366f1",
                "fontSize": 14,
                "bold": True,
            },
        },
        {
            "id": "mindmap-c1",
            "type": "mindmap",
            "position": {"x": 320, "y": 200},
            "width": 180,
            "height": 40,
            "data": {
                "type": "mindmap",
                "label": "Notes & canvases",
                "mindmapId": "welcome-mindmap",
                "parentNodeId": "mindmap-root",
                "children": [],
                "branchColor": "#8b5cf6",
                "fontSize": 13,
            },
        },
        {
            "id": "mindmap-c2",
            "type": "mindmap",
            "position": {"x": 320, "y": 248},
            "width": 180,
            "height": 40,
            "data": {
                "type": "mindmap",
                "label": "Files & media",
                "mindmapId": "welcome-mindmap",
                "parentNodeId": "mindmap-root",
                "children": [],
                "branchColor": "#3b82f6",
                "fontSize": 13,
            },
        },
        {
            "id": "mindmap-c3",
            "type": "mindmap",
            "position": {"x": 320, "y": 296},
            "width": 180,
            "height": 40,
            "data": {
                "type": "mindmap",
                "label": "Chat, calendar, projects, agents",
                "mindmapId": "welcome-mindmap",
                "parentNodeId": "mindmap-root",
                "children": [],
                "branchColor": "#f97316",
                "fontSize": 13,
            },
        },
    ]

    for shape_id, label, x, y, color in domain_shapes:
        nodes.append({
            "id": shape_id,
            "type": "shape",
            "position": {"x": x, "y": y},
            "width": 160,
            "height": 64,
            "data": {
                "type": "shape",
                "shape": "rect",
                "label": label,
                "color": color,
                "borderColor": color,
                "borderWidth": 2,
            },
        })

    note_cards = [
        ("note-about", about, 40, 820),
        ("note-searching", searching, 400, 820),
        ("note-sharing", sharing, 760, 820),
        ("note-plans", plans, 1120, 820),
    ]
    for card_id, note, x, y in note_cards:
        nodes.append({
            "id": card_id,
            "type": "note",
            "position": {"x": x, "y": y},
            "width": 340,
            "height": 280,
            "data": {
                "type": "note",
                "urn": note_urn(note),
                "noteId": str(note.id),
                "title": note.title,
                "borderColor": "#8b5cf6",
                "borderWidth": 2,
            },
        })

    if logo_file is not None:
        nodes.append({
            "id": "logo-media",
            "type": "media",
            "position": {"x": 1180, "y": 40},
            "width": 200,
            "height": 200,
            "data": {
                "type": "media",
                "fileId": str(logo_file.id),
                "mimeType": logo_file.mime_type,
                "filename": logo_file.filename,
                "borderColor": "#3b82f6",
                "borderWidth": 2,
            },
        })

    edges: list[dict[str, Any]] = []
    for shape_id, label, *_ in domain_shapes:
        edges.append({
            "id": f"hub-to-{shape_id}",
            "source": "hub",
            "target": shape_id,
            "data": {
                "label": label.lower(),
                "edgeShape": "smoothstep",
                "strokeWidth": 2,
            },
        })

    for card_id, _, *_ in note_cards:
        edges.append({
            "id": f"notes-to-{card_id}",
            "source": "domain-notes",
            "target": card_id,
            "data": {
                "edgeShape": "smoothstep",
                "strokeColor": "#8b5cf6",
                "strokeWidth": 2,
            },
        })

    if logo_file is not None:
        edges.append({
            "id": "files-to-logo",
            "source": "domain-files",
            "target": "logo-media",
            "data": {
                "label": "org asset",
                "edgeShape": "smoothstep",
                "strokeColor": "#3b82f6",
                "strokeWidth": 2,
            },
        })

    return {
        "version": 1,
        "viewport": {"x": 0, "y": 0, "zoom": 0.85},
        "nodes": nodes,
        "edges": edges,
        "defaults": {
            "edgeShape": "smoothstep",
            "edgeWidth": 2,
        },
    }


async def _seed_vapid_keys(session: AsyncSession, admin_email: str) -> None:
    """Generate a VAPID keypair and store it in deployment_settings, once."""
    import base64

    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    from uniffy.domains.deployment_settings.operations import DeploymentSettingsOperations

    settings = DeploymentSettingsOperations(session)

    # Regenerating the keypair would silently invalidate every existing push
    # subscription, so a present key means we leave it untouched.
    existing = await settings.get_namespace("push")
    if "vapid_public_key" in existing:
        return

    private_key = ec.generate_private_key(ec.SECP256R1())

    # VAPID requires base64url without padding (RFC 8292).
    priv_numbers = private_key.private_numbers()
    priv_bytes = priv_numbers.private_value.to_bytes(32, byteorder="big")
    priv_b64 = base64.urlsafe_b64encode(priv_bytes).rstrip(b"=").decode("ascii")

    pub_bytes = private_key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    pub_b64 = base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode("ascii")

    await settings.set(namespace="push", key="vapid_private_key", value=priv_b64, is_secret=True)
    await settings.set(namespace="push", key="vapid_public_key", value=pub_b64)
    await settings.set(
        namespace="push", key="vapid_contact_email", value=f"mailto:{admin_email}"
    )
    await session.flush()
    logger.info("Generated and stored VAPID keypair in deployment_settings")
