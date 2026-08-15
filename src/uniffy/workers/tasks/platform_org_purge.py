"""Daily cron: email org owners when a soft-deleted workspace reaches the end
of its restore window.

Nothing erases tenant data today. Tenant cascades touch many tables without
uniform `ON DELETE CASCADE`, so an automated purge would orphan rows, and no
operator-facing purge RPC exists yet either. A soft-deleted org therefore stays
restorable indefinitely, and this mail says the window closed rather than
promising a deletion that will not happen. Idempotent via
`purge_warning_sent_at`.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.valkey.ops import _get_ops_client
from uniffy.core.valkey.queue import QueueName, get_queue
from uniffy.db.session import open_session
from uniffy.workers.tasks import JobName

logger = logger.bind(component="mail")

PURGE_GRACE_DAYS = 30
_LOCK_KEY = "platform_org_purge_warning:lock"
_LOCK_TTL_SECONDS = 300
_TEMPLATE = "platform/org_purge_warning"


async def _acquire_lock() -> bool:
    client = _get_ops_client()
    if client is None:
        return False
    try:
        return bool(await client.set(_LOCK_KEY, "1", ex=_LOCK_TTL_SECONDS, nx=True))
    except Exception:
        logger.warning("platform_org_purge_warning: SET NX failed")
        return False


async def _release_lock() -> None:
    client = _get_ops_client()
    if client is None:
        return
    try:
        await client.delete(_LOCK_KEY)
    except Exception:
        logger.warning("platform_org_purge_warning: DEL failed")


async def _enqueue_warning(
    recipient: str,
    org: Organization,
    purge_at: datetime,
    user_id: UUID,
) -> None:
    try:
        queue = get_queue(QueueName.CORE)
    except RuntimeError:
        logger.warning(
            "platform_org_purge_warning: core queue not initialised",
            component="mail",
            org_id=str(org.id),
        )
        return
    context: dict[str, Any] = {
        "org_name": org.name,
        "purge_at": purge_at.strftime("%B %d, %Y at %H:%M UTC"),
        "reason": org.deletion_reason or "",
    }
    idempotency_key = f"platform_purge_warning/{org.id}/{user_id}"
    await queue.enqueue_job(
        JobName.SEND_EMAIL,
        recipient,
        _TEMPLATE,
        json.dumps(context),
        organization_id=str(org.id),
        idempotency_key=idempotency_key,
        user_id=str(user_id),
    )


async def notify_pending_org_purges(ctx: dict[str, Any]) -> dict[str, Any]:
    """Email org owners as the restore window closes; idempotent per org."""
    del ctx
    if not await _acquire_lock():
        return {"status": "skipped", "reason": "lock_held"}

    warned_orgs = 0
    emails_sent = 0
    try:
        now = datetime.now(UTC)
        warn_cutoff = now - timedelta(days=PURGE_GRACE_DAYS - 1)

        async with open_session() as session:
            eligible = (
                (
                    await session.execute(
                        select(Organization)
                        .where(Organization.deleted_at.is_not(None))
                        .where(Organization.deleted_at <= warn_cutoff)
                        .where(Organization.purge_warning_sent_at.is_(None))
                    )
                )
                .scalars()
                .all()
            )
            for org in eligible:
                purge_at = org.deleted_at + timedelta(days=PURGE_GRACE_DAYS)
                owners = (
                    await session.execute(
                        select(User.id, User.email)
                        .join(
                            OrganizationMember,
                            OrganizationMember.user_id == User.id,
                        )
                        .where(OrganizationMember.organization_id == org.id)
                        .where(OrganizationMember.role == OrganizationRole.OWNER)
                        .where(OrganizationMember.is_active.is_(True))
                        .where(User.is_active.is_(True))
                    )
                ).all()
                for user_id, email in owners:
                    await _enqueue_warning(email, org, purge_at, user_id)
                    emails_sent += 1
                org.purge_warning_sent_at = now
                session.add(org)
                await write_audit_event(
                    session,
                    organization_id=org.id,
                    actor_user_id=None,
                    action=Action.ORGANIZATION_PURGE_WARNING_SENT,
                    resource_type=AuditResourceType.ORGANIZATION,
                    resource_id=org.id,
                    details={
                        "purge_at": purge_at.isoformat(),
                        "owner_count": len(owners),
                    },
                )
                warned_orgs += 1
            await session.commit()

        return {
            "status": "success",
            "warned_orgs": warned_orgs,
            "emails_sent": emails_sent,
        }
    except Exception as exc:
        logger.exception(f"platform_org_purge_warning failed: {exc}")
        return {"status": "error", "error": str(exc)[:500]}
    finally:
        await _release_lock()
