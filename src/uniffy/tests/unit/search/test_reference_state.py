from unittest.mock import AsyncMock, MagicMock

from uniffy.core.content import reference_state
from uniffy.core.content.reference_state import ReferenceRowState, resolve_reference_states
from uniffy.core.types import ContentType, generate_id


async def test_reference_state_loaders_are_batched_by_content_type(monkeypatch) -> None:
    note_ids = {generate_id(), generate_id()}
    file_id = generate_id()
    note_loader = AsyncMock(
        return_value={next(iter(note_ids)): ReferenceRowState.LIVE},
    )
    file_loader = AsyncMock(return_value={file_id: ReferenceRowState.DELETED})
    monkeypatch.setattr(
        reference_state,
        "_REFERENCE_STATE_LOADERS",
        {
            ContentType.NOTE: note_loader,
            ContentType.FILE: file_loader,
        },
    )
    organization_id = generate_id()
    session = MagicMock()

    states = await resolve_reference_states(
        session,
        organization_id,
        {
            ContentType.NOTE: note_ids,
            ContentType.FILE: {file_id},
        },
    )

    note_loader.assert_awaited_once_with(session, organization_id, note_ids)
    file_loader.assert_awaited_once_with(session, organization_id, {file_id})
    assert sorted(state for (kind, _), state in states.items() if kind == ContentType.NOTE) == [
        ReferenceRowState.LIVE,
        ReferenceRowState.MISSING,
    ]
    assert states[(ContentType.FILE, file_id)] == ReferenceRowState.DELETED


async def test_unregistered_reference_type_remains_unclassified(monkeypatch) -> None:
    monkeypatch.setattr(reference_state, "_REFERENCE_STATE_LOADERS", {})

    states = await resolve_reference_states(
        MagicMock(),
        generate_id(),
        {ContentType.NOTE: {generate_id()}},
    )

    assert states == {}
