"""Give project views an owner, a visibility, an order and a typed definition.

Revision ID: 106
Revises: 105
Create Date: 2026-09-17
"""

from collections.abc import Sequence
from math import isfinite
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from uniffy.core.json_codec import dumps_str

revision: str = "106"
down_revision: str | None = "105"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_visibility_enum = postgresql.ENUM(
    "PERSONAL",
    "SHARED",
    name="projectviewvisibility",
    create_type=False,
)


def _fields(*field_ids: str) -> list[dict[str, str]]:
    return [{"field_id": field_id} for field_id in field_ids]


# id -> (name, type, definition); the stored shape of the application's default views.
SEED_VIEWS: dict[str, tuple[str, str, dict[str, Any]]] = {
    "view_table": (
        "Table",
        "table",
        {
            "table": {},
            "visible_fields": _fields(
                "field_title", "field_status", "field_priority", "field_assignee", "field_due_date"
            ),
        },
    ),
    "view_board": (
        "Board",
        "board",
        {
            "board": {},
            "visible_fields": _fields("field_priority", "field_assignee", "field_due_date"),
        },
    ),
    "view_roadmap": (
        "Roadmap",
        "roadmap",
        {
            "roadmap": {"zoom": "ROADMAP_ZOOM_WEEK"},
            "visible_fields": _fields("field_status", "field_priority"),
        },
    ),
    "view_backlog": ("Backlog", "backlog", {"backlog": {}}),
    "view_graph": ("Graph", "graph", {"graph": {}}),
    "view_resources": ("Resources", "resources", {"resources": {}}),
}
_LAYOUTS = ("table", "board", "roadmap", "backlog", "graph", "resources")
_ZOOMS = {"day": "ROADMAP_ZOOM_DAY", "week": "ROADMAP_ZOOM_WEEK", "month": "ROADMAP_ZOOM_MONTH"}
_BATCH_SIZE = 500


def _is_field_id(value: Any) -> bool:
    return isinstance(value, str) and bool(value) and not value.startswith("__")


def _translate_config(view_type: str, config: Any) -> dict[str, Any]:
    """Carry the parts of a free-form config that still mean something."""
    config = config if isinstance(config, dict) else {}
    layout = view_type if view_type in _LAYOUTS else "table"
    layout_settings: dict[str, Any] = {}
    zoom = config.get("zoomLevel")
    if layout == "roadmap" and isinstance(zoom, str) and zoom in _ZOOMS:
        layout_settings["zoom"] = _ZOOMS[zoom]
    definition: dict[str, Any] = {layout: layout_settings}

    visible: list[str] = []
    raw_visible = config.get("visibleFieldIds")
    for field_id in raw_visible if isinstance(raw_visible, list) else []:
        if _is_field_id(field_id) and field_id not in visible:
            visible.append(field_id)
    if visible:
        definition["visible_fields"] = _fields(*visible)

    widths = []
    raw_widths = config.get("columnWidths")
    for field_id, width in (raw_widths if isinstance(raw_widths, dict) else {}).items():
        if not _is_field_id(field_id) or type(width) not in (int, float):
            continue
        if isinstance(width, float) and not isfinite(width):
            continue
        widths.append({"field": {"field_id": field_id}, "width": int(min(max(width, 40), 2000))})
    if widths:
        definition["column_widths"] = widths

    sort_field = config.get("sortFieldId")
    if _is_field_id(sort_field):
        direction = (
            "SORT_DIRECTION_DESC" if config.get("sortDirection") == "desc" else "SORT_DIRECTION_ASC"
        )
        definition["sort"] = [{"field": {"field_id": sort_field}, "direction": direction}]
    return definition


def _rewrite_definitions(bind: sa.Connection) -> None:
    statement = sa.text(
        "UPDATE projects_views SET definition = CAST(:definition AS jsonb), "
        "sort_order = COALESCE(:sort_order, sort_order) "
        "WHERE id = :id AND project_id = :project_id"
    )
    cursor = None
    while True:
        where = "WHERE (id, project_id) > (:id, :project_id) " if cursor else ""
        parameters: dict[str, Any] = {"limit": _BATCH_SIZE}
        if cursor:
            parameters.update(id=cursor[0], project_id=cursor[1])
        rows = bind.execute(
            sa.text(
                "SELECT id, project_id, type, config FROM projects_views "
                + where
                + "ORDER BY id, project_id LIMIT :limit"
            ),
            parameters,
        ).all()
        if not rows:
            return

        updates = []
        for row in rows:
            if row.id in SEED_VIEWS:
                _, _, definition = SEED_VIEWS[row.id]
                sort_order = list(SEED_VIEWS).index(row.id)
            else:
                definition = _translate_config(row.type, row.config)
                sort_order = None
            updates.append({
                "id": row.id,
                "project_id": row.project_id,
                "definition": dumps_str(definition),
                "sort_order": sort_order,
            })
        bind.execute(statement, updates)
        cursor = (rows[-1].id, rows[-1].project_id)


