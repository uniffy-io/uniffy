"""AuditEvent model: central append-only audit log for the whole product."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum, String
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AuditResourceType(StrEnum):
    AGENT = "AGENT"
    AGENT_CHAT = "AGENT_CHAT"
    AGENT_CRON_TASK = "AGENT_CRON_TASK"
    AGENT_FOLDER = "AGENT_FOLDER"
    AGENT_RUNTIME_SETTINGS = "AGENT_RUNTIME_SETTINGS"
    BUDGET = "BUDGET"
    CALL = "CALL"
    CALENDAR_EVENT = "CALENDAR_EVENT"
    CHAT = "CHAT"
    CHAT_MESSAGE = "CHAT_MESSAGE"
    CONTENT_TYPE = "CONTENT_TYPE"
    CURRENCY_RATE = "CURRENCY_RATE"
    DEPLOYMENT = "DEPLOYMENT"
    DEPLOYMENT_ENCRYPTION_KEY = "DEPLOYMENT_ENCRYPTION_KEY"
    EMAIL = "EMAIL"
    FILE = "FILE"
    FOLDER = "FOLDER"
    GROUP = "GROUP"
    IDENTITY_SOURCE = "IDENTITY_SOURCE"
    INTEGRATION_CONNECTION = "INTEGRATION_CONNECTION"
    INVITATION = "INVITATION"
    MAIL_CONFIG = "MAIL_CONFIG"
    MAIL_SUPPRESSION = "MAIL_SUPPRESSION"
    NOTE = "NOTE"
    ORGANIZATION = "ORGANIZATION"
    PROJECT = "PROJECT"
    PROVIDER_KEY = "PROVIDER_KEY"
    RATE_LIMIT = "RATE_LIMIT"
    ROOM = "ROOM"
    RUNTIME_SETTINGS = "RUNTIME_SETTINGS"
    SKILL = "SKILL"
    RULE = "RULE"
    SKILL_EVALUATION_CASE = "SKILL_EVALUATION_CASE"
    SKILL_EVALUATION_RUN = "SKILL_EVALUATION_RUN"
    SUPPORT_SESSION = "SUPPORT_SESSION"
    SYSTEM_FLAG = "SYSTEM_FLAG"
    SYSTEM_MAIL_CONFIG = "SYSTEM_MAIL_CONFIG"
    TAG = "TAG"
    TASK = "TASK"
    TEAM = "TEAM"
    USER = "USER"
    USER_QUOTA = "USER_QUOTA"
    USER_SESSION = "USER_SESSION"


class AuditActorKind(StrEnum):
    AGENT = "agent"
    SUPPORT = "support"


class AuditEvent(SQLModel, table=True):
    """An append-only audit log entry recording a single mutation.
    Range-partitioned monthly on ``created_at``.
    """

    __tablename__ = "audit_events"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID | None = Field(default=None)
    actor_user_id: UUID | None = Field(default=None)
    actor_org_role: str | None = Field(
        default=None,
        sa_column=Column(String(32), nullable=True),
    )
    on_behalf_of_user_id: UUID | None = Field(default=None)
    action: str = Field(
        sa_column=Column(String(64), nullable=False),
    )
    resource_type: AuditResourceType | None = Field(
        default=None,
        sa_column=Column(
            Enum(
                AuditResourceType,
                native_enum=False,
                length=32,
                validate_strings=True,
            ),
            nullable=True,
        ),
    )
    resource_id: UUID | None = Field(default=None)
    details: dict = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False, server_default="{}"),
    )
    ip_address: str | None = Field(
        default=None,
        sa_column=Column(INET, nullable=True),
    )
    user_agent: str | None = Field(
        default=None,
        sa_column=Column(String(512), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        return (
            f"<AuditEvent(id={self.id}, action={self.action!r}, "
            f"actor={self.actor_user_id}, org={self.organization_id}, "
            f"created_at={self.created_at})>"
        )
