"""Default Quick-Filter presets seeded per org via ON CONFLICT DO NOTHING."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.files.saved_filter import SavedFileFilter

DEFAULT_FILTER_PRESETS: list[dict[str, Any]] = [
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


async def create_default_presets(
    session: AsyncSession,
    organization_id: UUID,
    owner_user_id: UUID,
) -> None:
    """Idempotent seed of filter presets for an org (caller manages commit)."""
    now = datetime.now(UTC)
    rows = [
        {
            "user_id": owner_user_id,
            "organization_id": organization_id,
            "name": preset["name"],
            "icon": preset["icon"],
            "criteria": preset["criteria"],
            "is_preset": True,
            "sort_by": preset["sort_by"],
            "sort_order": preset["sort_order"],
            "created_at": now,
            "updated_at": now,
        }
        for preset in DEFAULT_FILTER_PRESETS
    ]

    stmt = pg_insert(SavedFileFilter).values(rows)
    stmt = stmt.on_conflict_do_nothing(
        constraint="uq_saved_filters_user_org_name",
    )
    await session.execute(stmt)
