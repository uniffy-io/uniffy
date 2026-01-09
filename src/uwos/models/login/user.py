"""User model."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    """
    User model representing a global user in the system.

    A user can belong to multiple organizations through OrganizationMember.
    This is a global user account that exists independently of organizations.

    Attributes
    ----------
    id : UUID
        Unique identifier for the user (primary key).
    email : str
        User's global email address (unique across the system).
    username : str
        User's global username (unique across the system).
    full_name : str | None
        User's full name (optional).
    hashed_password : str | None
        Bcrypt hashed password (nullable for SSO-only users).
    is_active : bool
        Whether the user account is active globally.
    is_system_admin : bool
        Whether the user has system-wide admin privileges (platform admin).
    email_verified : bool
        Whether the user's email has been verified.
    created_at : datetime
        Timestamp when the user was created.
    updated_at : datetime
        Timestamp when the user was last updated.

    """

    __tablename__ = "login_users"

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
    email: str = Field(max_length=255, unique=True, index=True, nullable=False)
    username: str = Field(max_length=255, unique=True, index=True, nullable=False)
    full_name: str | None = Field(default=None, max_length=255)
    hashed_password: str | None = Field(default=None, max_length=255)
    is_active: bool = Field(default=True, nullable=False)
    is_system_admin: bool = Field(default=False, nullable=False)
    email_verified: bool = Field(default=False, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        """Return string representation of User."""
        return f"<User(id={self.id}, username={self.username}, email={self.email})>"
