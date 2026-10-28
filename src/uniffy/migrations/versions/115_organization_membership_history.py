"""Make memberships unique per user and org, and record their source, inviter and removal.

Duplicate pairs collapse to the most recently updated row before the unique index lands.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "115"
down_revision: str | None = "114"
branch_labels: str | None = None
depends_on: str | None = None

_TABLE = "login_organization_members"
_USER_ORG_INDEX = "uq_login_organization_members_user_org"
_INVITED_BY_FK = "fk_login_organization_members_invited_by_user"
_REMOVED_BY_FK = "fk_login_organization_members_removed_by_user"
_SOURCE_VALUES = ("CREATED", "INVITE", "ADDED", "JIT", "SCIM", "BOOTSTRAP")

_member_source_enum = postgresql.ENUM(
    *_SOURCE_VALUES, name="organizationmembersource", create_type=False
)


def upgrade() -> None:
    postgresql.ENUM(*_SOURCE_VALUES, name="organizationmembersource").create(
        op.get_bind(), checkfirst=True
    )

    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    PARTITION BY user_id, organization_id
                    ORDER BY updated_at DESC NULLS LAST, joined_at DESC, id DESC
                ) AS rank
            FROM login_organization_members
        )
        DELETE FROM login_organization_members AS member
        USING ranked
        WHERE member.id = ranked.id AND ranked.rank > 1
        """
    )
    op.create_index(_USER_ORG_INDEX, _TABLE, ["user_id", "organization_id"], unique=True)

    op.add_column(_TABLE, sa.Column("invited_by_user_id", sa.Uuid(), nullable=True))
    op.add_column(
        _TABLE,
        sa.Column("source", _member_source_enum, nullable=False, server_default="ADDED"),
    )
    op.add_column(_TABLE, sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(_TABLE, sa.Column("removed_by_user_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        _INVITED_BY_FK, _TABLE, "login_users", ["invited_by_user_id"], ["id"], ondelete="SET NULL"
    )
    op.create_foreign_key(
        _REMOVED_BY_FK, _TABLE, "login_users", ["removed_by_user_id"], ["id"], ondelete="SET NULL"
    )


def downgrade() -> None:
    op.drop_constraint(_REMOVED_BY_FK, _TABLE, type_="foreignkey")
    op.drop_constraint(_INVITED_BY_FK, _TABLE, type_="foreignkey")
    op.drop_column(_TABLE, "removed_by_user_id")
    op.drop_column(_TABLE, "removed_at")
    op.drop_column(_TABLE, "source")
    op.drop_column(_TABLE, "invited_by_user_id")
    op.drop_index(_USER_ORG_INDEX, table_name=_TABLE)
    postgresql.ENUM(name="organizationmembersource").drop(op.get_bind(), checkfirst=True)
