"""Create core enum types.

Revision ID: 001
Revises:
Create Date: 2026-01-20

"""

from collections.abc import Sequence

from alembic import op

revision: str = "001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create all enum types used across the system."""
    # Organization roles
    op.execute("CREATE TYPE organizationrole AS ENUM ('OWNER', 'ADMIN', 'MEMBER')")

    # Group roles
    op.execute("CREATE TYPE grouprole AS ENUM ('ADMIN', 'MEMBER')")

    # SSO providers
    op.execute("CREATE TYPE ssoprovider AS ENUM ('SAML', 'OIDC', 'GOOGLE', 'MICROSOFT', 'OKTA')")

    # Content role (applies to a single content item)
    op.execute(
        "CREATE TYPE contentrole AS ENUM "
        "('OWNER', 'ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER', 'BLOCKED')"
    )

    # Baseline access mode for a content item
    op.execute(
        "CREATE TYPE accessmode AS ENUM "
        "('OWNER_ONLY', 'EXPLICIT_MEMBERS', 'OPEN_TO_ORG')"
    )

    # Audit event actions on the access control layer
    op.execute(
        "CREATE TYPE contentmemberaction AS ENUM "
        "('MEMBER_ADDED', 'MEMBER_ROLE_CHANGED', 'MEMBER_REMOVED', "
        "'ACCESS_MODE_CHANGED', 'BASELINE_ROLE_CHANGED', 'OWNERSHIP_TRANSFERRED')"
    )

    # Content types (polymorphic references across the codebase). Future
    # content types are appended via ALTER TYPE in their own migrations.
    op.execute(
        "CREATE TYPE contenttype AS ENUM ("
        "'NOTE', 'FILE', 'FOLDER', 'CALENDAR_EVENT', 'CHAT_MESSAGE', 'USER', "
        "'PROJECT', 'TASK', 'AGENT', 'PROVIDER_KEY', 'PROMPT', "
        "'AGENT_CRON_TASK', 'CHAT', 'ROOM'"
        ")"
    )

    # Subject types (who can have a role on content)
    op.execute("CREATE TYPE subjecttype AS ENUM ('USER', 'GROUP', 'ORGANIZATION')")

    # Node types (for notes hierarchy)
    op.execute("CREATE TYPE nodetype AS ENUM ('NOTE', 'FOLDER', 'TEMPLATE', 'CANVAS')")


def downgrade() -> None:
    """Drop all enum types."""
    op.execute("DROP TYPE IF EXISTS nodetype")
    op.execute("DROP TYPE IF EXISTS subjecttype")
    op.execute("DROP TYPE IF EXISTS contenttype")
    op.execute("DROP TYPE IF EXISTS contentmemberaction")
    op.execute("DROP TYPE IF EXISTS accessmode")
    op.execute("DROP TYPE IF EXISTS contentrole")
    op.execute("DROP TYPE IF EXISTS ssoprovider")
    op.execute("DROP TYPE IF EXISTS grouprole")
    op.execute("DROP TYPE IF EXISTS organizationrole")
