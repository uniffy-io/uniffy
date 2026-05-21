"""Central audit-log infrastructure.

Public surface:

- :func:`write_audit_event` - the only sanctioned writer. Mutation call
  sites import this and emit a row inside their own transaction.
- :class:`RequestContextMiddleware` - ASGI middleware that captures
  client IP / User-Agent into per-request :mod:`contextvars` so the
  writer can attach them without changing operation signatures.
- :mod:`actions` - canonical catalogue of dotted action identifiers.

Agent-as-actor attribution: when an agent acts on behalf of its
human owner, the audit row records the **human** owner in
``actor_user_id``. The agent's identity is surfaced through
``details = {"actor_kind": "agent", "agent_id": ..., ...}``. See the
``actions`` module's docstring for the full convention.
"""

from uniffy.core.audit.request_context import (
    RequestContextMiddleware,
    audit_ip_var,
    audit_user_agent_var,
)
from uniffy.core.audit.writer import write_audit_event

__all__ = [
    "RequestContextMiddleware",
    "audit_ip_var",
    "audit_user_agent_var",
    "write_audit_event",
]
