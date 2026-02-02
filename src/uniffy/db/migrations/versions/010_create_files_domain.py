"""Create files domain tables.

This migration creates all tables for the files domain:
- files_folders: Folder hierarchy
- files_file_versions: Version history for files
- files_files: Main files table
- files_multipart_uploads: Tracking for resumable uploads
- files_saved_filters: User-defined file filters

Revision ID: 010
Revises: 009
Create Date: 2026-02-02

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "010"
down_revision: str | None = "009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create files domain tables."""
    # Add FOLDER to contenttype enum
    op.execute("ALTER TYPE contenttype ADD VALUE IF NOT EXISTS 'FOLDER'")

    # Create extraction status enum
    extraction_status_enum = postgresql.ENUM(
        "PENDING",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
        "SKIPPED",
        name="extractionstatus",
    )
    extraction_status_enum.create(op.get_bind(), checkfirst=True)

    # Create upload status enum
    upload_status_enum = postgresql.ENUM(
        "ACTIVE",
        "COMPLETED",
        "ABORTED",
        "EXPIRED",
        name="uploadstatus",
    )
    upload_status_enum.create(op.get_bind(), checkfirst=True)

    # Create folders table first (files references it)
    op.create_table(
        "files_folders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column(
            "visibility",
            postgresql.ENUM(
                "PRIVATE",
                "GROUP",
                "ORGANIZATION",
                "PUBLIC",
                name="visibilityscope",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
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
    op.create_index("ix_files_folders_visibility", "files_folders", ["visibility"])
    op.create_index("ix_files_folders_parent_id", "files_folders", ["parent_id"])

    # Create file versions table (files references it for current_version_id)
    op.create_table(
        "files_file_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        # Note: file_id FK added after files table exists
        sa.Column("file_id", sa.Uuid(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sqlmodel.sql.sqltypes.AutoString(length=1000), nullable=False),
        sa.Column("storage_bucket", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("checksum_sha256", sqlmodel.sql.sqltypes.AutoString(length=64), nullable=True),
        sa.Column("uploaded_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["uploaded_by"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_files_file_versions_file_id", "files_file_versions", ["file_id"])

    # Create files table
    op.create_table(
        "files_files",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column(
            "visibility",
            postgresql.ENUM(
                "PRIVATE",
                "GROUP",
                "ORGANIZATION",
                "PUBLIC",
                name="visibilityscope",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("filename", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=False),
        sa.Column(
            "original_filename", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=False
        ),
        sa.Column("mime_type", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sqlmodel.sql.sqltypes.AutoString(length=1000), nullable=False),
        sa.Column("storage_bucket", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("folder_id", sa.Uuid(), nullable=True),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(length=2000), nullable=True),
        sa.Column("file_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("current_version_id", sa.Uuid(), nullable=True),
        sa.Column(
            "extraction_status",
            postgresql.ENUM(
                "PENDING",
                "PROCESSING",
                "COMPLETED",
                "FAILED",
                "SKIPPED",
                name="extractionstatus",
                create_type=False,
            ),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
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
    op.create_index("ix_files_files_visibility", "files_files", ["visibility"])
    op.create_index("ix_files_files_folder_id", "files_files", ["folder_id"])

    # Add FK from file_versions to files now that files table exists
    op.create_foreign_key(
        "fk_files_file_versions_file_id",
        "files_file_versions",
        "files_files",
        ["file_id"],
        ["id"],
    )

    # Create multipart uploads table
    op.create_table(
        "files_multipart_uploads",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("s3_upload_id", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=False),
        sa.Column("storage_key", sqlmodel.sql.sqltypes.AutoString(length=1000), nullable=False),
        sa.Column("storage_bucket", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("filename", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=False),
        sa.Column("mime_type", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("total_size", sa.BigInteger(), nullable=False),
        sa.Column("total_chunks", sa.Integer(), nullable=False),
        sa.Column("chunk_size", sa.Integer(), nullable=False),
        sa.Column("folder_id", sa.Uuid(), nullable=True),
        sa.Column(
            "visibility",
            postgresql.ENUM(
                "PRIVATE",
                "GROUP",
                "ORGANIZATION",
                "PUBLIC",
                name="visibilityscope",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            postgresql.ENUM(
                "ACTIVE",
                "COMPLETED",
                "ABORTED",
                "EXPIRED",
                name="uploadstatus",
                create_type=False,
            ),
            nullable=False,
            server_default="ACTIVE",
        ),
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
    op.create_index("ix_files_multipart_uploads_user_id", "files_multipart_uploads", ["user_id"])
    op.create_index("ix_files_multipart_uploads_status", "files_multipart_uploads", ["status"])

    # Create saved file filters table
    op.create_table(
        "files_saved_filters",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
        sa.Column("icon", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("criteria", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("is_preset", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("sort_by", sqlmodel.sql.sqltypes.AutoString(length=50), nullable=True),
        sa.Column("sort_order", sqlmodel.sql.sqltypes.AutoString(length=10), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "organization_id", "name", name="uq_saved_filters_user_org_name"
        ),
    )
    op.create_index(
        "ix_files_saved_filters_user_id", "files_saved_filters", ["user_id"]
    )
    op.create_index(
        "ix_files_saved_filters_organization_id", "files_saved_filters", ["organization_id"]
    )


def downgrade() -> None:
    """Drop files domain tables."""
    op.drop_index("ix_files_saved_filters_organization_id", table_name="files_saved_filters")
    op.drop_index("ix_files_saved_filters_user_id", table_name="files_saved_filters")
    op.drop_table("files_saved_filters")

    op.drop_table("files_multipart_uploads")
    op.drop_constraint("fk_files_file_versions_file_id", "files_file_versions", type_="foreignkey")
    op.drop_table("files_files")
    op.drop_table("files_file_versions")
    op.drop_table("files_folders")

    # Drop enums
    op.execute("DROP TYPE IF EXISTS uploadstatus")
    op.execute("DROP TYPE IF EXISTS extractionstatus")

    # Note: FOLDER enum value cannot be removed from contenttype without recreating the type
