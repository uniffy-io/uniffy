"""
Stress test seed script for generating large amounts of test data.

Usage:
    uv run -m uniffy.seed.stress [OPTIONS]

Options:
    --notes         Number of notes to generate (default: 1000)
    --folders       Number of folders to generate (default: 50)
    --max-depth     Maximum folder nesting depth (default: 4)
    --ref-chains    Number of reference chains to create (default: 100)
    --max-chain     Maximum chain length (default: 5)
    --tags          Number of unique tags to use (default: 30)
    --dry-run       Print stats without writing to database
"""

import argparse
import asyncio
import random
import re
from dataclasses import dataclass
from uuid import UUID

from loguru import logger


@dataclass
class StressConfig:
    """Configuration for stress test data generation."""

    note_count: int = 1000
    folder_count: int = 50
    max_folder_depth: int = 4
    ref_chain_count: int = 100
    max_chain_length: int = 5
    tag_count: int = 30
    dry_run: bool = False


# Sample data for realistic content generation
ADJECTIVES = [
    "Quick",
    "Lazy",
    "Happy",
    "Sad",
    "Bright",
    "Dark",
    "Old",
    "New",
    "Big",
    "Small",
    "Fast",
    "Slow",
    "Hot",
    "Cold",
    "Soft",
    "Hard",
    "Light",
    "Heavy",
    "Clean",
    "Dirty",
    "Fresh",
    "Stale",
    "Sweet",
    "Sour",
    "Sharp",
    "Dull",
    "Smooth",
    "Rough",
    "Wet",
    "Dry",
]

NOUNS = [
    "Project",
    "Report",
    "Meeting",
    "Plan",
    "Design",
    "Review",
    "Analysis",
    "Summary",
    "Draft",
    "Notes",
    "Ideas",
    "Tasks",
    "Goals",
    "Updates",
    "Research",
    "Strategy",
    "Budget",
    "Timeline",
    "Roadmap",
    "Proposal",
    "Documentation",
    "Guide",
    "Tutorial",
    "Overview",
    "Checklist",
    "Template",
    "Archive",
    "Reference",
    "Index",
    "Changelog",
]

TOPICS = [
    "engineering",
    "marketing",
    "sales",
    "product",
    "design",
    "operations",
    "finance",
    "hr",
    "legal",
    "support",
    "infrastructure",
    "security",
    "analytics",
    "growth",
    "partnerships",
    "content",
    "community",
    "devops",
    "qa",
    "research",
]

VERBS = [
    "implement",
    "review",
    "update",
    "create",
    "delete",
    "modify",
    "analyze",
    "test",
    "deploy",
    "monitor",
    "optimize",
    "refactor",
    "document",
    "validate",
    "integrate",
]

LOREM_SENTENCES = [
    "This document outlines the key objectives and milestones for the upcoming quarter.",
    "We need to ensure all stakeholders are aligned on the proposed changes.",
    "The team has made significant progress on the core functionality.",
    "Further analysis is required before we can proceed with the implementation.",
    "Please review the attached materials and provide feedback by end of week.",
    "The metrics indicate a positive trend in user engagement.",
    "We should schedule a follow-up meeting to discuss the next steps.",
    "The current approach has some limitations that need to be addressed.",
    "This builds upon the foundation established in the previous iteration.",
    "Consider the trade-offs between performance and maintainability.",
    "The proposed solution addresses the main pain points identified.",
    "We recommend a phased rollout to minimize risk.",
    "The data suggests we should pivot our strategy.",
    "Cross-functional collaboration will be essential for success.",
    "Let's document our learnings for future reference.",
]


def generate_tags(count: int) -> list[str]:
    """Generate a list of unique tags."""
    base_tags = [
        "important",
        "urgent",
        "draft",
        "review",
        "approved",
        "archived",
        "todo",
        "in-progress",
        "done",
        "blocked",
        "backlog",
        "sprint",
        "q1",
        "q2",
        "q3",
        "q4",
        "2024",
        "2025",
        "2026",
        "internal",
        "external",
        "confidential",
        "public",
    ]
    topic_tags = [f"{topic}" for topic in TOPICS]
    action_tags = [f"{verb}" for verb in VERBS[:10]]

    all_tags = base_tags + topic_tags + action_tags
    return all_tags[:count] if count <= len(all_tags) else all_tags


