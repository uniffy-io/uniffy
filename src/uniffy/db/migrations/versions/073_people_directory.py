"""People directory: profiles, identity sources/links, group kinds, group-member uniqueness.

Revision ID: 073
Revises: 072
Create Date: 2026-08-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "073"
down_revision: str | None = "072"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_source_kind_enum = postgresql.ENUM(
    "LOCAL", "SCIM", "LDAP", "OIDC", name="identitysourcekind", create_type=False
)
_group_kind_enum = postgresql.ENUM(
    "TEAM", "ACCESS", name="groupkind", create_type=False
)
_subject_type_enum = postgresql.ENUM(
    "USER", "GROUP", "ORGANIZATION", "AGENT", name="subjecttype", create_type=False
)


def upgrade() -> None:
    # Pronouns are a personal, org-independent attribute (Slack-style): they
    # live on the global user row, not in people_profiles.
    op.add_column("login_users", sa.Column("pronouns", sa.String(length=50), nullable=True))

    postgresql.ENUM("LOCAL", "SCIM", "LDAP", "OIDC", name="identitysourcekind").create(
        op.get_bind(), checkfirst=True
    )
    postgresql.ENUM("TEAM", "ACCESS", name="groupkind").create(
        op.get_bind(), checkfirst=True
    )

    op.create_table(
        "people_profiles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("organization_id", UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("job_title", sa.String(length=255), nullable=True),
        sa.Column("department", sa.String(length=255), nullable=True),
        sa.Column("work_phone", sa.String(length=50), nullable=True),
        sa.Column("mobile_phone", sa.String(length=50), nullable=True),
        sa.Column("office_location", sa.String(length=255), nullable=True),
        sa.Column("timezone", sa.String(length=64), nullable=True),
        sa.Column("bio", sa.String(length=2000), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("birthday", sa.String(length=5), nullable=True),
        sa.Column("links", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("manager_user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("managed_fields", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["login_organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["manager_user_id"], ["login_users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("organization_id", "user_id", name="uq_people_profiles_org_user"),
    )
    op.create_index(
        "ix_people_profiles_organization_id", "people_profiles", ["organization_id"]
    )
    op.create_index("ix_people_profiles_user_id", "people_profiles", ["user_id"])
    op.create_index(
        "ix_people_profiles_org_manager", "people_profiles", ["organization_id", "manager_user_id"]
    )
    op.create_index(
        "ix_people_profiles_org_department", "people_profiles", ["organization_id", "department"]
    )

    op.create_table(
        "people_identity_sources",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("organization_id", UUID(as_uuid=True), nullable=False),
        sa.Column("kind", _source_kind_enum, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("config", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_status", sa.String(length=50), nullable=True),
        sa.Column("last_sync_error", sa.String(length=2000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["login_organizations.id"], ondelete="CASCADE"
        ),
    )
    op.create_index(
        "ix_people_identity_sources_organization_id",
        "people_identity_sources",
        ["organization_id"],
    )

    op.create_table(
        "people_identity_links",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("organization_id", UUID(as_uuid=True), nullable=False),
        sa.Column("source_id", UUID(as_uuid=True), nullable=False),
        sa.Column("subject_type", _subject_type_enum, nullable=False),
        sa.Column("subject_id", UUID(as_uuid=True), nullable=False),
        sa.Column("external_id", sa.String(length=512), nullable=False),
        sa.Column("external_dn", sa.String(length=1024), nullable=True),
        sa.Column("raw", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["login_organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["source_id"], ["people_identity_sources.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint(
            "source_id", "subject_type", "external_id", name="uq_people_identity_links_external"
        ),
        sa.UniqueConstraint(
            "source_id", "subject_type", "subject_id", name="uq_people_identity_links_subject"
        ),
    )
    op.create_index(
        "ix_people_identity_links_organization_id", "people_identity_links", ["organization_id"]
    )
    op.create_index("ix_people_identity_links_source_id", "people_identity_links", ["source_id"])
    op.create_index("ix_people_identity_links_subject_id", "people_identity_links", ["subject_id"])

    op.add_column(
        "login_groups",
        sa.Column("kind", _group_kind_enum, nullable=False, server_default=sa.text("'ACCESS'")),
    )
    op.add_column("login_groups", sa.Column("parent_group_id", UUID(as_uuid=True), nullable=True))
    op.add_column("login_groups", sa.Column("lead_user_id", UUID(as_uuid=True), nullable=True))
    op.add_column(
        "login_groups",
        sa.Column("managed_fields", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.create_foreign_key(
        "fk_login_groups_parent_group_id",
        "login_groups",
        "login_groups",
        ["parent_group_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_login_groups_lead_user_id",
        "login_groups",
        "login_users",
        ["lead_user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # The table pre-dates any (group_id, user_id) uniqueness and add_member
    # blind-inserted, so dedupe before the constraint: keep the highest-role
    # row (ADMIN beats MEMBER), tie-break earliest joined_at.
    op.execute(
        """
        DELETE FROM login_group_members lgm
        USING (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY group_id, user_id
                       ORDER BY (role = 'ADMIN') DESC, joined_at ASC, id ASC
                   ) AS rn
            FROM login_group_members
        ) ranked
        WHERE lgm.id = ranked.id AND ranked.rn > 1
        """
    )
    op.create_unique_constraint(
        "uq_login_group_members_group_user", "login_group_members", ["group_id", "user_id"]
    )

    # Existing orgs get their LOCAL source here; orgs created later get it
    # from the org-creation path.
    op.execute(
        """
        INSERT INTO people_identity_sources
            (id, organization_id, kind, name, is_active, config, created_at)
        SELECT uuidv7(), o.id, 'LOCAL', 'Local', true, '{}'::jsonb, now()
        FROM login_organizations o
        """
    )


def downgrade() -> None:
    op.drop_column("login_users", "pronouns")
    op.drop_constraint(
        "uq_login_group_members_group_user", "login_group_members", type_="unique"
    )
    op.drop_constraint("fk_login_groups_lead_user_id", "login_groups", type_="foreignkey")
    op.drop_constraint("fk_login_groups_parent_group_id", "login_groups", type_="foreignkey")
    op.drop_column("login_groups", "managed_fields")
    op.drop_column("login_groups", "lead_user_id")
    op.drop_column("login_groups", "parent_group_id")
    op.drop_column("login_groups", "kind")
    op.drop_index("ix_people_identity_links_subject_id", table_name="people_identity_links")
    op.drop_index("ix_people_identity_links_source_id", table_name="people_identity_links")
    op.drop_index("ix_people_identity_links_organization_id", table_name="people_identity_links")
    op.drop_table("people_identity_links")
    op.drop_index(
        "ix_people_identity_sources_organization_id", table_name="people_identity_sources"
    )
    op.drop_table("people_identity_sources")
    op.drop_index("ix_people_profiles_org_department", table_name="people_profiles")
    op.drop_index("ix_people_profiles_org_manager", table_name="people_profiles")
    op.drop_index("ix_people_profiles_user_id", table_name="people_profiles")
    op.drop_index("ix_people_profiles_organization_id", table_name="people_profiles")
    op.drop_table("people_profiles")
    postgresql.ENUM(name="groupkind").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="identitysourcekind").drop(op.get_bind(), checkfirst=True)
