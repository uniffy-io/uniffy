"""Group namespace: unique name and slug per org; drop the inert is_default flag.

Revision ID: 076
Revises: 075
Create Date: 2026-08-03
"""

import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "076"
down_revision: str | None = "075"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    return _SLUG_RE.sub("-", name.lower()).strip("-")[:240] or "group"


def upgrade() -> None:
    bind = op.get_bind()

    # Dedupe names case-insensitively per org before the unique index lands.
    # A TEAM outranks an ACCESS group for keeping its name, then the oldest
    # row wins; losers get a numeric suffix.
    rows = bind.execute(
        sa.text(
            """
            SELECT id, organization_id, name
            FROM login_groups
            ORDER BY organization_id,
                     CASE WHEN kind = 'TEAM' THEN 0 ELSE 1 END,
                     created_at,
                     id
            """
        )
    ).fetchall()

    taken: set[tuple[str, str]] = set()
    final_name: dict[str, str] = {}
    for row in rows:
        gid, org, name = str(row.id), str(row.organization_id), row.name
        candidate = name
        suffix = 1
        while (org, candidate.lower()) in taken:
            suffix += 1
            candidate = f"{name[:250]} {suffix}"
        taken.add((org, candidate.lower()))
        final_name[gid] = candidate
        if candidate != name:
            bind.execute(
                sa.text("UPDATE login_groups SET name = :name WHERE id = :id"),
                {"name": candidate, "id": gid},
            )

    # Re-derive every slug from the final name so slugs follow one derivation,
    # then dedupe per org with the same priority order.
    taken_slugs: set[tuple[str, str]] = set()
    for row in rows:
        gid, org = str(row.id), str(row.organization_id)
        base = _slugify(final_name[gid])
        candidate = base
        suffix = 1
        while (org, candidate) in taken_slugs:
            suffix += 1
            candidate = f"{base}-{suffix}"
        taken_slugs.add((org, candidate))
        bind.execute(
            sa.text("UPDATE login_groups SET slug = :slug WHERE id = :id"),
            {"slug": candidate, "id": gid},
        )

    op.create_index(
        "uq_login_groups_org_name_lower",
        "login_groups",
        ["organization_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_unique_constraint(
        "uq_login_groups_org_slug", "login_groups", ["organization_id", "slug"]
    )
    op.drop_column("login_groups", "is_default")


def downgrade() -> None:
    op.add_column(
        "login_groups",
        sa.Column(
            "is_default", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.drop_constraint("uq_login_groups_org_slug", "login_groups", type_="unique")
    op.drop_index("uq_login_groups_org_name_lower", table_name="login_groups")