def upgrade() -> None:
    bind = op.get_bind()
    postgresql.ENUM("PERSONAL", "SHARED", name="projectviewvisibility").create(bind, checkfirst=True)

    op.add_column("projects_views", sa.Column("organization_id", sa.Uuid(), nullable=True))
    op.add_column("projects_views", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.add_column("projects_views", sa.Column("visibility", _visibility_enum, nullable=True))
    op.add_column("projects_views", sa.Column("sort_order", sa.Integer(), nullable=True))
    op.add_column(
        "projects_views",
        sa.Column("definition", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    op.execute(
        """
        UPDATE projects_views AS view
        SET organization_id = project.organization_id,
            owner_id = project.owner_id,
            visibility = 'SHARED'
        FROM projects_projects AS project
        WHERE project.id = view.project_id
        """
    )
    # Views that are not one of the defaults queue after them, oldest first.
    op.execute(
        """
        UPDATE projects_views AS view
        SET sort_order = ranked.position
        FROM (
            SELECT id, project_id,
                   99 + row_number() OVER (PARTITION BY project_id ORDER BY created_at, id)
                       AS position
            FROM projects_views
        ) AS ranked
        WHERE ranked.id = view.id AND ranked.project_id = view.project_id
        """
    )
    _rewrite_definitions(bind)

    insert = sa.text(
        """
        INSERT INTO projects_views (
            id, project_id, organization_id, owner_id, name, type, visibility,
            sort_order, definition, created_at, updated_at
        )
        SELECT :id, project.id, project.organization_id, project.owner_id, :name, :type,
               'SHARED', :sort_order, CAST(:definition AS jsonb), now(), now()
        FROM projects_projects AS project
        WHERE NOT EXISTS (
            SELECT 1 FROM projects_views AS view
            WHERE view.project_id = project.id AND view.id = :id
        )
        """
    )
    for view_id in SEED_VIEWS:
        name, view_type, definition = SEED_VIEWS[view_id]
        bind.execute(
            insert,
            {
                "id": view_id,
                "name": name,
                "type": view_type,
                "sort_order": list(SEED_VIEWS).index(view_id),
                "definition": dumps_str(definition),
            },
        )

    op.execute(
        """
        UPDATE projects_projects AS project
        SET default_view_id = 'view_table'
        WHERE default_view_id IS NULL
           OR NOT EXISTS (
               SELECT 1 FROM projects_views AS view
               WHERE view.project_id = project.id AND view.id = project.default_view_id
           )
        """
    )

    op.alter_column("projects_views", "organization_id", nullable=False)
    op.alter_column("projects_views", "owner_id", nullable=False)
    op.alter_column("projects_views", "visibility", nullable=False)
    op.alter_column("projects_views", "sort_order", nullable=False, server_default="0")
    op.alter_column("projects_views", "definition", nullable=False)
    op.create_foreign_key(
        "fk_projects_views_organization_id",
        "projects_views",
        "login_organizations",
        ["organization_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_projects_views_owner_id",
        "projects_views",
        "login_users",
        ["owner_id"],
        ["id"],
    )
    op.create_index("ix_projects_views_organization_id", "projects_views", ["organization_id"])
    op.create_index(
        "ix_projects_views_scope", "projects_views", ["project_id", "visibility", "owner_id"]
    )

    op.drop_column("projects_views", "config")
    op.drop_column("projects_views", "is_default")


def downgrade() -> None:
    op.add_column(
        "projects_views",
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "projects_views",
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.execute("DELETE FROM projects_views WHERE visibility = 'PERSONAL'")
    op.execute(
        """
        UPDATE projects_projects AS project
        SET default_view_id = NULL
        WHERE default_view_id IN (
            SELECT id FROM projects_views
            WHERE project_id = project.id AND type IN ('backlog', 'graph', 'resources')
        )
        """
    )
    op.execute("DELETE FROM projects_views WHERE type IN ('backlog', 'graph', 'resources')")
    op.execute("UPDATE projects_views SET config = jsonb_build_object('type', type)")
    op.execute(
        """
        UPDATE projects_views AS view
        SET is_default = true
        FROM projects_projects AS project
        WHERE project.id = view.project_id AND project.default_view_id = view.id
        """
    )

    op.drop_index("ix_projects_views_scope", table_name="projects_views")
    op.drop_index("ix_projects_views_organization_id", table_name="projects_views")
    op.drop_constraint("fk_projects_views_owner_id", "projects_views", type_="foreignkey")
    op.drop_constraint("fk_projects_views_organization_id", "projects_views", type_="foreignkey")
    op.drop_column("projects_views", "definition")
    op.drop_column("projects_views", "sort_order")
    op.drop_column("projects_views", "visibility")
    op.drop_column("projects_views", "owner_id")
    op.drop_column("projects_views", "organization_id")
    postgresql.ENUM(name="projectviewvisibility").drop(op.get_bind(), checkfirst=True)
