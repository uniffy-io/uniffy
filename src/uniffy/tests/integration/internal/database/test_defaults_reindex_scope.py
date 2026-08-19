"""The defaults-reindex page selects only rows whose policy follows the org default."""

import pytest
from sqlalchemy import delete

from uniffy.core.models.notes.note import Note
from uniffy.core.types import AccessMode, ContentRole, generate_id
from uniffy.workers.tasks.permissions_reindex import _keyset_query

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _note(env, access_mode: AccessMode | None, baseline_role: ContentRole | None = None) -> Note:
    return Note(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        title="itdb-defaults-scope",
        slug=f"itdb-{generate_id().hex[:8]}",
        access_mode=access_mode,
        baseline_role=baseline_role,
    )


async def test_page_selects_inheriting_rows_only(session, env) -> None:
    inheriting = _note(env, None)
    open_without_baseline = _note(env, AccessMode.OPEN_TO_ORG, None)
    open_with_baseline = _note(env, AccessMode.OPEN_TO_ORG, ContentRole.EDITOR)
    owner_only = _note(env, AccessMode.OWNER_ONLY)
    trashed = _note(env, None)
    trashed.is_deleted = True
    created = [inheriting, open_without_baseline, open_with_baseline, owner_only, trashed]
    session.add_all(created)
    await session.commit()
    created_ids = [note.id for note in created]

    try:
        rows = (await session.execute(_keyset_query(Note, env.org_id, None))).scalars().all()
        selected = {row.id for row in rows}

        assert inheriting.id in selected
        assert open_without_baseline.id in selected
        assert open_with_baseline.id not in selected
        assert owner_only.id not in selected
        assert trashed.id not in selected

        cursor = min(inheriting.id, open_without_baseline.id)
        after = (await session.execute(_keyset_query(Note, env.org_id, cursor))).scalars().all()
        assert cursor not in {row.id for row in after}
    finally:
        await session.rollback()
        await session.execute(delete(Note).where(Note.id.in_(created_ids)))
        await session.commit()
