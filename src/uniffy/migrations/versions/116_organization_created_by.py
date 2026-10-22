"""Record which account created each organization."""

import sqlalchemy as sa
from alembic import op

revision: str = "116"
down_revision: str | None = "115"
branch_labels: str | None = None
depends_on: str | None = None

_TABLE = "login_organizations"
_COLUMN = "created_by_user_id"
_CREATED_BY_FK = "fk_login_organizations_created_by_user"
_CREATED_BY_INDEX = "ix_login_organizations_created_by_user_id"


def upgrade() -> None:
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.Uuid(), nullable=True))
    op.create_foreign_key(
        _CREATED_BY_FK, _TABLE, "login_users", [_COLUMN], ["id"], ondelete="SET NULL"
    )
    op.create_index(_CREATED_BY_INDEX, _TABLE, [_COLUMN])


def downgrade() -> None:
    op.drop_index(_CREATED_BY_INDEX, table_name=_TABLE)
    op.drop_constraint(_CREATED_BY_FK, _TABLE, type_="foreignkey")
    op.drop_column(_TABLE, _COLUMN)
