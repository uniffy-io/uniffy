"""Add projects tables.

Creates all projects domain tables:
- projects_projects
- projects_tasks
- projects_field_definitions (composite PK: id, project_id)
- projects_views (composite PK: id, project_id)
- projects_activities (no content column - comments use shared domain)

Also fixes miscellaneous FK constraints from autogeneration.

Revision ID: 021
Revises: 020
Create Date: 2026-02-14

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "021"
down_revision: str | None = "020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Shared ENUM reference (already exists in DB)
_visibility = postgresql.ENUM(
    'PRIVATE', 'GROUP', 'ORGANIZATION', 'PUBLIC',
    name='visibilityscope', create_type=False,
)


def upgrade() -> None:
    """Create projects domain tables."""
    # Add PROJECT and TASK to the contenttype enum
    op.execute(
        "ALTER TYPE contenttype ADD VALUE IF NOT EXISTS 'PROJECT'"
    )
    op.execute(
        "ALTER TYPE contenttype ADD VALUE IF NOT EXISTS 'TASK'"
    )

    # --- projects_projects ---
    op.create_table(
        'projects_projects',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('owner_id', sa.Uuid(), nullable=False),
        sa.Column('visibility', _visibility, nullable=False),
        sa.Column(
            'name',
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column(
            'description',
            sqlmodel.sql.sqltypes.AutoString(),
            nullable=False,
        ),
        sa.Column(
            'icon',
            sqlmodel.sql.sqltypes.AutoString(length=50),
            nullable=False,
        ),
        sa.Column(
            'color',
            sqlmodel.sql.sqltypes.AutoString(length=20),
            nullable=False,
        ),
        sa.Column(
            'default_view_id',
            sqlmodel.sql.sqltypes.AutoString(length=100),
            nullable=True,
        ),
        sa.Column(
            'member_ids',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column('is_deleted', sa.Boolean(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['organization_id'], ['login_organizations.id']),
        sa.ForeignKeyConstraint(['owner_id'], ['login_users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_projects_projects_organization_id'),
        'projects_projects', ['organization_id'], unique=False,
    )
    op.create_index(
        op.f('ix_projects_projects_owner_id'),
        'projects_projects', ['owner_id'], unique=False,
    )
    op.create_index(
        op.f('ix_projects_projects_visibility'),
        'projects_projects', ['visibility'], unique=False,
    )

    # --- projects_field_definitions (composite PK) ---
    op.create_table(
        'projects_field_definitions',
        sa.Column(
            'id',
            sqlmodel.sql.sqltypes.AutoString(length=100),
            nullable=False,
        ),
        sa.Column('project_id', sa.Uuid(), nullable=False),
        sa.Column(
            'name',
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column(
            'type',
            sqlmodel.sql.sqltypes.AutoString(length=50),
            nullable=False,
        ),
        sa.Column('is_required', sa.Boolean(), nullable=False),
        sa.Column('is_system', sa.Boolean(), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column(
            'config',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects_projects.id']),
        sa.PrimaryKeyConstraint('id', 'project_id'),
    )
    op.create_index(
        op.f('ix_projects_field_definitions_project_id'),
        'projects_field_definitions', ['project_id'],
        unique=False,
    )

    # --- projects_tasks ---
    op.create_table(
        'projects_tasks',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('project_id', sa.Uuid(), nullable=False),
        sa.Column('organization_id', sa.Uuid(), nullable=False),
        sa.Column('owner_id', sa.Uuid(), nullable=False),
        sa.Column('visibility', _visibility, nullable=False),
        sa.Column(
            'title',
            sqlmodel.sql.sqltypes.AutoString(length=500),
            nullable=False,
        ),
        sa.Column(
            'description',
            sqlmodel.sql.sqltypes.AutoString(),
            nullable=False,
        ),
        sa.Column(
            'status',
            sqlmodel.sql.sqltypes.AutoString(length=100),
            nullable=False,
        ),
        sa.Column(
            'priority',
            sqlmodel.sql.sqltypes.AutoString(length=100),
            nullable=False,
        ),
        sa.Column(
            'assignee_ids',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            'start_date',
            sqlmodel.sql.sqltypes.AutoString(length=20),
            nullable=True,
        ),
        sa.Column(
            'due_date',
            sqlmodel.sql.sqltypes.AutoString(length=20),
            nullable=True,
        ),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('parent_id', sa.Uuid(), nullable=True),
        sa.Column(
            'blocked_by_task_ids',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column('is_milestone', sa.Boolean(), nullable=False),
        sa.Column(
            'recurrence_rule',
            sqlmodel.sql.sqltypes.AutoString(length=500),
            nullable=True,
        ),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column(
            'field_values',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            'outgoing_references',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column('is_deleted', sa.Boolean(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['organization_id'], ['login_organizations.id']),
        sa.ForeignKeyConstraint(['owner_id'], ['login_users.id']),
        sa.ForeignKeyConstraint(['parent_id'], ['projects_tasks.id']),
        sa.ForeignKeyConstraint(['project_id'], ['projects_projects.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_projects_tasks_organization_id'),
        'projects_tasks', ['organization_id'], unique=False,
    )
    op.create_index(
        op.f('ix_projects_tasks_owner_id'),
        'projects_tasks', ['owner_id'], unique=False,
    )
    op.create_index(
        op.f('ix_projects_tasks_parent_id'),
        'projects_tasks', ['parent_id'], unique=False,
    )
    op.create_index(
        op.f('ix_projects_tasks_project_id'),
        'projects_tasks', ['project_id'], unique=False,
    )
    op.create_index(
        op.f('ix_projects_tasks_status'),
        'projects_tasks', ['status'], unique=False,
    )
    op.create_index(
        op.f('ix_projects_tasks_visibility'),
        'projects_tasks', ['visibility'], unique=False,
    )

    # --- projects_views (composite PK) ---
    op.create_table(
        'projects_views',
        sa.Column(
            'id',
            sqlmodel.sql.sqltypes.AutoString(length=100),
            nullable=False,
        ),
        sa.Column('project_id', sa.Uuid(), nullable=False),
        sa.Column(
            'name',
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column(
            'type',
            sqlmodel.sql.sqltypes.AutoString(length=50),
            nullable=False,
        ),
        sa.Column('is_default', sa.Boolean(), nullable=False),
        sa.Column(
            'config',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects_projects.id']),
        sa.PrimaryKeyConstraint('id', 'project_id'),
    )
    op.create_index(
        op.f('ix_projects_views_project_id'),
        'projects_views', ['project_id'], unique=False,
    )

    # --- projects_activities (no content column) ---
    op.create_table(
        'projects_activities',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('task_id', sa.Uuid(), nullable=False),
        sa.Column('actor_id', sa.Uuid(), nullable=False),
        sa.Column(
            'action',
            sqlmodel.sql.sqltypes.AutoString(length=50),
            nullable=False,
        ),
        sa.Column(
            'field_id',
            sqlmodel.sql.sqltypes.AutoString(length=100),
            nullable=True,
        ),
        sa.Column(
            'previous_value',
            sqlmodel.sql.sqltypes.AutoString(),
            nullable=True,
        ),
        sa.Column(
            'new_value',
            sqlmodel.sql.sqltypes.AutoString(),
            nullable=True,
        ),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['actor_id'], ['login_users.id']),
        sa.ForeignKeyConstraint(['task_id'], ['projects_tasks.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_projects_activities_task_id'),
        'projects_activities', ['task_id'], unique=False,
    )

    # --- Miscellaneous FK fixes from autogeneration ---
    op.drop_constraint(
        op.f('uq_attachments_file_id'),
        'attachments_attachments', type_='unique',
    )
    op.drop_index(
        op.f('ix_attachments_attachments_file_id'),
        table_name='attachments_attachments',
    )
    op.create_index(
        op.f('ix_attachments_attachments_file_id'),
        'attachments_attachments', ['file_id'], unique=True,
    )
    op.drop_constraint(
        op.f('attachments_attachments_file_id_fkey'),
        'attachments_attachments', type_='foreignkey',
    )
    op.create_foreign_key(
        None, 'attachments_attachments',
        'files_files', ['file_id'], ['id'],
    )
    op.drop_constraint(
        op.f('bookmarks_user_id_fkey'),
        'bookmarks', type_='foreignkey',
    )
    op.drop_constraint(
        op.f('bookmarks_organization_id_fkey'),
        'bookmarks', type_='foreignkey',
    )
    op.create_foreign_key(
        None, 'bookmarks',
        'login_organizations', ['organization_id'], ['id'],
    )
    op.create_foreign_key(
        None, 'bookmarks',
        'login_users', ['user_id'], ['id'],
    )
    op.drop_index(
        op.f('ix_files_multipart_uploads_status'),
        table_name='files_multipart_uploads',
    )
    op.drop_constraint(
        op.f('login_user_sessions_user_id_fkey'),
        'login_user_sessions', type_='foreignkey',
    )
    op.create_foreign_key(
        None, 'login_user_sessions',
        'login_users', ['user_id'], ['id'],
    )
    op.alter_column(
        'permissions_org_defaults', 'updated_at',
        existing_type=postgresql.TIMESTAMP(timezone=True),
        nullable=True,
    )
    op.drop_constraint(
        op.f('permissions_org_defaults_organization_id_fkey'),
        'permissions_org_defaults', type_='foreignkey',
    )
    op.create_foreign_key(
        None, 'permissions_org_defaults',
        'login_organizations', ['organization_id'], ['id'],
    )
    op.drop_index(
        op.f('ix_settings_profiles_is_default'),
        table_name='settings_profiles',
    )
    op.drop_constraint(
        op.f('settings_profiles_user_id_fkey'),
        'settings_profiles', type_='foreignkey',
    )
    op.create_foreign_key(
        None, 'settings_profiles',
        'login_users', ['user_id'], ['id'],
    )


def downgrade() -> None:
    """Remove projects domain tables and revert FK fixes."""
    op.drop_constraint(
        None, 'settings_profiles', type_='foreignkey',
    )
    op.create_foreign_key(
        op.f('settings_profiles_user_id_fkey'),
        'settings_profiles', 'login_users',
        ['user_id'], ['id'], ondelete='CASCADE',
    )
    op.create_index(
        op.f('ix_settings_profiles_is_default'),
        'settings_profiles', ['is_default'], unique=False,
    )
    op.drop_constraint(
        None, 'permissions_org_defaults', type_='foreignkey',
    )
    op.create_foreign_key(
        op.f('permissions_org_defaults_organization_id_fkey'),
        'permissions_org_defaults', 'login_organizations',
        ['organization_id'], ['id'], ondelete='CASCADE',
    )
    op.alter_column(
        'permissions_org_defaults', 'updated_at',
        existing_type=postgresql.TIMESTAMP(timezone=True),
        nullable=False,
    )
    op.drop_constraint(
        None, 'login_user_sessions', type_='foreignkey',
    )
    op.create_foreign_key(
        op.f('login_user_sessions_user_id_fkey'),
        'login_user_sessions', 'login_users',
        ['user_id'], ['id'], ondelete='CASCADE',
    )
    op.create_index(
        op.f('ix_files_multipart_uploads_status'),
        'files_multipart_uploads', ['status'], unique=False,
    )
    op.drop_constraint(
        None, 'bookmarks', type_='foreignkey',
    )
    op.drop_constraint(
        None, 'bookmarks', type_='foreignkey',
    )
    op.create_foreign_key(
        op.f('bookmarks_organization_id_fkey'),
        'bookmarks', 'login_organizations',
        ['organization_id'], ['id'], ondelete='CASCADE',
    )
    op.create_foreign_key(
        op.f('bookmarks_user_id_fkey'),
        'bookmarks', 'login_users',
        ['user_id'], ['id'], ondelete='CASCADE',
    )
    op.drop_constraint(
        None, 'attachments_attachments', type_='foreignkey',
    )
    op.create_foreign_key(
        op.f('attachments_attachments_file_id_fkey'),
        'attachments_attachments', 'files_files',
        ['file_id'], ['id'], ondelete='CASCADE',
    )
    op.drop_index(
        op.f('ix_attachments_attachments_file_id'),
        table_name='attachments_attachments',
    )
    op.create_index(
        op.f('ix_attachments_attachments_file_id'),
        'attachments_attachments', ['file_id'], unique=False,
    )
    op.create_unique_constraint(
        op.f('uq_attachments_file_id'),
        'attachments_attachments', ['file_id'],
        postgresql_nulls_not_distinct=False,
    )
    op.drop_index(
        op.f('ix_projects_activities_task_id'),
        table_name='projects_activities',
    )
    op.drop_table('projects_activities')
    op.drop_index(
        op.f('ix_projects_views_project_id'),
        table_name='projects_views',
    )
    op.drop_table('projects_views')
    op.drop_index(
        op.f('ix_projects_tasks_visibility'),
        table_name='projects_tasks',
    )
    op.drop_index(
        op.f('ix_projects_tasks_status'),
        table_name='projects_tasks',
    )
    op.drop_index(
        op.f('ix_projects_tasks_project_id'),
        table_name='projects_tasks',
    )
    op.drop_index(
        op.f('ix_projects_tasks_parent_id'),
        table_name='projects_tasks',
    )
    op.drop_index(
        op.f('ix_projects_tasks_owner_id'),
        table_name='projects_tasks',
    )
    op.drop_index(
        op.f('ix_projects_tasks_organization_id'),
        table_name='projects_tasks',
    )
    op.drop_table('projects_tasks')
    op.drop_index(
        op.f('ix_projects_field_definitions_project_id'),
        table_name='projects_field_definitions',
    )
    op.drop_table('projects_field_definitions')
    op.drop_index(
        op.f('ix_projects_projects_visibility'),
        table_name='projects_projects',
    )
    op.drop_index(
        op.f('ix_projects_projects_owner_id'),
        table_name='projects_projects',
    )
    op.drop_index(
        op.f('ix_projects_projects_organization_id'),
        table_name='projects_projects',
    )
    op.drop_table('projects_projects')
