"""Seed default filter presets for all organizations.

Inserts 7 built-in "Quick Filters" (Documents, Images, Videos, Audio,
Archives, Large Files, Recent Files) for every existing organization.
Each preset is owned by the org's OWNER-role member.

Revision ID: 015
Revises: 014
Create Date: 2026-02-09

"""

import json
from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

revision: str = "015"
down_revision: str | None = "014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PRESETS = [
    {
        "name": "Documents",
        "icon": {"type": "icon", "value": "FileDoc"},
        "criteria": {"mime_categories": ["document"]},
        "sort_by": "updated_at",
        "sort_order": "desc",
    },
    {
        "name": "Images",
        "icon": {"type": "icon", "value": "FileImage"},
        "criteria": {"mime_categories": ["image"]},
        "sort_by": "updated_at",
        "sort_order": "desc",
    },
    {
        "name": "Videos",
        "icon": {"type": "icon", "value": "FileVideo"},
        "criteria": {"mime_categories": ["video"]},
        "sort_by": "updated_at",
        "sort_order": "desc",
    },
    {
        "name": "Audio",
        "icon": {"type": "icon", "value": "FileAudio"},
        "criteria": {"mime_categories": ["audio"]},
        "sort_by": "updated_at",
        "sort_order": "desc",
    },
    {
        "name": "Archives",
        "icon": {"type": "icon", "value": "FileZip"},
        "criteria": {"mime_categories": ["archive"]},
        "sort_by": "updated_at",
        "sort_order": "desc",
    },
    {
        "name": "Large Files",
        "icon": {"type": "icon", "value": "HardDrive"},
        "criteria": {"size_min_bytes": 104857600},
        "sort_by": "size_bytes",
        "sort_order": "desc",
    },
    {
        "name": "Recent Files",
        "icon": {"type": "icon", "value": "Clock"},
        "criteria": {},
        "sort_by": "created_at",
        "sort_order": "desc",
    },
]


def upgrade() -> None:
    """Insert default filter presets for every existing organization."""
    conn = op.get_bind()

    # Find each org and its OWNER member
    orgs = conn.execute(
        text(
            "SELECT om.organization_id, om.user_id "
            "FROM login_organization_members om "
            "WHERE om.role = 'OWNER'"
        )
    ).fetchall()

    for org_id, owner_id in orgs:
        for preset in PRESETS:
            conn.execute(
                text(
                    "INSERT INTO files_saved_filters "
                    "(id, user_id, organization_id, name, icon, criteria, "
                    "is_preset, sort_by, sort_order, created_at, updated_at) "
                    "VALUES (uuidv7(), :user_id, :org_id, :name, :icon, "
                    ":criteria, true, :sort_by, :sort_order, now(), now()) "
                    "ON CONFLICT ON CONSTRAINT uq_saved_filters_user_org_name "
                    "DO NOTHING"
                ),
                {
                    "user_id": owner_id,
                    "org_id": org_id,
                    "name": preset["name"],
                    "icon": json.dumps(preset["icon"]),
                    "criteria": json.dumps(preset["criteria"]),
                    "sort_by": preset["sort_by"],
                    "sort_order": preset["sort_order"],
                },
            )


def downgrade() -> None:
    """Remove all preset filters."""
    op.execute(text("DELETE FROM files_saved_filters WHERE is_preset = true"))
