"""The Welcome canvas seeded alongside the starter docs notes."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from loguru import logger

from uniffy.core.data_files import DATA_DIR

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

    from uniffy.core.models import Note, Organization, User
    from uniffy.core.models.files.file import File
    from uniffy.core.search.indexer import SearchIndexer
    from uniffy.core.storage import ObjectStorage

logger = logger.bind(component="organizations.starter.canvas")


async def seed_welcome_canvas(
    *,
    session: AsyncSession,
    org: Organization,
    admin_user: User,
    uniffy_folder: Note,
    seed_notes: dict[str, Note],
    search_indexer: SearchIndexer,
    storage: ObjectStorage | None,
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
    from uniffy.core.types import AccessMode, ContentRole, ContentType, NodeType

    logo_source = DATA_DIR / "assets" / "logo-512.png"
    logo_file: File | None = None

    if logo_source.is_file() and storage is not None:
        try:
            logo_bytes = logo_source.read_bytes()
            await storage.ensure_bucket_exists()
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
                storage_bucket=storage.bucket_name,
                folder_id=None,
                description="Official Uniffy logo (512x512).",
                extraction_status=ExtractionStatus.SKIPPED,
            )
            session.add(logo_file)
            await session.flush()
            await session.refresh(logo_file)
            await storage.upload_bytes(
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
    elif not logo_source.is_file():
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
        keywords=" ".join([canvas_note.title, "canvas", "overview", "workspace"]),
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
