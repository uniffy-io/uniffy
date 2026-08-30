"""Organization-scoped bookmarks, a typed bookmark content type, and library scan indexes.

Revision ID: 090
Revises: 089
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "090"
down_revision: str | None = "089"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_content_type_enum = postgresql.ENUM(name="contenttype", create_type=False)

_GRAPH_SOURCE_PREDICATE = sa.text("is_deleted = false AND outgoing_references IS NOT NULL")
_GRAPH_SOURCE_TABLES = ("notes_notes", "projects_tasks", "calendar_events")


def _graph_index_name(table: str) -> str:
    return f"ix_{table}_org_updated_refs"


def upgrade() -> None:
    op.drop_constraint("uq_bookmarks_user_urn", "bookmarks", type_="unique")
    op.create_unique_constraint(
        "uq_bookmarks_user_org_urn",
        "bookmarks",
        ["user_id", "organization_id", "urn"],
    )

    op.add_column("bookmarks", sa.Column("content_type", _content_type_enum, nullable=True))
    # split_part over the canonical urn:uniffy:content:{TYPE}:{uuid} shape; rows whose
    # type is no longer a member of the enum cannot be projected and are dropped below.
    op.execute(
        """
        UPDATE bookmarks
        SET content_type = split_part(urn, ':', 4)::contenttype
        WHERE split_part(urn, ':', 4) IN (SELECT unnest(enum_range(NULL::contenttype))::text)
        """
    )
    op.execute("DELETE FROM bookmarks WHERE content_type IS NULL")
    op.alter_column("bookmarks", "content_type", nullable=False)

    op.create_index(
        "ix_bookmarks_user_org_created_id",
        "bookmarks",
        ["user_id", "organization_id", "created_at", "id"],
    )
    op.create_index(
        "ix_bookmarks_user_org_type_created_id",
        "bookmarks",
        ["user_id", "organization_id", "content_type", "created_at", "id"],
    )

    for table in _GRAPH_SOURCE_TABLES:
        op.create_index(
            _graph_index_name(table),
            table,
            ["organization_id", "updated_at"],
            postgresql_where=_GRAPH_SOURCE_PREDICATE,
        )


def downgrade() -> None:
    for table in reversed(_GRAPH_SOURCE_TABLES):
        op.drop_index(_graph_index_name(table), table_name=table)

    op.drop_index("ix_bookmarks_user_org_type_created_id", table_name="bookmarks")
    op.drop_index("ix_bookmarks_user_org_created_id", table_name="bookmarks")
    op.drop_column("bookmarks", "content_type")

    op.drop_constraint("uq_bookmarks_user_org_urn", "bookmarks", type_="unique")
    # The narrower constraint cannot hold once a user has saved the same URN in two
    # organizations, so drop the duplicates the wider scope allowed.
    op.execute(
        """
        DELETE FROM bookmarks a
        USING bookmarks b
        WHERE a.user_id = b.user_id
          AND a.urn = b.urn
          AND a.ctid > b.ctid
        """
    )
    op.create_unique_constraint(
        "uq_bookmarks_user_urn",
        "bookmarks",
        ["user_id", "urn"],
    )
