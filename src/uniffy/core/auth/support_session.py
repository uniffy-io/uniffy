"""Request-scoped support-session facts shared by authorization consumers."""

from contextvars import ContextVar
from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class ActiveSupportSession:
    session_id: UUID
    organization_id: UUID
    support_user_id: UUID
    scope: str  # SupportSessionScope value


active_support_session_var: ContextVar[ActiveSupportSession | None] = ContextVar(
    "active_support_session", default=None
)


def get_active_support_session() -> ActiveSupportSession | None:
    return active_support_session_var.get()


__all__ = [
    "ActiveSupportSession",
    "active_support_session_var",
    "get_active_support_session",
]
