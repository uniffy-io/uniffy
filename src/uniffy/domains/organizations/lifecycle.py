"""Leaving, ownership transfer and soft deletion of an organization."""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.jobs import enqueue_job
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.calls import CallEndReason
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.realtime.publisher import publish_membership_revoke_safe
from uniffy.core.search import SearchIndexer
from uniffy.domains.calls.lifecycle import CallRevocationLifecycle
from uniffy.domains.mail.jobs.contracts import SEND_EMAIL
from uniffy.domains.organizations.operations import OrganizationOperations

logger = logger.bind(component="organizations.lifecycle")

PURGE_GRACE_DAYS = 30
OWNER_DELETION_REASON = "Deleted by the organization owner"
_ORG_DELETED_TEMPLATE = "platform/org_deleted"
_MAIL_DATE_FORMAT = "%B %d, %Y at %H:%M UTC"


def purge_at_from(deleted_at: datetime | None) -> datetime | None:
    if deleted_at is None:
        return None
    return deleted_at + timedelta(days=PURGE_GRACE_DAYS)


def _purge_at(org: Organization) -> datetime:
    purge_at = purge_at_from(org.deleted_at)
    if purge_at is None:
        raise ValidationError("organization", "Organization is not deleted")
    return purge_at


async def lock_organization(session: AsyncSession, org_id: UUID) -> Organization:
    """Concurrent deletes queue on this row lock, so the loser sees the winner's deleted_at."""
    org = (
        await session.execute(
            select(Organization)
            .where(Organization.id == org_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if org is None:
        raise NotFoundError("Organization", str(org_id))
    return org


async def _lock_membership(
    session: AsyncSession, user_id: UUID, org_id: UUID
) -> OrganizationMember | None:
    return (
        await session.execute(
            select(OrganizationMember)
            .where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == org_id,
            )
            .with_for_update(key_share=True)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def leave_organization(
    session: AsyncSession,
    *,
    user_id: UUID,
    org_id: UUID,
    search_indexer: SearchIndexer,
    call_lifecycle: CallRevocationLifecycle,
) -> None:
    ops = OrganizationOperations(session)
    await ops.require_org_member(user_id, org_id)

    membership = await _lock_membership(session, user_id, org_id)
    # A concurrent removal already did the work.
    if membership is None or not membership.is_active:
        return
    if membership.role == OrganizationRole.OWNER:
        raise PermissionDeniedError("Transfer ownership before leaving the organization")

    staged = await ops.stage_member_removal(
        membership,
        actor_user_id=user_id,
        action=Action.ORGANIZATION_MEMBER_LEFT,
    )
    await session.commit()
    await ops.finish_member_removal_after_commit(
        staged,
        actor_user_id=user_id,
        search_indexer=search_indexer,
        call_lifecycle=call_lifecycle,
    )


async def transfer_ownership(
    session: AsyncSession,
    *,
    owner_user_id: UUID,
    org_id: UUID,
    new_owner_user_id: UUID,
) -> tuple[OrganizationMember, OrganizationMember]:
    """The previous owner stays on as ADMIN, so the organization always keeps one OWNER."""
    await OrganizationOperations(session).require_org_owner(owner_user_id, org_id)
    if new_owner_user_id == owner_user_id:
        raise ValidationError("new_owner_user_id", "Already the owner")

    # One statement in a fixed order, so two concurrent transfers cannot deadlock.
    rows = (
        await session.execute(
            select(OrganizationMember, User)
            .join(User, User.id == OrganizationMember.user_id)
            .where(
                OrganizationMember.organization_id == org_id,
                OrganizationMember.user_id.in_([owner_user_id, new_owner_user_id]),
            )
            .order_by(OrganizationMember.user_id)
            .with_for_update(of=OrganizationMember, key_share=True)
            .execution_options(populate_existing=True)
        )
    ).all()
    by_user = {member.user_id: (member, user) for member, user in rows}

    previous = by_user.get(owner_user_id)
    if previous is None or not previous[0].is_active or previous[0].role != OrganizationRole.OWNER:
        raise PermissionDeniedError("Requires organization owner privileges")
    target = by_user.get(new_owner_user_id)
    if target is None or not target[0].is_active:
        raise NotFoundError("Member", str(new_owner_user_id))
    if not target[1].is_active:
        raise PermissionDeniedError("Ownership can only go to an active account")

    previous_owner, new_owner = previous[0], target[0]
    # Written before the swap so the actor's role snapshot reads OWNER.
    await write_audit_event(
        session,
        organization_id=org_id,
        actor_user_id=owner_user_id,
        action=Action.ORGANIZATION_OWNERSHIP_TRANSFERRED,
        resource_type=AuditResourceType.ORGANIZATION,
        resource_id=org_id,
        details={
            "previous_owner_user_id": str(owner_user_id),
            "new_owner_user_id": str(new_owner_user_id),
        },
    )
    now = datetime.now(UTC)
    new_owner.role = OrganizationRole.OWNER
    new_owner.updated_at = now
    previous_owner.role = OrganizationRole.ADMIN
    previous_owner.updated_at = now

    await session.commit()
    await session.refresh(new_owner)
    await session.refresh(previous_owner)
    return new_owner, previous_owner


async def active_member_ids(session: AsyncSession, org_id: UUID) -> list[UUID]:
    rows = (
        await session.execute(
            select(OrganizationMember.user_id)
            .where(OrganizationMember.organization_id == org_id)
            .where(OrganizationMember.is_active.is_(True))
        )
    ).all()
    return [row[0] for row in rows]


async def stage_organization_deletion(
    session: AsyncSession,
    org: Organization,
    *,
    actor_user_id: UUID,
    reason: str,
    action: Action,
) -> list[UUID]:
    """Soft delete; the purge job removes the rows once the grace window ends."""
    org.deleted_at = datetime.now(UTC)
    org.deleted_by_user_id = actor_user_id
    org.deletion_reason = reason
    org.purge_warning_sent_at = None
    session.add(org)

    member_ids = await active_member_ids(session, org.id)

    await write_audit_event(
        session,
        organization_id=org.id,
        actor_user_id=actor_user_id,
        action=action,
        resource_type=AuditResourceType.ORGANIZATION,
        resource_id=org.id,
        details={
            "reason": reason,
            "purge_at": _purge_at(org).isoformat(),
            "members_notified": [str(member_id) for member_id in member_ids],
        },
    )
    return member_ids


async def finish_organization_deletion_after_commit(
    session: AsyncSession,
    org: Organization,
    member_ids: list[UUID],
    *,
    call_lifecycle: CallRevocationLifecycle,
    reason: str,
    deleted_by_owner: bool,
) -> None:
    await call_lifecycle.end_for_organization(session, org.id, CallEndReason.ORG_DELETED)
    for member_id in member_ids:
        await publish_membership_revoke_safe(member_id, org.id)
    await enqueue_org_deleted_emails(session, org, reason, deleted_by_owner=deleted_by_owner)


async def enqueue_org_deleted_emails(
    session: AsyncSession, org: Organization, reason: str, *, deleted_by_owner: bool
) -> None:
    if org.deleted_at is None:
        return
    purge_at = purge_at_from(org.deleted_at)
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
    if not owners:
        return
    context: dict[str, Any] = {
        "org_name": org.name,
        "deleted_at": org.deleted_at.strftime(_MAIL_DATE_FORMAT),
        "purge_at": (purge_at.strftime(_MAIL_DATE_FORMAT) if purge_at else ""),
        "grace_days": PURGE_GRACE_DAYS,
        "reason": reason,
        "deleted_by_owner": deleted_by_owner,
    }
    for owner_id, email in owners:
        idempotency_key = f"platform_org_deleted/{org.id}/{owner_id}"
        try:
            await enqueue_job(
                SEND_EMAIL,
                email,
                _ORG_DELETED_TEMPLATE,
                dumps_str(context),
                organization_id=str(org.id),
                idempotency_key=idempotency_key,
                user_id=str(owner_id),
            )
        except RuntimeError:
            logger.warning(
                "org_deleted email enqueue skipped: core queue not initialised",
                org_id=str(org.id),
            )
            return


async def delete_organization_by_owner(
    session: AsyncSession,
    *,
    user_id: UUID,
    org_id: UUID,
    confirm_slug: str,
    call_lifecycle: CallRevocationLifecycle,
) -> datetime:
    ops = OrganizationOperations(session)
    await ops.require_org_owner(user_id, org_id)
    org = await lock_organization(session, org_id)
    # A concurrent delete won the row lock.
    if org.deleted_at is not None:
        return _purge_at(org)
    if confirm_slug.strip() != org.slug:
        raise ValidationError("confirm_slug", "Confirmation slug does not match")

    # Ownership must stay valid through commit, even after waiting for the org lock.
    await _lock_membership(session, user_id, org_id)
    await ops.require_org_owner(user_id, org_id)

    member_ids = await stage_organization_deletion(
        session,
        org,
        actor_user_id=user_id,
        reason=OWNER_DELETION_REASON,
        action=Action.ORGANIZATION_DELETED,
    )
    await session.commit()
    await finish_organization_deletion_after_commit(
        session,
        org,
        member_ids,
        call_lifecycle=call_lifecycle,
        reason=OWNER_DELETION_REASON,
        deleted_by_owner=True,
    )
    return _purge_at(org)