def generate_title(index: int) -> str:
    """Generate a realistic note title with unique index suffix."""
    patterns = [
        lambda: f"{random.choice(ADJECTIVES)} {random.choice(NOUNS)}",
        lambda: f"{random.choice(TOPICS).title()} {random.choice(NOUNS)}",
        lambda: f"{random.choice(NOUNS)} - {random.choice(TOPICS).title()}",
        lambda: f"[{random.choice(VERBS).upper()}] {random.choice(NOUNS)}",
        lambda: f"{random.choice(NOUNS)} v{random.randint(1, 5)}.{random.randint(0, 9)}",
    ]
    base_title = random.choice(patterns)()
    return f"{base_title} #{index + 1}"


def generate_folder_name(index: int) -> str:
    """Generate a realistic folder name with unique index suffix."""
    suffixes = ["Docs", "Notes", "Archive", "Resources"]
    prefixes = ["Team", "Project", "Client", "Internal"]
    patterns = [
        lambda: random.choice(TOPICS).title(),
        lambda: f"{random.choice(TOPICS).title()} {random.choice(suffixes)}",
        lambda: f"Q{random.randint(1, 4)} {random.randint(2024, 2026)}",
        lambda: f"{random.choice(prefixes)} {random.choice(NOUNS)}",
    ]
    base_name = random.choice(patterns)()
    return f"{base_name} #{index + 1}"


def generate_slug(title: str, index: int) -> str:
    """Generate a URL-friendly slug from title."""
    # Remove special characters and convert to lowercase
    slug = re.sub(r"[^\w\s-]", "", title.lower())
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return f"{slug}-{index}"


def generate_content(
    references: list[tuple[str, UUID]] | None = None,
    inline_tags: list[str] | None = None,
) -> str:
    """
    Generate realistic markdown content with optional references and inline tags.

    Args:
        references: List of (title, note_id) tuples to reference.
        inline_tags: List of tags to include inline.

    Returns:
        Markdown content string.
    """
    paragraphs = []

    # Opening paragraph
    paragraphs.append(random.choice(LOREM_SENTENCES))

    # Add some bullet points
    if random.random() > 0.5:
        bullets = random.sample(LOREM_SENTENCES, min(3, len(LOREM_SENTENCES)))
        bullet_list = "\n".join(f"- {b}" for b in bullets)
        paragraphs.append(f"\n## Key Points\n\n{bullet_list}")

    # Add references as mentions
    if references:
        ref_text = "\n\n## Related Notes\n\n"
        for title, note_id in references:
            urn = f"urn:uniffy:content:NOTE:{note_id}"
            ref_text += f"- See [[[{title}|{urn}]]] for more details.\n"
        paragraphs.append(ref_text)

    # Add inline tags
    if inline_tags:
        tag_text = "\n\n---\n\n"
        tag_text += " ".join(f"#{tag}" for tag in inline_tags)
        paragraphs.append(tag_text)

    # Add more content
    extra_sentences = random.sample(LOREM_SENTENCES, random.randint(2, 5))
    paragraphs.append("\n\n" + " ".join(extra_sentences))

    return "\n\n".join(paragraphs)


def build_note_urn(note_id: UUID) -> str:
    """Build a URN string for a note."""
    return f"urn:uniffy:content:NOTE:{note_id}"


def extract_urns_from_content(content: str) -> list[str]:
    """Extract URNs from mention patterns in content."""
    pattern = r"\[\[\[[^\|]+\|(urn:uniffy:content:[A-Z_]+:[a-f0-9-]+)\]\]\]"
    matches = re.findall(pattern, content)
    return list(set(matches))


