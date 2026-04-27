"""Create files domain tables.

Revision ID: 005
Revises: 004
Create Date: 2026-02-02

Consolidates (original dates):
  - files, folders, versions, multipart uploads, saved filters (2026-02-02)
  - is_system on folders (2026-02-05)
  - media_info split out of files (2026-02-09)
  - audio metadata columns (2026-02-09)
  - extracted_text column (2026-03-08)
  - storage quotas + usage + user overrides (2026-04-16)

Preset seeding moved out of migrations: `create_default_presets()` runs
on org creation.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "005"
down_revision: str | None = "004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_access_mode_enum = postgresql.ENUM(
    "OWNER_ONLY", "EXPLICIT_MEMBERS", "OPEN_TO_ORG", name="accessmode", create_type=False
)
_content_role_enum = postgresql.ENUM(
    "OWNER",
    "ADMIN",
    "EDITOR",
    "COMMENTER",
    "VIEWER",
    "BLOCKED",
    name="contentrole",
    create_type=False,
)
_extraction_status_enum = postgresql.ENUM(
    "PENDING",
    "PROCESSING",
    "COMPLETED",
    "FAILED",
    "SKIPPED",
    name="extractionstatus",
    create_type=False,
)
_upload_status_enum = postgresql.ENUM(
    "ACTIVE", "COMPLETED", "ABORTED", "EXPIRED", name="uploadstatus", create_type=False
)


def upgrade() -> None:
    """Create files domain tables."""
    op.create_table(
        "files_folders",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column(
            "access_mode", _access_mode_enum, nullable=False, server_default="OWNER_ONLY"
        ),
        sa.Column("baseline_role", _content_role_enum, nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["parent_id"], ["files_folders.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_files_folders_organization_id", "files_folders", ["organization_id"])
    op.create_index("ix_files_folders_owner_id", "files_folders", ["owner_id"])
    op.create_index("ix_files_folders_access_mode", "files_folders", ["access_mode"])
    op.create_index("ix_files_folders_parent_id", "files_folders", ["parent_id"])

    op.create_table(
        "files_file_versions",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("file_id", sa.Uuid(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sa.String(1000), nullable=False),
        sa.Column("storage_bucket", sa.String(255), nullable=False),
        sa.Column("checksum_sha256", sa.String(64), nullable=True),
        sa.Column("uploaded_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["uploaded_by"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_files_file_versions_file_id", "files_file_versions", ["file_id"])

    op.create_table(
        "files_files",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column(
            "access_mode", _access_mode_enum, nullable=False, server_default="OWNER_ONLY"
        ),
        sa.Column("baseline_role", _content_role_enum, nullable=True),
        sa.Column("filename", sa.String(500), nullable=False),
        sa.Column("original_filename", sa.String(500), nullable=False),
        sa.Column("mime_type", sa.String(255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sa.String(1000), nullable=False),
        sa.Column("storage_bucket", sa.String(255), nullable=False),
        sa.Column("folder_id", sa.Uuid(), nullable=True),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("description", sa.String(2000), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("current_version_id", sa.Uuid(), nullable=True),
        sa.Column(
            "extraction_status",
            _extraction_status_enum,
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["folder_id"], ["files_folders.id"]),
        sa.ForeignKeyConstraint(["current_version_id"], ["files_file_versions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_files_files_organization_id", "files_files", ["organization_id"])
    op.create_index("ix_files_files_owner_id", "files_files", ["owner_id"])
    op.create_index("ix_files_files_access_mode", "files_files", ["access_mode"])
    op.create_index("ix_files_files_folder_id", "files_files", ["folder_id"])

    op.create_foreign_key(
        "fk_files_file_versions_file_id",
        "files_file_versions",
        "files_files",
        ["file_id"],
        ["id"],
    )

    op.create_table(
        "files_media_info",
        sa.Column(
            "file_id",
            sa.Uuid(),
            sa.ForeignKey("files_files.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("thumbnail_key", sa.String(1000), nullable=True),
        sa.Column("thumbnail_width", sa.Integer(), nullable=True),
        sa.Column("thumbnail_height", sa.Integer(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("format", sa.String(50), nullable=True),
        sa.Column("color_mode", sa.String(50), nullable=True),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("bitrate", sa.Integer(), nullable=True),
        sa.Column("sample_rate", sa.Integer(), nullable=True),
        sa.Column("channels", sa.Integer(), nullable=True),
        sa.Column("exif", postgresql.JSONB(), nullable=True),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("extraction_error", sa.String(2000), nullable=True),
    )

    op.create_table(
        "files_multipart_uploads",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("s3_upload_id", sa.String(500), nullable=False),
        sa.Column("storage_key", sa.String(1000), nullable=False),
        sa.Column("storage_bucket", sa.String(255), nullable=False),
        sa.Column("filename", sa.String(500), nullable=False),
        sa.Column("mime_type", sa.String(255), nullable=False),
        sa.Column("total_size", sa.BigInteger(), nullable=False),
        sa.Column("total_chunks", sa.Integer(), nullable=False),
        sa.Column("chunk_size", sa.Integer(), nullable=False),
        sa.Column("folder_id", sa.Uuid(), nullable=True),
        sa.Column(
            "access_mode", _access_mode_enum, nullable=False, server_default="OWNER_ONLY"
        ),
        sa.Column("baseline_role", _content_role_enum, nullable=True),
        sa.Column("status", _upload_status_enum, nullable=False, server_default="ACTIVE"),
        sa.Column("parts_completed", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["folder_id"], ["files_folders.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_files_multipart_uploads_organization_id",
        "files_multipart_uploads",
        ["organization_id"],
    )
    op.create_index(
        "ix_files_multipart_uploads_user_id", "files_multipart_uploads", ["user_id"]
    )
    op.create_index(
        "ix_files_multipart_uploads_status", "files_multipart_uploads", ["status"]
    )

    op.create_table(
        "files_saved_filters",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("icon", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "criteria",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("is_preset", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("sort_by", sa.String(50), nullable=True),
        sa.Column("sort_order", sa.String(10), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "organization_id", "name", name="uq_saved_filters_user_org_name"
        ),
    )
    op.create_index("ix_files_saved_filters_user_id", "files_saved_filters", ["user_id"])
    op.create_index(
        "ix_files_saved_filters_organization_id",
        "files_saved_filters",
        ["organization_id"],
    )

    op.create_table(
        "files_storage_quotas",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("org_quota_bytes", sa.BigInteger(), nullable=True),
        sa.Column("default_user_quota_bytes", sa.BigInteger(), nullable=True),
        sa.Column("warn_at_percent", sa.Integer(), nullable=False, server_default="80"),
        sa.Column("enforce", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.UniqueConstraint("organization_id", name="uq_storage_quota_org"),
    )
    op.create_index("ix_files_storage_quotas_org", "files_storage_quotas", ["organization_id"])

    op.create_table(
        "files_user_storage_quota_overrides",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("quota_bytes", sa.BigInteger(), nullable=False),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["login_users.id"]),
        sa.UniqueConstraint(
            "organization_id",
            "user_id",
            name="uq_user_storage_quota_override_org_user",
        ),
    )
    op.create_index(
        "ix_files_user_storage_quota_overrides_org",
        "files_user_storage_quota_overrides",
        ["organization_id"],
    )
    op.create_index(
        "ix_files_user_storage_quota_overrides_user",
        "files_user_storage_quota_overrides",
        ["user_id"],
    )

    op.create_table(
        "files_storage_usage",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("used_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("file_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_recalculated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.UniqueConstraint("organization_id", "user_id", name="uq_storage_usage_org_user"),
    )
    op.create_index("ix_files_storage_usage_org", "files_storage_usage", ["organization_id"])
    op.create_index("ix_files_storage_usage_user", "files_storage_usage", ["user_id"])


def downgrade() -> None:
    """Drop files domain tables."""
    op.drop_table("files_storage_usage")
    op.drop_table("files_user_storage_quota_overrides")
    op.drop_table("files_storage_quotas")
    op.drop_table("files_saved_filters")
    op.drop_table("files_multipart_uploads")
    op.drop_table("files_media_info")
    op.drop_constraint(
        "fk_files_file_versions_file_id", "files_file_versions", type_="foreignkey"
    )
    op.drop_table("files_files")
    op.drop_table("files_file_versions")
    op.drop_table("files_folders")
