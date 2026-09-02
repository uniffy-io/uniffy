"""Re-open sent reminder rows on live recurring series.

Reminder rows on recurring masters now roll forward per occurrence instead of
being marked sent after the first one. Clear `sent_at` on rows the old
behavior closed so existing series resume reminding; the reminder worker
re-anchors the stale `scheduled_at` without emitting for past occurrences.

Revision ID: 091
Revises: 090
Create Date: 2026-08-24
"""

from collections.abc import Sequence

from alembic import op

revision: str = "091"
down_revision: str | None = "090"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE calendar_event_reminders r
        SET sent_at = NULL
        FROM calendar_events e
        WHERE r.event_id = e.id
          AND r.sent_at IS NOT NULL
          AND e.recurrence_pattern != 'NONE'
          AND e.recurrence_id IS NULL
          AND e.is_deleted = false
        """
    )


def downgrade() -> None:
    # The original sent_at instants are unrecoverable; leaving rows pending is
    # harmless for the old code path, which only fires while the master's
    # first occurrence is still in the future.
    pass
