"""Project views gain ownership and typed definitions without losing what they held."""

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

import uniffy.core.models  # noqa: F401
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.infrastructure.database.session import ALEMBIC_INI_PATH, get_database_url
from uniffy.tests.integration.internal.migrations.test_migration_run import (
    _migrate_to,
    _provision_to,
    _query,
)

_LEGACY_VIEWS = {
    "view_table": ("Table", "table", True, {"visibleFieldIds": ["field_title"]}),
    "view_board": ("Board", "board", False, {"statusFieldId": "field_status"}),
    "view_roadmap": ("Roadmap", "roadmap", False, {"zoomLevel": "week"}),
    "view_abc": (
        "Custom",
        "board",
        False,
        {
            "visibleFieldIds": ["field_status", "__tags__", "field_status"],
            "columnWidths": {"field_status": 10, "__id__": 90},
            "sortFieldId": "field_due_date",
            "sortDirection": "desc",
        },
    ),
}


def _downgrade_to(revision: str) -> None:
    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    command.downgrade(config, revision)


async def _seed_legacy_projects() -> tuple[str, str, str]:
    engine = create_async_engine(get_database_url())
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            org = Organization(name="Views", slug="views")
            user = User(username="planner", email="planner@example.test")
            session.add_all([org, user])
            await session.flush()
            with_views, without_views = generate_id(), generate_id()
            for project_id, slug, default_view in (
                (with_views, "VW", "view_gone"),
                (without_views, "NV", None),
            ):
                await session.execute(
                    text(
                        "INSERT INTO projects_projects "
                        "(id, organization_id, owner_id, name, slug, access_mode, "
                        "default_view_id, created_at) "
                        "VALUES (:id, :org, :owner, :slug, :slug, 'OWNER_ONLY', :default, now())"
                    ),
                    {
                        "id": project_id,
                        "org": org.id,
                        "owner": user.id,
                        "slug": slug,
                        "default": default_view,
                    },
                )
            for view_id, (name, view_type, is_default, config) in _LEGACY_VIEWS.items():
                await session.execute(
                    text(
                        "INSERT INTO projects_views "
                        "(id, project_id, name, type, is_default, config, created_at) "
                        "VALUES (:id, :project, :name, :type, :is_default, "
                        "CAST(:config AS jsonb), now())"
                    ),
                    {
                        "id": view_id,
                        "project": with_views,
                        "name": name,
                        "type": view_type,
                        "is_default": is_default,
                        "config": dumps_str(config),
                    },
                )
            await session.commit()
            return str(with_views), str(without_views), str(user.id)
    finally:
        await engine.dispose()


def _views(project_id: str):
    return _query(
        "SELECT id, organization_id::text, owner_id::text, visibility::text, sort_order, "
        "definition FROM projects_views "
        f"WHERE project_id = '{project_id}' ORDER BY sort_order, id"
    )


async def test_views_gain_ownership_and_definitions(scratch_database: str) -> None:
    await _provision_to(scratch_database, "104")
    with_views, without_views, owner_id = await _seed_legacy_projects()

    _migrate_to("105")

    rows = _views(with_views)
    assert [row[0] for row in rows] == [
        "view_table",
        "view_board",
        "view_roadmap",
        "view_backlog",
        "view_graph",
        "view_resources",
        "view_abc",
    ]
    assert {row[2] for row in rows} == {owner_id}
    assert {row[3] for row in rows} == {"SHARED"}
    assert [row[4] for row in rows] == [0, 1, 2, 3, 4, 5, 100]
    by_id = {row[0]: row[5] for row in rows}
    assert by_id["view_roadmap"]["roadmap"] == {"zoom": "ROADMAP_ZOOM_WEEK"}
    assert by_id["view_abc"] == {
        "board": {},
        "visible_fields": [{"field_id": "field_status"}],
        "column_widths": [{"field": {"field_id": "field_status"}, "width": 40}],
        "sort": [{"field": {"field_id": "field_due_date"}, "direction": "SORT_DIRECTION_DESC"}],
    }
    org_ids = {row[1] for row in rows}
    assert len(org_ids) == 1 and None not in org_ids

    assert [row[0] for row in _views(without_views)] == [
        "view_table",
        "view_board",
        "view_roadmap",
        "view_backlog",
        "view_graph",
        "view_resources",
    ]
    defaults = dict(_query("SELECT id::text, default_view_id FROM projects_projects"))
    assert defaults == {with_views: "view_table", without_views: "view_table"}

    columns = {
        row[0]
        for row in _query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'projects_views'"
        )
    }
    assert "config" not in columns
    assert "is_default" not in columns


async def test_downgrade_restores_the_legacy_shape(scratch_database: str) -> None:
    await _provision_to(scratch_database, "104")
    with_views, _, _ = await _seed_legacy_projects()
    _migrate_to("105")

    _downgrade_to("104")

    rows = _query(
        "SELECT id, type, is_default, config FROM projects_views "
        f"WHERE project_id = '{with_views}' ORDER BY id"
    )
    assert [(row[0], row[2], row[3]) for row in rows] == [
        ("view_abc", False, {"type": "board"}),
        ("view_board", False, {"type": "board"}),
        ("view_roadmap", False, {"type": "roadmap"}),
        ("view_table", True, {"type": "table"}),
    ]
    assert _query("SELECT 1 FROM pg_type WHERE typname = 'projectviewvisibility'") == []
