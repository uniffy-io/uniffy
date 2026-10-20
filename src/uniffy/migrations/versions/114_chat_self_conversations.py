"""Add the one-person self conversation flag to chat channels.

Existing channels keep the false default, so nothing is backfilled. The partial
unique index lets concurrent first opens converge on one live row per member.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "114"
down_revision: str | None = "113"
branch_labels: str | None = None
depends_on: str | None = None

_SELF_DM_INDEX = "uq_chat_channels_self_dm"


def upgrade() -> None:
    op.add_column(
        "chat_channels",
        sa.Column("is_self_dm", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index(
        _SELF_DM_INDEX,
        "chat_channels",
        ["organization_id", "owner_id"],
        unique=True,
        postgresql_where=sa.text("is_self_dm AND NOT is_deleted"),
    )


def downgrade() -> None:
    op.drop_index(_SELF_DM_INDEX, table_name="chat_channels")
    op.drop_column("chat_channels", "is_self_dm")
