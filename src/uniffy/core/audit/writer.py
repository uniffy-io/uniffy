"""The sole sanctioned writer for ``audit_events`` rows.

Every mutation call site that needs to record an audit event calls
:func:`write_audit_event`. The helper adds the row to the caller's
``AsyncSession`` without committing - the caller's surrounding
transaction commits both its domain mutation and the audit row in
lock-step, or rolls back both together.

Behaviour:

- The actor's ``OrganizationRole`` is captured via a single
  ``SELECT`` against ``login_organization_members``. No cache. Missing
  membership snapshots as ``NULL`` and the write proceeds.
- The client IP / User-Agent come from the request-context
  ``ContextVar`` populated by :class:`RequestContextMiddleware`.
  Worker / cron / system paths leave both fields ``NULL``.
- Exceptions are **never** swallowed. A writer failure rolls back the
  caller's mutation; the product treats audit gaps as bugs.
- ``dedupe_key`` is honoured via a Valkey ``SET NX`` lock keyed
  ``audit:debounce:{action}:{dedupe_key}`` with the caller-supplied
  TTL. On lock miss the writer returns without inserting.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.audit.request_context import audit_ip_var, audit_user_agent_var
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.valkey.ops import _get_ops_client, ops_call
from uniffy.observability.metrics import AUDIT_ROLE_LOOKUP_SECONDS

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


_DEDUPE_NAMESPACE = "audit"
_DEDUPE_KEY_PREFIX = "audit:debounce"
_DEFAULT_DEDUPE_TTL_SECONDS = 3600


async def write_audit_event(
    session: AsyncSession,
    *,
    organization_id: UUID | None,
    actor_user_id: UUID | None,
    action: str,
    resource_type: str | None = None,
    resource_id: UUID | None = None,
    details: dict | None = None,
    on_behalf_of_user_id: UUID | None = None,
    dedupe_key: str | None = None,
    dedupe_ttl_seconds: int = _DEFAULT_DEDUPE_TTL_SECONDS,
) -> AuditEvent | None:
    """Add an ``AuditEvent`` row to the caller's session.

    Parameters
    ----------
    session : AsyncSession
        Database session shared with the calling operation. The audit
        row is added but not committed; the caller's next commit
        persists it.
    organization_id : UUID | None
        Organization in which the action occurred. May be ``None`` for
        truly unattributable events (login failure for unknown email,
        cross-org system jobs).
    actor_user_id : UUID | None
        Human user who initiated the action. ``None`` for system-
        driven events. For agent-initiated actions, pass the human
        owner here and put ``{"actor_kind": "agent", "agent_id": ...}``
        in ``details``.
    action : str
        Dotted action identifier from :mod:`uniffy.core.audit.actions`.
    resource_type : str | None
        Polymorphic resource type (free string).
    resource_id : UUID | None
        Identifier of the affected resource.
    details : dict | None
        Action-specific structured payload. ``None`` is normalised to
        an empty dict.
    on_behalf_of_user_id : UUID | None
        Reserved for delegated-admin flows where actor and beneficiary
        diverge. Stays ``None`` outside that pattern.
    dedupe_key : str | None
        When set, the writer acquires a Valkey ``SET NX`` lock at
        ``audit:debounce:{action}:{dedupe_key}`` before inserting. On
        lock miss the writer returns ``None`` and no row is added.
        Used by spam-prone actions like ``auth.token_refreshed``.
    dedupe_ttl_seconds : int
        TTL for the dedupe lock. Ignored when ``dedupe_key`` is
        ``None``.

    Returns
    -------
    AuditEvent | None
        The added (uncommitted) row, or ``None`` when dedupe suppressed
        the write.

    """
    if dedupe_key is not None and not await _acquire_dedupe_lock(
        action, dedupe_key, dedupe_ttl_seconds
    ):
        return None

    actor_org_role = await _snapshot_actor_role(
        session, organization_id, actor_user_id
    )

    event = AuditEvent(
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        actor_org_role=actor_org_role,
        on_behalf_of_user_id=on_behalf_of_user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=details or {},
        ip_address=audit_ip_var.get(),
        user_agent=audit_user_agent_var.get(),
    )
    session.add(event)
    return event


async def _snapshot_actor_role(
    session: AsyncSession,
    organization_id: UUID | None,
    actor_user_id: UUID | None,
) -> str | None:
    """Look up the actor's current organization role.

    Returns the string value of :class:`OrganizationRole` or ``None``
    when no membership row exists (system events, deleted users, or
    cross-org system admins acting on a foreign org). Also returns
    ``None`` immediately when ``organization_id`` is ``None`` since
    there is no membership scope to look up.
    """
    if actor_user_id is None or organization_id is None:
        return None

    started = time.perf_counter()
    try:
        result = await session.execute(
            select(OrganizationMember.role).where(
                OrganizationMember.user_id == actor_user_id,
                OrganizationMember.organization_id == organization_id,
            )
        )
        role = result.scalar_one_or_none()
    finally:
        AUDIT_ROLE_LOOKUP_SECONDS.observe(time.perf_counter() - started)

    if role is None:
        return None
    return role.value if hasattr(role, "value") else str(role)


async def _acquire_dedupe_lock(
    action: str,
    dedupe_key: str,
    ttl_seconds: int,
) -> bool:
    """Try to acquire a debounce lock via Valkey ``SET NX``.

    Returns ``True`` when the lock is acquired (write should proceed)
    or when Valkey is unavailable (fail-open). Returns ``False`` only
    when an existing lock is held and dedupe should suppress the
    write.
    """
    client = _get_ops_client()
    if client is None:
        return True

    key = f"{_DEDUPE_KEY_PREFIX}:{action}:{dedupe_key}"
    try:
        async with ops_call(_DEDUPE_NAMESPACE, "dedupe_setnx"):
            stored = await client.set(key, "1", nx=True, ex=ttl_seconds)
    except Exception:  # noqa: BLE001
        logger.debug(
            "Valkey unavailable for audit dedupe lock; allowing write",
            action=action,
        )
        return True
    return bool(stored)
