"""Push subscription model for Web Push notifications."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class PushSubscription(SQLModel, table=True):
    """
    Push subscription model for Web Push notification delivery.

    Stores browser push subscription endpoints for each user. Each user
    can have multiple subscriptions (one per browser/device).

    Attributes
    ----------
    id : UUID
        Unique identifier for the subscription (primary key).
    user_id : UUID
        User who owns this subscription (foreign key to login_users).
    endpoint : str
        Web Push endpoint URL.
    p256dh_key : str
        VAPID p256dh public key.
    auth_key : str
        VAPID auth secret.
    user_agent : str | None
        Browser user agent string for identification.
    created_at : datetime
        Timestamp when the subscription was created.
    last_used_at : datetime | None
        Timestamp when the subscription was last used for delivery.

    """

    __tablename__ = "push_subscriptions"
    __table_args__ = (
        UniqueConstraint("user_id", "endpoint", name="uq_push_subscriptions_user_endpoint"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    endpoint: str = Field(max_length=2000, nullable=False)
    p256dh_key: str = Field(max_length=500, nullable=False)
    auth_key: str = Field(max_length=500, nullable=False)
    user_agent: str | None = Field(default=None, max_length=500)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    last_used_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    def __repr__(self) -> str:
        """Return string representation of PushSubscription."""
        return (
            f"<PushSubscription(id={self.id}, user_id={self.user_id}, "
            f"endpoint={self.endpoint[:50]}...)>"
        )
