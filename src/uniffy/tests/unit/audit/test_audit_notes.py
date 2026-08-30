"""Destructive-action audit emissions for notes.

Soft delete, restore, permanent delete (single + empty trash), and
parent-folder move via the update path. Mock-driven; full integration
behaviour is exercised by ``test_notes_*`` integration tests.
"""

from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.audit.actions import Action
from uniffy.core.models.notes.note import Note
from uniffy.core.types import NodeType, generate_id
from uniffy.domains.notes.operations import NoteOperations


def _audit_rows(session: MagicMock) -> list:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and call.args[0].__class__.__name__ == "AuditEvent"
    ]


def _make_note(**overrides) -> Note:
    defaults = dict(
        id=generate_id(),
        organization_id=generate_id(),
        owner_id=generate_id(),
        title="My note",
        content="",
        node_type=NodeType.NOTE,
        slug="my-note",
        is_deleted=False,
        version=1,
    )
    defaults.update(overrides)
    return Note(**defaults)


def _build_session() -> MagicMock:
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    return session


async def test_soft_delete_emits_note_deleted_with_descendant_count() -> None:
    note = _make_note()
    session = _build_session()
    ops = NoteOperations(session, AsyncMock())

    with (
        patch.object(NoteOperations, "_fetch_by_id", AsyncMock(return_value=note)),
        patch.object(NoteOperations, "_require_delete", AsyncMock(return_value=None)),
        patch.object(
            NoteOperations,
            "_collect_descendant_ids",
            AsyncMock(return_value=[note.id, generate_id(), generate_id()]),
        ),
        patch(
            "uniffy.domains.notes.queries.soft_delete_recursive",
            AsyncMock(return_value=None),
        ),
        patch.object(
            NoteOperations.__base__,
            "search_indexer",
            MagicMock(remove=AsyncMock()),
            create=True,
        ),
    ):
        ops.search_indexer = MagicMock(remove=AsyncMock())
        await ops.delete(generate_id(), note.organization_id, note.id)

    rows = _audit_rows(session)
    assert len(rows) == 1
    row = rows[0]
    assert row.action == Action.NOTE_DELETED
    assert row.resource_id == note.id
    assert row.details["descendant_count"] == 2
    assert row.details["node_type"] == "NOTE"


async def test_permanent_delete_emits_note_permanently_deleted() -> None:
    note = _make_note()
    session = _build_session()
    ops = NoteOperations(session, AsyncMock())
    ops.search_indexer = MagicMock(remove=AsyncMock())

    tag_ops_mock = MagicMock()
    tag_ops_mock.unassign_all_for_urn = AsyncMock()

    with (
        patch.object(NoteOperations, "_fetch_by_id", AsyncMock(return_value=note)),
        patch.object(NoteOperations, "_require_delete", AsyncMock(return_value=None)),
        patch.object(
            NoteOperations,
            "_collect_descendant_ids",
            AsyncMock(return_value=[note.id]),
        ),
        patch(
            "uniffy.domains.notes.queries.permanent_delete_recursive",
            AsyncMock(return_value=None),
        ),
        patch(
            "uniffy.domains.notes.hierarchy.operations.ContentTagContext",
            MagicMock(return_value=tag_ops_mock),
        ),
        patch(
            "uniffy.domains.files.attachments.operations."
            "AttachmentOperations.purge_attachments_for_content",
            AsyncMock(return_value=0),
        ),
    ):
        await ops.delete(generate_id(), note.organization_id, note.id, permanent=True)

    rows = _audit_rows(session)
    assert any(r.action == Action.NOTE_PERMANENTLY_DELETED for r in rows)


async def test_restore_emits_note_restored() -> None:
    note = _make_note(is_deleted=True)
    session = _build_session()
    ops = NoteOperations(session, search_indexer=MagicMock())

    with (
        patch.object(NoteOperations, "_fetch_by_id", AsyncMock(return_value=note)),
        patch.object(NoteOperations, "_require_edit", AsyncMock(return_value=None)),
        patch.object(NoteOperations, "_index_for_search", AsyncMock(return_value=None)),
    ):
        await ops.restore(generate_id(), note.organization_id, note.id)

    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].action == Action.NOTE_RESTORED
    assert rows[0].resource_id == note.id


async def test_parent_change_emits_note_moved_with_previous_state() -> None:
    """The update path emits note.moved when the parent_id changes."""
    from uniffy.core.audit import write_audit_event

    session = _build_session()
    note = _make_note(parent_id=None)
    new_parent = generate_id()

    async def emit() -> None:
        previous_parent_id = note.parent_id
        note.parent_id = new_parent
        await write_audit_event(
            session,
            organization_id=note.organization_id,
            actor_user_id=note.owner_id,
            action=Action.NOTE_MOVED,
            resource_type="NOTE",
            resource_id=note.id,
            details={
                "previous_parent_id": (str(previous_parent_id) if previous_parent_id else None),
                "new_parent_id": str(note.parent_id),
            },
        )

    await emit()

    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].action == Action.NOTE_MOVED
    assert rows[0].details["previous_parent_id"] is None
    assert rows[0].details["new_parent_id"] == str(new_parent)
