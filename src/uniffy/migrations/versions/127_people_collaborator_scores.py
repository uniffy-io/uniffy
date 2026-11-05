"""Track how much each member works with each colleague, for people pickers."""

import sqlalchemy as sa
from alembic import op

revision = "127"
down_revision = "126"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "people_collaborator_scores",
        sa.Column(
            "organization_id",
            sa.Uuid(),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("login_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "peer_id",
            sa.Uuid(),
            sa.ForeignKey("login_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("scored_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_interaction_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("user_id <> peer_id", name="ck_people_collaborator_self"),
    )
    # Account deletion cascades through peer_id without a full scan.
    op.create_index("ix_people_collaborator_scores_peer", "people_collaborator_scores", ["peer_id"])
    # The nightly co-activity pass reads only the last day of these append-only tables.
    op.create_index("ix_projects_activities_timestamp", "projects_activities", ["timestamp"])
    op.create_index("ix_calls_participants_joined_at", "calls_participants", ["joined_at"])


def downgrade() -> None:
    op.drop_index("ix_calls_participants_joined_at", table_name="calls_participants")
    op.drop_index("ix_projects_activities_timestamp", table_name="projects_activities")
    op.drop_table("people_collaborator_scores")
