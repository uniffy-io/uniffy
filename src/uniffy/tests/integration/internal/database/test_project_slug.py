"""Renaming a project slug on real rows: task keys read it, so it is validated like creation."""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.view_config import ViewConfig
from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.projects.operations import ProjectOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _storage() -> ObjectStorage:
    storage = MagicMock(spec=ObjectStorage)
    storage.bucket_name = "test"
    return storage


async def _create_project(
    session: AsyncSession,
    env: SimpleNamespace,
    search_indexer: SearchIndexer,
    slug: str | None = None,
) -> Project:
    return await ProjectOperations(session, _storage(), search_indexer).create(
        user_id=env.admin_id,
        organization_id=env.org_id,
        name=f"Slugs {generate_id().hex[:10]}",
        access_mode=AccessMode.EXPLICIT_MEMBERS,
        slug=slug,
    )


async def _cleanup(session: AsyncSession, *project_ids: UUID) -> None:
    await session.rollback()
    for project_id in project_ids:
        await session.execute(delete(ViewConfig).where(ViewConfig.project_id == project_id))
        await session.execute(delete(FieldDefinition).where(FieldDefinition.project_id == project_id))
        await session.execute(delete(Project).where(Project.id == project_id))
    await session.commit()


async def test_rename_normalizes_and_keeps_the_requested_slug(
    session, env, search_indexer
) -> None:
    project = await _create_project(session, env, search_indexer, slug="SLGA")
    project_id = project.id
    try:
        renamed = await ProjectOperations(session, _storage(), search_indexer).update(
            env.admin_id, env.org_id, project_id, slug="slgb"
        )
        assert renamed.slug == "SLGB"
    finally:
        await _cleanup(session, project_id)


async def test_rename_rejects_a_slug_another_project_holds(session, env, search_indexer) -> None:
    taken = await _create_project(session, env, search_indexer, slug="SLGC")
    project = await _create_project(session, env, search_indexer, slug="SLGD")
    taken_id, project_id = taken.id, project.id
    try:
        with pytest.raises(ValidationError) as exc:
            await ProjectOperations(session, _storage(), search_indexer).update(
                env.admin_id, env.org_id, project_id, slug="SLGC"
            )
        assert exc.value.message == "Slug 'SLGC' is already used by another project"

        kept = await ProjectOperations(session, _storage(), search_indexer).get_by_id(
            env.admin_id, env.org_id, project_id
        )
        assert kept.slug == "SLGD"
    finally:
        await _cleanup(session, taken_id, project_id)


@pytest.mark.parametrize("slug", ["", "X", "2FAST", "TOOLONG", "AB-CD"])
async def test_rename_rejects_a_slug_task_keys_could_not_carry(
    session, env, search_indexer, slug
) -> None:
    project = await _create_project(session, env, search_indexer, slug="SLGE")
    project_id = project.id
    try:
        with pytest.raises(ValidationError) as exc:
            await ProjectOperations(session, _storage(), search_indexer).update(
                env.admin_id, env.org_id, project_id, slug=slug
            )
        assert "must be 2-5 uppercase letters/digits" in exc.value.message
    finally:
        await _cleanup(session, project_id)


async def test_keeping_the_current_slug_is_not_a_conflict(session, env, search_indexer) -> None:
    project = await _create_project(session, env, search_indexer, slug="SLGF")
    project_id = project.id
    try:
        updated = await ProjectOperations(session, _storage(), search_indexer).update(
            env.admin_id, env.org_id, project_id, name="Renamed", slug="slgf"
        )
        assert updated.slug == "SLGF"
        assert updated.name == "Renamed"
    finally:
        await _cleanup(session, project_id)
