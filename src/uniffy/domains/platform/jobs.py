"""Warn org owners when a soft-deleted workspace passes its restore window."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.jobs import enqueue_job
from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.valkey.ops import _get_ops_client
from uniffy.db.session import open_session
from uniffy.domains.mail.job_contracts import SEND_EMAIL

logger = logger.bind(component="platform.jobs")

PURGE_GRACE_DAYS = 30
_LOCK_KEY = "platform_org_purge_warning:lock"
NOTIFY_PENDING_ORG_PURGES_JOB_TIMEOUT_SECONDS = 300
_LOCK_TTL_SECONDS = NOTIFY_PENDING_ORG_PURGES_JOB_TIMEOUT_SECONDS + 30
_TEMPLATE = "platform/org_purge_warning"


async def _acquire_lock() -> str | None:
    client = _get_ops_client()
    if client is None:
        return None
    try:
        return await acquire_owned_job_lock(client, _LOCK_KEY, _LOCK_TTL_SECONDS)
    except Exception:
        logger.warning("platform_org_purge_warning: SET NX failed")
        return None


async def _release_lock(token: str) -> None:
    client = _get_ops_client()
    if client is None:
        return
    try:
        await release_owned_job_lock(client, _LOCK_KEY, token)
    except Exception:
        logger.warning("platform_org_purge_warning: DEL failed")


async def _enqueue_warning(
    recipient: str,
    org: Organization,
    purge_at: datetime,
    user_id: UUID,
) -> None:
    context: dict[str, Any] = {
        "org_name": org.name,
        "purge_at": purge_at.strftime("%B %d, %Y at %H:%M UTC"),
        "reason": org.deletion_reason or "",
    }
    idempotency_key = f"platform_purge_warning/{org.id}/{user_id}"
    try:
        await enqueue_job(
            SEND_EMAIL,
            recipient,
            _TEMPLATE,
            dumps_str(context),
            organization_id=str(org.id),
            idempotency_key=idempotency_key,
            user_id=str(user_id),
        )
    except RuntimeError:
        logger.warning(
            "platform_org_purge_warning: core queue not initialised",
            org_id=str(org.id),
        )


async def notify_pending_org_purges(ctx: dict[str, Any]) -> dict[str, Any]:
    """Email org owners as the restore window closes; idempotent per org."""
    del ctx
    lock_token = await _acquire_lock()
    if lock_token is None:
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
        await _release_lock(lock_token)
