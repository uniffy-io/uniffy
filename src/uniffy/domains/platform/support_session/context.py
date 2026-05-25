"""Request-scoped tag for an active support session.

Set by the audit/session interceptor when the inbound JWT belongs
to a platform admin who has an active support session for the
request's target org. Read by:

* :func:`write_audit_event` -- merges
  ``actor_kind="support"``, ``support_session_id`` and ``scope``
  into every ``details`` JSON written during the session.
* :class:`OrgCipher` -- default-denies decrypt + writes a bridge-
  attempt audit row unless the caller explicitly opts in with
  ``allow_support_session_bridge=True``.

When unset (worker, cron, regular tenant user) every consumer
treats it as no-session and behaves normally.
"""

from contextvars import ContextVar
from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class ActiveSupportSession:
    """Snapshot of the active support session for the current request."""

    session_id: UUID
    organization_id: UUID
    support_user_id: UUID
    scope: str  # SupportSessionScope value


active_support_session_var: ContextVar[ActiveSupportSession | None] = ContextVar(
    "active_support_session", default=None
)


def get_active_support_session() -> ActiveSupportSession | None:
    """Read the current request's active session, if any."""
    return active_support_session_var.get()


__all__ = [
    "ActiveSupportSession",
    "active_support_session_var",
    "get_active_support_session",
]
