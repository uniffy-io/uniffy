"""Identity source and link models for directory sync."""

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import SubjectType, generate_id


class IdentitySourceKind(str, Enum):
    LOCAL = "LOCAL"
    SCIM = "SCIM"
    LDAP = "LDAP"
    OIDC = "OIDC"


class IdentitySource(SQLModel, table=True):
    """One directory backend an org syncs identities from.

    `config` holds non-secret settings only; secrets live in `org_settings`
    (`is_secret=True`, namespace 'identity') so `OrgCipher` encryption and DEK
    rotation cover them.
    """

    __tablename__ = "people_identity_sources"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(
        sa_column=Column(
            ForeignKey("login_organizations.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    kind: IdentitySourceKind = Field(nullable=False)
    name: str = Field(max_length=255, nullable=False)
    is_active: bool = Field(default=True, nullable=False)
    config: dict = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    )
    last_sync_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    last_sync_status: str | None = Field(default=None, max_length=50)
    last_sync_error: str | None = Field(default=None, max_length=2000)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        return f"<IdentitySource(id={self.id}, kind={self.kind}, name={self.name})>"


class IdentityLink(SQLModel, table=True):
    """Join between a local USER/GROUP row and its external record in one source.

    `subject_id` is polymorphic and carries NO foreign key; the platform
    `DeleteUser` path deletes a user's links explicitly. `external_dn` exists
    because AD's `manager` attribute is a Distinguished Name, not a GUID.
    """

    __tablename__ = "people_identity_links"
    __table_args__ = (
        UniqueConstraint(
            "source_id", "subject_type", "external_id", name="uq_people_identity_links_external"
        ),
        UniqueConstraint(
            "source_id", "subject_type", "subject_id", name="uq_people_identity_links_subject"
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(
        sa_column=Column(
            ForeignKey("login_organizations.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    source_id: UUID = Field(
        sa_column=Column(
            ForeignKey("people_identity_sources.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    subject_type: SubjectType = Field(nullable=False)
    subject_id: UUID = Field(nullable=False, index=True)
    external_id: str = Field(max_length=512, nullable=False)
    external_dn: str | None = Field(default=None, max_length=1024)
    raw: dict = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    )
    synced_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        return (
            f"<IdentityLink(source_id={self.source_id}, subject_type={self.subject_type}, "
            f"subject_id={self.subject_id})>"
        )
