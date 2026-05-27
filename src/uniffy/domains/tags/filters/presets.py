"""Default tag-explorer presets, seeded idempotently against the org owner.

Every org member sees them through list_filters(include_presets=True). The
"Untagged content" preset uses untagged_only=True so the explorer's right
panel switches modes rather than opening a separate sub-view.
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.tags.saved_filter import SavedTagFilter
from uniffy.domains.tags.operations import SOURCE_INLINE, SOURCE_MANUAL


def _recent_days_ago(days: int) -> str:
    return (datetime.now(UTC) - timedelta(days=days)).isoformat()


DEFAULT_TAG_FILTER_PRESETS: list[dict[str, Any]] = [
    {
        "name": "Untagged content",
        "description": "Notes, files, and events with no tags applied.",
        "icon": {"type": "icon", "value": "FunnelSimpleX"},
        "criteria": {"untagged_only": True},
        "sort_by": "updated",
        "sort_order": "desc",
    },
    {
        "name": "My recent tags",
        "description": "Tags you have used in the last 30 days.",
        "icon": {"type": "icon", "value": "Clock"},
        "criteria": {
            "owner_self": True,
            "created_after": _recent_days_ago(30),
        },
        "sort_by": "updated",
        "sort_order": "desc",
    },
    {
        "name": "Auto-tagged",
        "description": "Tags driven by inline markdown only.",
        "icon": {"type": "icon", "value": "MagicWand"},
        "criteria": {"sources": [SOURCE_INLINE]},
        "sort_by": "count",
        "sort_order": "desc",
    },
    {
        "name": "Manual only",
        "description": "Tags applied through the picker, no inline.",
        "icon": {"type": "icon", "value": "Hand"},
        "criteria": {"sources": [SOURCE_MANUAL]},
        "sort_by": "count",
        "sort_order": "desc",
    },
]


async def create_default_tag_filter_presets(
    session: AsyncSession,
    organization_id: UUID,
    owner_user_id: UUID,
) -> None:
    """Idempotent: presets are owned by the org owner, shared via include_presets."""
    now = datetime.now(UTC)
    rows = [
        {
            "user_id": owner_user_id,
            "organization_id": organization_id,
            "name": preset["name"],
            "description": preset.get("description", ""),
            "icon": preset["icon"],
            "criteria": preset["criteria"],
            "is_preset": True,
            "sort_by": preset["sort_by"],
            "sort_order": preset["sort_order"],
            "created_at": now,
            "updated_at": now,
        }
        for preset in DEFAULT_TAG_FILTER_PRESETS
    ]

    stmt = pg_insert(SavedTagFilter).values(rows)
    stmt = stmt.on_conflict_do_nothing(constraint="uq_tags_saved_filters_name")
    await session.execute(stmt)
