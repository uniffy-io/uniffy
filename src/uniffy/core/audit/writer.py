"""Sole sanctioned writer for ``audit_events`` rows.

The row is added to the caller's session without committing, so the domain
mutation and the audit row commit (or roll back) atomically.
"""

from __future__ import annotations

import hashlib
import time
from typing import TYPE_CHECKING
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.audit.metrics import AUDIT_ROLE_LOOKUP_SECONDS
from uniffy.core.audit.request_context import audit_ip_var, audit_user_agent_var
from uniffy.core.models.audit.event import AuditActorKind, AuditEvent, AuditResourceType
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.valkey.ops import _get_ops_client, ops_call

logger = logger.bind(component="audit.writer")

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


_DEDUPE_NAMESPACE = "audit"
_DEDUPE_KEY_PREFIX = "audit:debounce"
_DEFAULT_DEDUPE_TTL_SECONDS = 3600


def email_hash(email: str | None) -> str | None:
    """SHA-256 of the lower-cased address. Correlates rows about the same
    account without putting the address itself in a long-retention table
    that org admins can read.
    """
    if not email:
        return None
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()


async def write_audit_event(
    session: AsyncSession,
    *,
    organization_id: UUID | None,
    actor_user_id: UUID | None,
    action: str,
    resource_type: AuditResourceType | None = None,
    resource_id: UUID | None = None,
    details: dict | None = None,
    on_behalf_of_user_id: UUID | None = None,
    dedupe_key: str | None = None,
    dedupe_ttl_seconds: int = _DEFAULT_DEDUPE_TTL_SECONDS,
) -> AuditEvent | None:
    """Add an ``AuditEvent`` row to the caller's session.

    When ``dedupe_key`` is set, a Valkey ``SET NX`` lock at
    ``audit:debounce:{action}:{dedupe_key}`` debounces spam-prone actions
    (e.g. ``auth.token_refreshed``); on lock miss the writer returns ``None``.
    """
    if dedupe_key is not None and not await _acquire_dedupe_lock(
        action, dedupe_key, dedupe_ttl_seconds
    ):
        return None

    actor_org_role = await _snapshot_actor_role(session, organization_id, actor_user_id)

    merged_details = dict(details or {})
    _merge_support_session_tag(merged_details, organization_id)

    event = AuditEvent(
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        actor_org_role=actor_org_role,
        on_behalf_of_user_id=on_behalf_of_user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=merged_details,
        ip_address=audit_ip_var.get(),
        user_agent=audit_user_agent_var.get(),
    )
    session.add(event)
    return event


def _merge_support_session_tag(details: dict, organization_id: UUID | None) -> None:
    """Stamp ``actor_kind``/``support_session_id``/``scope`` when a support session is active.

    The ``actor_kind`` field is overwritten unconditionally - a session tag is a
    fact about the request, not a hint the caller can drop. The caller's prior
    value (if any) moves to ``actor_kind_pre`` so no information is lost.
    """
    from uniffy.core.auth.support_session import (
        get_active_support_session,
    )

    active = get_active_support_session()
    if active is None:
        return
    if organization_id is not None and active.organization_id != organization_id:
        return
    prior = details.get("actor_kind")
    if prior is not None and prior != AuditActorKind.SUPPORT:
        details["actor_kind_pre"] = prior
    details["actor_kind"] = AuditActorKind.SUPPORT
    details["support_session_id"] = str(active.session_id)
    details["scope"] = active.scope


async def _snapshot_actor_role(
    session: AsyncSession,
    organization_id: UUID | None,
    actor_user_id: UUID | None,
) -> str | None:
    """Snapshot the actor's current org role (``None`` when there is no membership scope)."""
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
    """Acquire a debounce lock via Valkey ``SET NX``; fail-open when Valkey is unavailable."""
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
