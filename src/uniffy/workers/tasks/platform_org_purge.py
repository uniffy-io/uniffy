"""ARQ cron: warn org owners 24h before a soft-deleted workspace is purged.

Daily sweep. Picks every ``login_organizations`` row whose
``deleted_at + (PURGE_GRACE_DAYS - 1) <= now()`` and
``purge_warning_sent_at IS NULL``. For each, fan-out a
``platform/org_purge_warning`` email to every active org OWNER and
stamp ``purge_warning_sent_at`` so the cron stays idempotent.

The actual hard purge is intentionally not automated yet. Tenant
content cascades touch ~20 tables (notes, files, chat, agents, ...)
and the FK schema is not uniformly ``ON DELETE CASCADE``; an
automated cascade would silently fail or leave orphans. Operators
hard-delete from the platform UI after the grace window expires.

Idempotency: ``purge_warning_sent_at`` is the only flag the cron
checks, so two pods cannot double-send.
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
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.valkey.ops import _get_ops_client
from uniffy.core.valkey.queue import get_queue
from uniffy.db.session import open_session

PURGE_GRACE_DAYS = 30
_LOCK_KEY = "platform_org_purge_warning:lock"
_LOCK_TTL_SECONDS = 300
_TEMPLATE = "platform/org_purge_warning"


async def _acquire_lock() -> bool:
    """Try to acquire the warning-cron lock. Returns True on success."""
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
    """Enqueue one ``platform/org_purge_warning`` email."""
    try:
        queue = get_queue("core")
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
        "send_email",
        recipient,
        _TEMPLATE,
        json.dumps(context),
        organization_id=str(org.id),
        idempotency_key=idempotency_key,
        user_id=str(user_id),
    )


async def notify_pending_org_purges(ctx: dict[str, Any]) -> dict[str, Any]:
    """Email org owners 24h before purge fires. Idempotent per-org."""
    del ctx
    if not await _acquire_lock():
        return {"status": "skipped", "reason": "lock_held"}

    warned_orgs = 0
    emails_sent = 0
    try:
        now = datetime.now(UTC)
        # Warn one day before the grace window ends.
        warn_cutoff = now - timedelta(days=PURGE_GRACE_DAYS - 1)

        async with open_session() as session:
            eligible = (
                await session.execute(
                    select(Organization)
                    .where(Organization.deleted_at.is_not(None))
                    .where(Organization.deleted_at <= warn_cutoff)
                    .where(Organization.purge_warning_sent_at.is_(None))
                )
            ).scalars().all()
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
                    resource_type="organization",
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
