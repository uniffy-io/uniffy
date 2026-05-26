"""Cross-tenant organizations + users operations for platform operators.

Every method on :class:`PlatformDirectoryOperations` requires the
calling ``user_id`` to belong to a user with ``is_system_admin=true``.
None of the methods bypass :class:`PermissionChecker` -- tenant
content is unreachable through this slice. The fields returned here
are metadata only (counts, status, timestamps).

Destructive paths are narrow and reversible up to a point:

* :meth:`suspend_organization` flips ``is_suspended`` and bumps
  ``token_version`` on every member so existing JWTs are killed at
  the next refresh. Reversible via :meth:`unsuspend_organization`,
  but members must re-login.
* :meth:`delete_organization` stamps ``deleted_at`` (soft delete).
  An ARQ cron purges rows 30d later. Reversible via
  :meth:`restore_organization` until the purge fires.
* :meth:`force_logout_user` bumps ``token_version`` on one user.
* :meth:`set_system_admin` flips ``is_system_admin``. Callers cannot
  demote themselves.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any, NamedTuple
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.mail.config import MAIL_NAMESPACE, MailConfig
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.crypto.org_encryption_key import OrgEncryptionKey
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.models.settings.deployment_setting import DeploymentSetting
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.core.realtime.publisher import publish_token_revoke
from uniffy.core.users.cache import invalidate_user_profile
from uniffy.core.valkey.queue import get_queue
from uniffy.core.valkey.rate_limit import check_rate_limit
from uniffy.domains.auth.revocation import mark_token_version_revoked
from uniffy.domains.users.operations import UserOperations


async def _safe_publish_token_revoke(user_id: UUID, version: int) -> None:
    """Publish the realtime token-revoke ping with a warning on failure.

    The Valkey ``min_tkv`` watermark is the authoritative gate now
    (set before this is called); the realtime publish is a UX-only
    nudge so live WebSockets close immediately. Surfacing the failure
    keeps a Valkey pubsub outage visible in logs rather than silent.
    """
    try:
        await publish_token_revoke(user_id, version)
    except Exception:
        logger.warning(
            "platform: realtime token_revoke publish failed; "
            "the min_tkv watermark still enforces revocation on next request",
            user_id=str(user_id),
            version=version,
        )


DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200
PURGE_GRACE_DAYS = 30

# Per-operator throughput caps on platform mutations. Cheap insurance
# against a compromised operator account or a runaway script
# fan-out: the limits are well above legitimate hand-driven use.
_PLATFORM_MUTATION_LIMIT = 20
_PLATFORM_MUTATION_WINDOW_SECONDS = 60
_PLATFORM_SUSPEND_LIMIT = 10
_PLATFORM_SUSPEND_WINDOW_SECONDS = 60


def _operator_mutation_key(user_id: UUID, scope: str) -> str:
    return f"rl:platform:{scope}:{user_id}"


class PlatformOrgSummary(NamedTuple):
    """One row in the cross-tenant organizations table."""

    id: UUID
    name: str
    slug: str
    plan: str
    member_count: int
    mail_config_source: str  # 'per_org' | 'deployment' | 'env' | 'none'
    encryption_version: int
    last_activity_at: datetime | None
    last_login_at: datetime | None
    is_suspended: bool
    deleted_at: datetime | None
    purge_at: datetime | None
    created_at: datetime


class PlatformOrgOwner(NamedTuple):
    user_id: UUID
    email: str
    full_name: str | None
    joined_at: datetime


class PlatformOrgDetail(NamedTuple):
    summary: PlatformOrgSummary
    domain: str | None
    logo_url: str | None
    owners: list[PlatformOrgOwner]
    suspension_reason: str | None
    deletion_reason: str | None


class PlatformOrgPage(NamedTuple):
    rows: list[PlatformOrgSummary]
    total_count: int
    page: int
    page_size: int


class PlatformUserSummary(NamedTuple):
    """One row in the cross-tenant users table."""

    id: UUID
    email: str
    username: str
    full_name: str | None
    is_active: bool
    is_system_admin: bool
    email_verified: bool
    mfa_enabled: bool  # placeholder; MFA not shipped
    org_memberships_count: int
    last_login_at: datetime | None
    created_at: datetime


class PlatformUserMembership(NamedTuple):
    organization_id: UUID
    organization_name: str
    organization_slug: str
    role: str
    joined_at: datetime
    is_active: bool
    is_suspended: bool
    deleted_at: datetime | None


class PlatformUserDetail(NamedTuple):
    summary: PlatformUserSummary
    memberships: list[PlatformUserMembership]


class PlatformUserPage(NamedTuple):
    rows: list[PlatformUserSummary]
    total_count: int
    page: int
    page_size: int


def _clamp_page_size(page_size: int) -> int:
    if page_size <= 0:
        return DEFAULT_PAGE_SIZE
    return min(page_size, MAX_PAGE_SIZE)


def _safe_page(page: int) -> int:
    return page if page > 0 else 0


def _purge_at_from(deleted_at: datetime | None) -> datetime | None:
    if deleted_at is None:
        return None
    return deleted_at + timedelta(days=PURGE_GRACE_DAYS)


class PlatformDirectoryOperations:
    """Platform-operator org + user directory. Gated on ``is_system_admin``."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._user_ops = UserOperations(session)

    async def list_organizations(
        self,
        *,
        user_id: UUID,
        page: int,
        page_size: int,
        search: str = "",
        include_deleted: bool = False,
        only_suspended: bool = False,
    ) -> PlatformOrgPage:
        """Paginated cross-tenant organization list with metadata."""
        await self._user_ops.require_system_admin(user_id)
        page = _safe_page(page)
        page_size = _clamp_page_size(page_size)

        conditions = []
        if not include_deleted:
            conditions.append(Organization.deleted_at.is_(None))
        if only_suspended:
            conditions.append(Organization.is_suspended.is_(True))

        normalized_search = search.strip().lower() if search else ""
        if normalized_search:
            pattern = f"%{normalized_search}%"
            conditions.append(
                or_(
                    func.lower(Organization.name).like(pattern),
                    func.lower(Organization.slug).like(pattern),
                )
            )

        where_clause = and_(*conditions) if conditions else None

        count_query = select(func.count()).select_from(Organization)
        if where_clause is not None:
            count_query = count_query.where(where_clause)
        total = (await self._session.execute(count_query)).scalar_one()

        page_query = select(Organization).order_by(Organization.name.asc())
        if where_clause is not None:
            page_query = page_query.where(where_clause)
        page_query = page_query.limit(page_size).offset(page * page_size)
        orgs = (await self._session.execute(page_query)).scalars().all()

        if not orgs:
            return PlatformOrgPage(
                rows=[], total_count=int(total), page=page, page_size=page_size
            )

        org_ids = [org.id for org in orgs]
        member_counts = await self._fetch_member_counts(org_ids)
        mail_sources = await self._fetch_mail_sources(org_ids)
        encryption_versions = await self._fetch_encryption_versions(org_ids)
        last_activity = await self._fetch_audit_max(org_ids, action=None)
        last_login = await self._fetch_audit_max(org_ids, action=Action.AUTH_LOGIN_SUCCESS)

        rows: list[PlatformOrgSummary] = []
        for org in orgs:
            rows.append(
                PlatformOrgSummary(
                    id=org.id,
                    name=org.name,
                    slug=org.slug,
                    plan=org.plan,
                    member_count=member_counts.get(org.id, 0),
                    mail_config_source=mail_sources.get(org.id, "none"),
                    encryption_version=encryption_versions.get(org.id, 0),
                    last_activity_at=last_activity.get(org.id),
                    last_login_at=last_login.get(org.id),
                    is_suspended=org.is_suspended,
                    deleted_at=org.deleted_at,
                    purge_at=_purge_at_from(org.deleted_at),
                    created_at=org.created_at,
                )
            )

        return PlatformOrgPage(
            rows=rows,
            total_count=int(total),
            page=page,
            page_size=page_size,
        )

    async def get_organization(
        self, *, user_id: UUID, organization_id: UUID
    ) -> PlatformOrgDetail:
        """Full detail for one org. Owners list + recent platform audit."""
        await self._user_ops.require_system_admin(user_id)
        org = await self._require_org(organization_id)

        member_count = (await self._fetch_member_counts([org.id])).get(org.id, 0)
        mail_source = (await self._fetch_mail_sources([org.id])).get(org.id, "none")
        encryption_version = (
            await self._fetch_encryption_versions([org.id])
        ).get(org.id, 0)
        last_activity = (
            await self._fetch_audit_max([org.id], action=None)
        ).get(org.id)
        last_login = (
            await self._fetch_audit_max([org.id], action=Action.AUTH_LOGIN_SUCCESS)
        ).get(org.id)

        owners = await self._fetch_owners(org.id)

        summary = PlatformOrgSummary(
            id=org.id,
            name=org.name,
            slug=org.slug,
            plan=org.plan,
            member_count=member_count,
            mail_config_source=mail_source,
            encryption_version=encryption_version,
            last_activity_at=last_activity,
            last_login_at=last_login,
            is_suspended=org.is_suspended,
            deleted_at=org.deleted_at,
            purge_at=_purge_at_from(org.deleted_at),
            created_at=org.created_at,
        )
        return PlatformOrgDetail(
            summary=summary,
            domain=org.domain,
            logo_url=None,
            owners=owners,
            suspension_reason=org.suspension_reason,
            deletion_reason=org.deletion_reason,
        )

    async def suspend_organization(
        self, *, user_id: UUID, organization_id: UUID, reason: str
    ) -> PlatformOrgDetail:
        """Block sign-in + revoke every member's existing JWTs."""
        await self._user_ops.require_system_admin(user_id)
        await check_rate_limit(
            key=_operator_mutation_key(user_id, "suspend"),
            limit=_PLATFORM_SUSPEND_LIMIT,
            window_seconds=_PLATFORM_SUSPEND_WINDOW_SECONDS,
            resource="platform organization suspensions",
        )
        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")

        org = await self._require_org(organization_id)
        if org.deleted_at is not None:
            raise ValidationError(
                "organization", "Cannot suspend a deleted organization"
            )
        if org.is_suspended:
            return await self.get_organization(
                user_id=user_id, organization_id=organization_id
            )

        org.is_suspended = True
        org.suspended_at = datetime.now(UTC)
        org.suspended_by_user_id = user_id
        org.suspension_reason = reason
        self._session.add(org)

        bumped_user_ids = await self._bump_member_token_versions(org.id)

        await write_audit_event(
            self._session,
            organization_id=org.id,
            actor_user_id=user_id,
            action=Action.ORGANIZATION_SUSPENDED,
            resource_type="organization",
            resource_id=org.id,
            details={"reason": reason, "member_token_versions_bumped": bumped_user_ids},
        )
        await self._session.commit()

        for member_id in bumped_user_ids:
            await invalidate_user_profile(member_id)

        await self._publish_member_token_revokes(bumped_user_ids)

        return await self.get_organization(
            user_id=user_id, organization_id=organization_id
        )

    async def unsuspend_organization(
        self, *, user_id: UUID, organization_id: UUID, reason: str
    ) -> PlatformOrgDetail:
        """Clear the suspension flag. Existing JWTs are still dead."""
        await self._user_ops.require_system_admin(user_id)
        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")

        org = await self._require_org(organization_id)
        if not org.is_suspended:
            return await self.get_organization(
                user_id=user_id, organization_id=organization_id
            )

        org.is_suspended = False
        org.suspended_at = None
        org.suspended_by_user_id = None
        org.suspension_reason = None
        self._session.add(org)

        await write_audit_event(
            self._session,
            organization_id=org.id,
            actor_user_id=user_id,
            action=Action.ORGANIZATION_UNSUSPENDED,
            resource_type="organization",
            resource_id=org.id,
            details={"reason": reason},
        )
        await self._session.commit()

        return await self.get_organization(
            user_id=user_id, organization_id=organization_id
        )

    async def delete_organization(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        confirm_slug: str,
        reason: str,
    ) -> PlatformOrgDetail:
        """Soft-delete: stamp ``deleted_at``. ARQ purges 30d later."""
        await self._user_ops.require_system_admin(user_id)
        await check_rate_limit(
            key=_operator_mutation_key(user_id, "delete_org"),
            limit=_PLATFORM_SUSPEND_LIMIT,
            window_seconds=_PLATFORM_SUSPEND_WINDOW_SECONDS,
            resource="platform organization deletions",
        )
        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")

        org = await self._require_org(organization_id)
        if confirm_slug.strip() != org.slug:
            raise ValidationError(
                "confirm_slug",
                "Confirmation slug does not match",
            )
        if org.deleted_at is not None:
            return await self.get_organization(
                user_id=user_id, organization_id=organization_id
            )

        org.deleted_at = datetime.now(UTC)
        org.deleted_by_user_id = user_id
        org.deletion_reason = reason
        org.purge_warning_sent_at = None
        self._session.add(org)

        bumped_user_ids = await self._bump_member_token_versions(org.id)

        await write_audit_event(
            self._session,
            organization_id=org.id,
            actor_user_id=user_id,
            action=Action.ORGANIZATION_DELETED_BY_PLATFORM,
            resource_type="organization",
            resource_id=org.id,
            details={
                "reason": reason,
                "purge_at": _purge_at_from(org.deleted_at).isoformat()
                if org.deleted_at
                else None,
                "member_token_versions_bumped": bumped_user_ids,
            },
        )
        await self._session.commit()

        for member_id in bumped_user_ids:
            await invalidate_user_profile(member_id)
        await self._publish_member_token_revokes(bumped_user_ids)

        await self._enqueue_org_deleted_emails(org, reason)

        return await self.get_organization(
            user_id=user_id, organization_id=organization_id
        )

    async def restore_organization(
        self, *, user_id: UUID, organization_id: UUID, reason: str
    ) -> PlatformOrgDetail:
        """Clear ``deleted_at``. Only effective pre-purge."""
        await self._user_ops.require_system_admin(user_id)
        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")

        org = await self._require_org(organization_id)
        if org.deleted_at is None:
            return await self.get_organization(
                user_id=user_id, organization_id=organization_id
            )

        org.deleted_at = None
        org.deleted_by_user_id = None
        org.deletion_reason = None
        org.purge_warning_sent_at = None
        self._session.add(org)

        await write_audit_event(
            self._session,
            organization_id=org.id,
            actor_user_id=user_id,
            action=Action.ORGANIZATION_RESTORED,
            resource_type="organization",
            resource_id=org.id,
            details={"reason": reason},
        )
        await self._session.commit()

        return await self.get_organization(
            user_id=user_id, organization_id=organization_id
        )

    async def list_users(
        self,
        *,
        user_id: UUID,
        page: int,
        page_size: int,
        search: str = "",
        include_inactive: bool = False,
        only_system_admins: bool = False,
    ) -> PlatformUserPage:
        """Paginated cross-tenant user list with metadata."""
        await self._user_ops.require_system_admin(user_id)
        page = _safe_page(page)
        page_size = _clamp_page_size(page_size)

        conditions = []
        if not include_inactive:
            conditions.append(User.is_active.is_(True))
        if only_system_admins:
            conditions.append(User.is_system_admin.is_(True))

        normalized_search = search.strip().lower() if search else ""
        if normalized_search:
            pattern = f"%{normalized_search}%"
            conditions.append(
                or_(
                    func.lower(User.email).like(pattern),
                    func.lower(User.username).like(pattern),
                    func.lower(User.full_name).like(pattern),
                )
            )

        where_clause = and_(*conditions) if conditions else None

        count_query = select(func.count()).select_from(User)
        if where_clause is not None:
            count_query = count_query.where(where_clause)
        total = (await self._session.execute(count_query)).scalar_one()

        page_query = select(User).order_by(User.email.asc())
        if where_clause is not None:
            page_query = page_query.where(where_clause)
        page_query = page_query.limit(page_size).offset(page * page_size)
        users = (await self._session.execute(page_query)).scalars().all()

        if not users:
            return PlatformUserPage(
                rows=[], total_count=int(total), page=page, page_size=page_size
            )

        user_ids = [u.id for u in users]
        membership_counts = await self._fetch_membership_counts(user_ids)
        last_logins = await self._fetch_user_last_logins(user_ids)

        rows: list[PlatformUserSummary] = []
        for u in users:
            rows.append(
                PlatformUserSummary(
                    id=u.id,
                    email=u.email,
                    username=u.username,
                    full_name=u.full_name,
                    is_active=u.is_active,
                    is_system_admin=u.is_system_admin,
                    email_verified=u.email_verified,
                    mfa_enabled=False,
                    org_memberships_count=membership_counts.get(u.id, 0),
                    last_login_at=last_logins.get(u.id),
                    created_at=u.created_at,
                )
            )
        return PlatformUserPage(
            rows=rows, total_count=int(total), page=page, page_size=page_size
        )

    async def get_user(
        self, *, user_id: UUID, target_user_id: UUID
    ) -> PlatformUserDetail:
        """Full detail for one user. Profile + memberships."""
        await self._user_ops.require_system_admin(user_id)
        target = await self._require_user(target_user_id)
        memberships = await self._fetch_user_memberships(target.id)
        last_logins = await self._fetch_user_last_logins([target.id])
        summary = PlatformUserSummary(
            id=target.id,
            email=target.email,
            username=target.username,
            full_name=target.full_name,
            is_active=target.is_active,
            is_system_admin=target.is_system_admin,
            email_verified=target.email_verified,
            mfa_enabled=False,
            org_memberships_count=len(memberships),
            last_login_at=last_logins.get(target.id),
            created_at=target.created_at,
        )
        return PlatformUserDetail(summary=summary, memberships=memberships)

    async def force_logout_user(
        self, *, user_id: UUID, target_user_id: UUID, reason: str
    ) -> None:
        """Bump ``token_version`` on one user. Kills every existing JWT."""
        await self._user_ops.require_system_admin(user_id)
        await check_rate_limit(
            key=_operator_mutation_key(user_id, "force_logout"),
            limit=_PLATFORM_MUTATION_LIMIT,
            window_seconds=_PLATFORM_MUTATION_WINDOW_SECONDS,
            resource="platform force-logout",
        )
        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")

        target = await self._require_user(target_user_id)
        target.token_version += 1
        new_version = target.token_version
        self._session.add(target)

        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=user_id,
            action=Action.USER_FORCE_LOGOUT,
            resource_type="USER",
            resource_id=target.id,
            details={"reason": reason},
        )
        await self._session.commit()

        await mark_token_version_revoked(target.id, new_version)
        await invalidate_user_profile(target.id)
        await _safe_publish_token_revoke(target.id, new_version)

    async def set_system_admin(
        self,
        *,
        user_id: UUID,
        target_user_id: UUID,
        is_system_admin: bool,
        reason: str,
    ) -> PlatformUserDetail:
        """Toggle ``is_system_admin``.

        Two safety rails:

        * Operators cannot demote themselves (locks them out instantly).
        * The last remaining active sysadmin cannot be demoted - the
          deployment must keep at least one operator who can manage the
          platform surface. Without this guard, two operators racing on
          each other's demotion can leave the platform with zero
          sysadmins and only DB-level recovery to fix.
        """
        await self._user_ops.require_system_admin(user_id)
        await check_rate_limit(
            key=_operator_mutation_key(user_id, "set_system_admin"),
            limit=_PLATFORM_MUTATION_LIMIT,
            window_seconds=_PLATFORM_MUTATION_WINDOW_SECONDS,
            resource="platform sysadmin role changes",
        )
        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")

        if not is_system_admin and target_user_id == user_id:
            raise PermissionDeniedError(
                "Cannot revoke your own system admin role"
            )

        target = await self._require_user(target_user_id)
        if target.is_system_admin == is_system_admin:
            return await self.get_user(
                user_id=user_id, target_user_id=target_user_id
            )

        if not is_system_admin and target.is_system_admin:
            other_admins = (
                await self._session.execute(
                    select(func.count())
                    .select_from(User)
                    .where(User.is_system_admin.is_(True))
                    .where(User.is_active.is_(True))
                    .where(User.id != target.id)
                )
            ).scalar_one()
            if int(other_admins) == 0:
                raise PermissionDeniedError(
                    "Cannot revoke the last remaining system admin"
                )

        target.is_system_admin = is_system_admin
        target.token_version += 1
        new_version = target.token_version
        self._session.add(target)

        action = (
            Action.USER_SYSTEM_ADMIN_GRANTED
            if is_system_admin
            else Action.USER_SYSTEM_ADMIN_REVOKED
        )
        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=user_id,
            action=action,
            resource_type="USER",
            resource_id=target.id,
            details={"reason": reason},
        )
        await self._session.commit()

        await mark_token_version_revoked(target.id, new_version)
        await invalidate_user_profile(target.id)
        await _safe_publish_token_revoke(target.id, new_version)

        return await self.get_user(
            user_id=user_id, target_user_id=target_user_id
        )

    async def _require_org(self, organization_id: UUID) -> Organization:
        org = (
            await self._session.execute(
                select(Organization).where(Organization.id == organization_id)
            )
        ).scalar_one_or_none()
        if org is None:
            raise NotFoundError("Organization", str(organization_id))
        return org

    async def _require_user(self, user_id: UUID) -> User:
        user = (
            await self._session.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if user is None:
            raise NotFoundError("User", str(user_id))
        return user

    async def _fetch_member_counts(self, org_ids: list[UUID]) -> dict[UUID, int]:
        if not org_ids:
            return {}
        rows = (
            await self._session.execute(
                select(
                    OrganizationMember.organization_id,
                    func.count(OrganizationMember.user_id),
                )
                .where(OrganizationMember.organization_id.in_(org_ids))
                .where(OrganizationMember.is_active.is_(True))
                .group_by(OrganizationMember.organization_id)
            )
        ).all()
        return {oid: int(count) for oid, count in rows}

    async def _fetch_membership_counts(self, user_ids: list[UUID]) -> dict[UUID, int]:
        if not user_ids:
            return {}
        rows = (
            await self._session.execute(
                select(
                    OrganizationMember.user_id,
                    func.count(OrganizationMember.organization_id),
                )
                .where(OrganizationMember.user_id.in_(user_ids))
                .where(OrganizationMember.is_active.is_(True))
                .group_by(OrganizationMember.user_id)
            )
        ).all()
        return {uid: int(count) for uid, count in rows}

    async def _fetch_mail_sources(self, org_ids: list[UUID]) -> dict[UUID, str]:
        """Resolve effective mail config source per org.

        Priority: per_org row > deployment row > env > none. Single
        query per tier instead of a per-org probe -- works for any
        org list size up to ``MAX_PAGE_SIZE``.
        """
        if not org_ids:
            return {}
        per_org_rows = (
            await self._session.execute(
                select(OrgSetting.organization_id)
                .where(OrgSetting.organization_id.in_(org_ids))
                .where(OrgSetting.namespace == MAIL_NAMESPACE)
                .where(OrgSetting.key == "from_address")
                .where(OrgSetting.is_secret.is_(False))
                .distinct()
            )
        ).all()
        per_org = {row[0] for row in per_org_rows}

        deployment_present = (
            (
                await self._session.execute(
                    select(func.count())
                    .select_from(DeploymentSetting)
                    .where(DeploymentSetting.namespace == MAIL_NAMESPACE)
                    .where(DeploymentSetting.key == "from_address")
                )
            ).scalar_one()
            > 0
        )
        env_present = MailConfig.from_env() is not None

        fallback = (
            "deployment"
            if deployment_present
            else ("env" if env_present else "none")
        )
        return {oid: ("per_org" if oid in per_org else fallback) for oid in org_ids}

    async def _fetch_encryption_versions(
        self, org_ids: list[UUID]
    ) -> dict[UUID, int]:
        if not org_ids:
            return {}
        rows = (
            await self._session.execute(
                select(OrgEncryptionKey.organization_id, OrgEncryptionKey.version)
                .where(OrgEncryptionKey.organization_id.in_(org_ids))
                .where(OrgEncryptionKey.is_active.is_(True))
            )
        ).all()
        return {oid: int(version) for oid, version in rows}

    async def _fetch_audit_max(
        self, org_ids: list[UUID], *, action: str | None
    ) -> dict[UUID, datetime]:
        if not org_ids:
            return {}
        query = (
            select(
                AuditEvent.organization_id,
                func.max(AuditEvent.created_at),
            )
            .where(AuditEvent.organization_id.in_(org_ids))
            .group_by(AuditEvent.organization_id)
        )
        if action is not None:
            query = query.where(AuditEvent.action == action)
        rows = (await self._session.execute(query)).all()
        return {oid: ts for oid, ts in rows}

    async def _fetch_user_last_logins(
        self, user_ids: list[UUID]
    ) -> dict[UUID, datetime]:
        if not user_ids:
            return {}
        rows = (
            await self._session.execute(
                select(
                    AuditEvent.actor_user_id,
                    func.max(AuditEvent.created_at),
                )
                .where(AuditEvent.actor_user_id.in_(user_ids))
                .where(AuditEvent.action == Action.AUTH_LOGIN_SUCCESS)
                .group_by(AuditEvent.actor_user_id)
            )
        ).all()
        return {uid: ts for uid, ts in rows}

    async def _fetch_owners(self, org_id: UUID) -> list[PlatformOrgOwner]:
        rows = (
            await self._session.execute(
                select(
                    OrganizationMember.user_id,
                    OrganizationMember.joined_at,
                    User.email,
                    User.full_name,
                )
                .join(User, User.id == OrganizationMember.user_id)
                .where(OrganizationMember.organization_id == org_id)
                .where(OrganizationMember.role == OrganizationRole.OWNER)
                .where(OrganizationMember.is_active.is_(True))
                .order_by(OrganizationMember.joined_at.asc())
            )
        ).all()
        return [
            PlatformOrgOwner(
                user_id=uid,
                email=email,
                full_name=full_name,
                joined_at=joined_at,
            )
            for uid, joined_at, email, full_name in rows
        ]

    async def _fetch_user_memberships(
        self, user_id: UUID
    ) -> list[PlatformUserMembership]:
        rows = (
            await self._session.execute(
                select(
                    OrganizationMember.organization_id,
                    OrganizationMember.role,
                    OrganizationMember.joined_at,
                    OrganizationMember.is_active,
                    Organization.name,
                    Organization.slug,
                    Organization.is_suspended,
                    Organization.deleted_at,
                )
                .join(Organization, Organization.id == OrganizationMember.organization_id)
                .where(OrganizationMember.user_id == user_id)
                .order_by(OrganizationMember.joined_at.asc())
            )
        ).all()
        return [
            PlatformUserMembership(
                organization_id=oid,
                organization_name=name,
                organization_slug=slug,
                role=role.value if hasattr(role, "value") else str(role),
                joined_at=joined_at,
                is_active=is_active,
                is_suspended=is_suspended,
                deleted_at=deleted_at,
            )
            for oid, role, joined_at, is_active, name, slug, is_suspended, deleted_at in rows
        ]

    async def _bump_member_token_versions(self, org_id: UUID) -> list[UUID]:
        """Bump ``token_version`` on every active member. Return ids bumped."""
        rows = (
            await self._session.execute(
                select(OrganizationMember.user_id)
                .where(OrganizationMember.organization_id == org_id)
                .where(OrganizationMember.is_active.is_(True))
            )
        ).all()
        user_ids = [row[0] for row in rows]
        if not user_ids:
            return []
        users = (
            await self._session.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        for u in users:
            u.token_version += 1
            self._session.add(u)
        return [u.id for u in users]

    async def _publish_member_token_revokes(self, user_ids: list[UUID]) -> None:
        if not user_ids:
            return
        users = (
            await self._session.execute(
                select(User.id, User.token_version).where(User.id.in_(user_ids))
            )
        ).all()
        for uid, version in users:
            await mark_token_version_revoked(uid, int(version))
            await _safe_publish_token_revoke(uid, int(version))

    async def _enqueue_org_deleted_emails(
        self, org: Organization, reason: str
    ) -> None:
        """Fan-out the ``platform/org_deleted`` email to every org owner."""
        if org.deleted_at is None:
            return
        purge_at = _purge_at_from(org.deleted_at)
        owners = (
            await self._session.execute(
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
        try:
            queue = get_queue("core")
        except RuntimeError:
            logger.warning(
                "platform org_deleted email enqueue skipped: core queue not initialised",
                org_id=str(org.id),
            )
            return
        context: dict[str, Any] = {
            "org_name": org.name,
            "deleted_at": org.deleted_at.strftime("%B %d, %Y at %H:%M UTC"),
            "purge_at": (
                purge_at.strftime("%B %d, %Y at %H:%M UTC") if purge_at else ""
            ),
            "grace_days": PURGE_GRACE_DAYS,
            "reason": reason,
        }
        for owner_id, email in owners:
            idempotency_key = f"platform_org_deleted/{org.id}/{owner_id}"
            await queue.enqueue_job(
                "send_email",
                email,
                "platform/org_deleted",
                json.dumps(context),
                organization_id=str(org.id),
                idempotency_key=idempotency_key,
                user_id=str(owner_id),
            )