async def run_stress_seed(config: StressConfig) -> None:
    """
    Generate stress test data.

    Args:
        config: Configuration for data generation.
    """
    from dotenv import load_dotenv
    from sqlalchemy import select

    from uniffy.core.models import Note, Organization, User
    from uniffy.core.search.indexer import SearchIndexer, build_content_urn
    from uniffy.core.search.meilisearch import init_meilisearch
    from uniffy.core.types import AccessMode, ContentRole, ContentType, NodeType
    from uniffy.db.session import close_db, init_db, open_session

    # Load environment variables
    load_dotenv()

    logger.info(f"Starting stress seed with config: {config}")

    if config.dry_run:
        logger.info("DRY RUN - No data will be written")
        logger.info(f"  Would create {config.folder_count} folders")
        logger.info(f"  Would create {config.note_count} notes")
        logger.info(
            f"  Would create {config.ref_chain_count} reference chains "
            f"(max length {config.max_chain_length})"
        )
        logger.info(f"  Using {config.tag_count} unique tags")
        return

    # Initialize database and search
    await init_db()
    await init_meilisearch()

    try:
        async with open_session() as session:
            # Get the default organization and admin user
            result = await session.execute(
                select(Organization).where(Organization.slug == "default")
            )
            org = result.scalar_one_or_none()

            if not org:
                logger.error("Default organization not found. Run normal seed first.")
                return

            result = await session.execute(select(User).where(User.username == "admin"))
            admin = result.scalar_one_or_none()

            if not admin:
                logger.error("Admin user not found. Run normal seed first.")
                return

            # Check for existing stress test data
            result = await session.execute(
                select(Note)
                .where(
                    Note.organization_id == org.id,
                    Note.slug.like("stress-%"),
                )
                .limit(1)
            )
            existing = result.scalar_one_or_none()

            if existing:
                logger.warning("Stress test data already exists. Skipping.")
                logger.info("To regenerate, delete notes with slug starting with 'stress-'")
                return

            logger.info(f"Generating stress test data for org: {org.name}")

            try:
                # Generate available tags
                available_tags = generate_tags(config.tag_count)
                logger.info(f"Using {len(available_tags)} tags: {available_tags[:10]}...")

                # Phase 1: Create folder structure
                logger.info(f"Creating {config.folder_count} folders...")
                folders: list[Note] = []

                # Create root stress folder
                stress_root = Note(
                    organization_id=org.id,
                    owner_id=admin.id,
                    access_mode=AccessMode.OPEN_TO_ORG,
                    baseline_role=ContentRole.VIEWER,
                    node_type=NodeType.FOLDER,
                    title="Stress Test Data",
                    slug="stress-root",
                )
                session.add(stress_root)
                await session.flush()
                await session.refresh(stress_root)
                folders.append(stress_root)
                logger.info("  Created root folder")

                # Create nested folders level by level for proper hierarchy
                current_level = [stress_root]
                folder_idx = 0
                remaining = config.folder_count - 1

                for depth in range(1, config.max_folder_depth + 1):
                    if remaining <= 0:
                        break

                    # Distribute ~equal folders per level, more at shallower levels
                    level_count = min(
                        remaining, max(1, remaining // (config.max_folder_depth - depth + 1))
                    )
                    next_level = []

                    for _ in range(level_count):
                        parent = random.choice(current_level)
                        folder = Note(
                            organization_id=org.id,
                            owner_id=admin.id,
                            parent_id=parent.id,
                            access_mode=AccessMode.OPEN_TO_ORG,
                            baseline_role=ContentRole.VIEWER,
                            node_type=NodeType.FOLDER,
                            title=generate_folder_name(folder_idx),
                            slug=f"stress-folder-{folder_idx}",
                        )
                        session.add(folder)
                        folders.append(folder)
                        next_level.append(folder)
                        folder_idx += 1

                    await session.flush()
                    for f in next_level:
                        await session.refresh(f)
                    logger.info(f"  Created {len(next_level)} folders at depth {depth}")

                    remaining -= level_count
                    current_level = next_level if next_level else current_level

                logger.info(f"Created {len(folders)} folders total")

                # Phase 2: Create notes
                logger.info(f"Creating {config.note_count} notes...")
                notes: list[Note] = []
                batch_size = 100

                for i in range(config.note_count):
                    parent = random.choice(folders)

                    inline_tag_list = (
                        random.sample(available_tags, random.randint(0, 3))
                        if random.random() > 0.4
                        else None
                    )

                    title = generate_title(i)
                    content = generate_content(inline_tags=inline_tag_list)

                    note = Note(
                        organization_id=org.id,
                        owner_id=admin.id,
                        parent_id=parent.id,
                        access_mode=AccessMode.OPEN_TO_ORG,
                        baseline_role=ContentRole.VIEWER,
                        node_type=NodeType.NOTE,
                        title=title,
                        content=content,
                        slug=generate_slug(title, i),
                    )
                    session.add(note)
                    notes.append(note)

                    # Log progress every batch_size notes
                    if (i + 1) % batch_size == 0:
                        logger.info(f"  Prepared {i + 1}/{config.note_count} notes...")

                logger.info(f"  Total notes in list: {len(notes)}")

                # Flush all notes
                await session.flush()
                logger.info(f"  Flushed all {len(notes)} notes to database")

                logger.info(f"Created {len(notes)} notes")

                # Phase 3: Create reference chains
                logger.info(f"Creating {config.ref_chain_count} reference chains...")
                notes_with_refs: set[int] = set()

                for chain_idx in range(config.ref_chain_count):
                    chain_length = random.randint(2, config.max_chain_length)

                    available_indices = [i for i in range(len(notes)) if i not in notes_with_refs]
                    if len(available_indices) < chain_length:
                        available_indices = list(range(len(notes)))

                    chain_indices = random.sample(
                        available_indices, min(chain_length, len(available_indices))
                    )

                    # Create chain: note[0] -> note[1] -> note[2] -> ...
                    for j in range(len(chain_indices) - 1):
                        source_idx = chain_indices[j]
                        target_idx = chain_indices[j + 1]

                        source_note = notes[source_idx]
                        target_note = notes[target_idx]

                        ref_text = (
                            f"\n\nSee also: "
                            f"[[[{target_note.title}|{build_note_urn(target_note.id)}]]]"
                        )
                        source_note.content += ref_text
                        source_note.outgoing_references = (
                            extract_urns_from_content(source_note.content) or None
                        )
                        notes_with_refs.add(source_idx)

                    if (chain_idx + 1) % 20 == 0:
                        await session.flush()
                        logger.info(f"  Created {chain_idx + 1}/{config.ref_chain_count} chains")

                await session.flush()
                logger.info(f"Created {config.ref_chain_count} reference chains")
                logger.info(f"Notes with outgoing references: {len(notes_with_refs)}")

                # Phase 4: Index all content for search
                logger.info("Indexing content for search...")
                search_indexer = SearchIndexer(session)

                all_items = folders + notes
                for idx, item in enumerate(all_items):
                    await search_indexer.index(
                        urn=build_content_urn(ContentType.NOTE, item.id),
                        organization_id=org.id,
                        title=item.title,
                        entity_type=ContentType.NOTE.value,
                        url_path=f"/notes/{item.id}",
                        access_mode=item.access_mode.value,
                        baseline_role=(
                            item.baseline_role.value if item.baseline_role is not None else None
                        ),
                        owner_id=admin.id,
                        keywords=item.title,
                        description=item.content[:200] if item.content else None,
                    )

                    if (idx + 1) % 200 == 0:
                        logger.info(f"  Indexed {idx + 1}/{len(all_items)} items")

                logger.info(f"Indexed {len(all_items)} items for search")

                # Commit everything
                await session.commit()
                logger.info("Stress seed completed successfully!")

                # Print summary
                logger.info("=" * 50)
                logger.info("SUMMARY")
                logger.info("=" * 50)
                logger.info(f"Folders created: {len(folders)}")
                logger.info(f"Notes created: {len(notes)}")
                logger.info(f"Reference chains: {config.ref_chain_count}")
                logger.info(f"Notes with references: {len(notes_with_refs)}")
                logger.info(f"Notes without references: {len(notes) - len(notes_with_refs)}")
                logger.info(f"Unique tags used: {len(available_tags)}")

            except Exception as e:
                await session.rollback()
                logger.error(f"Failed to generate stress test data: {e}")
                raise
    finally:
        await close_db()


def main() -> None:
    """Entry point for stress seed script."""
    parser = argparse.ArgumentParser(
        description="Generate stress test data for Uniffy",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--notes",
        type=int,
        default=1000,
        help="Number of notes to generate",
    )
    parser.add_argument(
        "--folders",
        type=int,
        default=50,
        help="Number of folders to generate",
    )
    parser.add_argument(
        "--max-depth",
        type=int,
        default=4,
        help="Maximum folder nesting depth",
    )
    parser.add_argument(
        "--ref-chains",
        type=int,
        default=100,
        help="Number of reference chains to create",
    )
    parser.add_argument(
        "--max-chain",
        type=int,
        default=5,
        help="Maximum reference chain length",
    )
    parser.add_argument(
        "--tags",
        type=int,
        default=30,
        help="Number of unique tags to use",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print stats without writing to database",
    )

    args = parser.parse_args()

    config = StressConfig(
        note_count=args.notes,
        folder_count=args.folders,
        max_folder_depth=args.max_depth,
        ref_chain_count=args.ref_chains,
        max_chain_length=args.max_chain,
        tag_count=args.tags,
        dry_run=args.dry_run,
    )

    asyncio.run(run_stress_seed(config))


if __name__ == "__main__":
    main()
