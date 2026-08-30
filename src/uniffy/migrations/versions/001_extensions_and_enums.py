"""Create PostgreSQL extensions and all enum types.

Revision ID: 001
Revises:
Create Date: 2026-01-20

Baseline migration. Creates every enum type the schema uses with its final
set of values. All later migrations reference these enums via
``postgresql.ENUM(..., create_type=False)``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create extensions and all enum types."""
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')

    op.execute("CREATE TYPE organizationrole AS ENUM ('OWNER', 'ADMIN', 'MEMBER')")
    op.execute("CREATE TYPE grouprole AS ENUM ('ADMIN', 'MEMBER')")
    op.execute("CREATE TYPE ssoprovider AS ENUM ('SAML', 'OIDC', 'GOOGLE', 'MICROSOFT', 'OKTA')")

    op.execute(
        "CREATE TYPE contentrole AS ENUM "
        "('OWNER', 'ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER', 'BLOCKED')"
    )
    op.execute("CREATE TYPE accessmode AS ENUM ('OWNER_ONLY', 'EXPLICIT_MEMBERS', 'OPEN_TO_ORG')")
    op.execute(
        "CREATE TYPE contentmemberaction AS ENUM ("
        "'MEMBER_ADDED', 'MEMBER_ROLE_CHANGED', 'MEMBER_REMOVED', "
        "'ACCESS_MODE_CHANGED', 'BASELINE_ROLE_CHANGED', 'OWNERSHIP_TRANSFERRED'"
        ")"
    )

    op.execute(
        "CREATE TYPE contenttype AS ENUM ("
        "'NOTE', 'FILE', 'FOLDER', 'CALENDAR_EVENT', 'CHAT_MESSAGE', 'USER', "
        "'PROJECT', 'TASK', 'AGENT', 'PROVIDER_KEY', 'PROMPT', "
        "'AGENT_CRON_TASK', 'CHAT', 'ROOM'"
        ")"
    )
    op.execute("CREATE TYPE subjecttype AS ENUM ('USER', 'GROUP', 'ORGANIZATION', 'AGENT')")
    op.execute(
        "CREATE TYPE domaintype AS ENUM ('CHAT', 'FILES', 'NOTES', 'CALENDAR', 'PROJECTS', 'AGENTS')"
    )

    op.execute("CREATE TYPE nodetype AS ENUM ('NOTE', 'FOLDER', 'TEMPLATE', 'CANVAS')")

    op.execute("CREATE TYPE calendartype AS ENUM ('PERSONAL', 'WORK', 'TEAM', 'SHARED')")
    op.execute(
        "CREATE TYPE recurrencepattern AS ENUM "
        "('NONE', 'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'YEARLY')"
    )
    op.execute(
        "CREATE TYPE dayofweek AS ENUM ("
        "'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'"
        ")"
    )
    op.execute("CREATE TYPE attendeestatus AS ENUM ('PENDING', 'ACCEPTED', 'TENTATIVE', 'DECLINED')")
    op.execute("CREATE TYPE attendeerole AS ENUM ('ORGANIZER', 'REQUIRED', 'OPTIONAL')")

    op.execute("CREATE TYPE resourcetype AS ENUM ('NOTE', 'FILE', 'CHAT')")

    op.execute(
        "CREATE TYPE notificationtype AS ENUM ("
        "'CONTENT_SHARED', 'CONTENT_MENTIONED', 'CONTENT_EDITED', "
        "'CALENDAR_REMINDER', 'CALENDAR_INVITE', 'CALENDAR_RESPONSE', "
        "'PERMISSION_GRANTED', 'PERMISSION_REVOKED', 'SYSTEM_ANNOUNCEMENT', "
        "'COMMENT_ADDED', 'COMMENT_REPLY', 'COMMENT_MENTIONED', 'COMMENT_RESOLVED', "
        "'TASK_ASSIGNED', 'TASK_DUE_SOON', 'TASK_OVERDUE', "
        "'CHAT_MENTION', 'CHAT_DM', 'CHAT_CHANNEL_INVITE', "
        "'CHAT_CHANNEL_REMOVED', 'CHAT_THREAD_REPLY'"
        ")"
    )

    op.execute("CREATE TYPE roomtype AS ENUM ('MEETING_ROOM', 'CONFERENCE_ROOM', 'OFFICE', 'OTHER')")
    op.execute("CREATE TYPE roomstatus AS ENUM ('ACTIVE', 'MAINTENANCE', 'RETIRED')")
    op.execute("CREATE TYPE bookingstatus AS ENUM ('CONFIRMED', 'CANCELLED')")

    op.execute(
        "CREATE TYPE extractionstatus AS ENUM "
        "('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED')"
    )
    op.execute("CREATE TYPE uploadstatus AS ENUM ('ACTIVE', 'COMPLETED', 'ABORTED', 'EXPIRED')")

    op.execute("CREATE TYPE channeltype AS ENUM ('PUBLIC', 'PRIVATE', 'DIRECT', 'GROUP_DM')")
    op.execute("CREATE TYPE channelrole AS ENUM ('OWNER', 'ADMIN', 'MEMBER')")
    op.execute("CREATE TYPE sendertype AS ENUM ('USER', 'AGENT', 'SYSTEM', 'GUEST')")
    op.execute("CREATE TYPE chatnotificationlevel AS ENUM ('ALL', 'MENTIONS', 'NONE')")

    op.execute("CREATE TYPE comment_anchor_type AS ENUM ('PAGE', 'SELECTION', 'BLOCK', 'MEDIA')")


def downgrade() -> None:
    """Drop every enum type. Extensions are left in place."""
    for enum_name in (
        "comment_anchor_type",
        "chatnotificationlevel",
        "sendertype",
        "channelrole",
        "channeltype",
        "uploadstatus",
        "extractionstatus",
        "bookingstatus",
        "roomstatus",
        "roomtype",
        "notificationtype",
        "resourcetype",
        "attendeerole",
        "attendeestatus",
        "dayofweek",
        "recurrencepattern",
        "calendartype",
        "nodetype",
        "domaintype",
        "subjecttype",
        "contenttype",
        "contentmemberaction",
        "accessmode",
        "contentrole",
        "ssoprovider",
        "grouprole",
        "organizationrole",
    ):
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")
