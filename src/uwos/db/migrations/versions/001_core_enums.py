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

    # Content visibility scopes
    op.execute("CREATE TYPE visibilityscope AS ENUM ('PRIVATE', 'GROUP', 'ORGANIZATION', 'PUBLIC')")

    # Permission levels
    op.execute("CREATE TYPE permissionlevel AS ENUM ('VIEW', 'EDIT', 'ADMIN', 'OWNER')")

    # Content types (for polymorphic permissions)
    op.execute(
        "CREATE TYPE contenttype AS ENUM "
        "('NOTE', 'FILE', 'CALENDAR_EVENT', 'BOOK', 'PASSWORD', 'WORKFLOW', 'CHAT_MESSAGE', 'SPACE')"
    )

    # Subject types (who can have permissions)
    op.execute("CREATE TYPE subjecttype AS ENUM ('USER', 'GROUP', 'ORGANIZATION')")

    # Node types (for notes hierarchy)
    op.execute("CREATE TYPE nodetype AS ENUM ('NOTE', 'FOLDER', 'TEMPLATE')")


def downgrade() -> None:
    """Drop all enum types."""
    op.execute("DROP TYPE IF EXISTS nodetype")
    op.execute("DROP TYPE IF EXISTS subjecttype")
    op.execute("DROP TYPE IF EXISTS contenttype")
    op.execute("DROP TYPE IF EXISTS permissionlevel")
    op.execute("DROP TYPE IF EXISTS visibilityscope")
    op.execute("DROP TYPE IF EXISTS ssoprovider")
    op.execute("DROP TYPE IF EXISTS grouprole")
    op.execute("DROP TYPE IF EXISTS organizationrole")
