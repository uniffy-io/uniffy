"""Cross-tenant org + user operations for platform operators; tenant
content stays unreachable here (no PermissionChecker bypass).
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any, NamedTuple
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import email_hash, write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.emails import normalize_email
from uniffy.core.auth.passwords.crypto import hash_password
from uniffy.core.auth.passwords.policy import validate_password
from uniffy.core.auth.revocation import mark_sessions_revoked, mark_token_version_revoked
from uniffy.core.auth.sessions import stage_revoke_user_sessions
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.jobs import enqueue_job
from uniffy.core.json_codec import dumps_str
from uniffy.core.mail.config import MAIL_FROM_ADDRESS_KEY, MAIL_NAMESPACE, MailConfig
from uniffy.core.models.audit.event import AuditEvent, AuditResourceType
from uniffy.core.models.calls import CallEndReason
from uniffy.core.models.crypto.org_encryption_key import OrgEncryptionKey
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.models.settings.deployment_setting import DeploymentSetting
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.core.rate_limit import check_rate_limit
from uniffy.core.realtime.publisher import publish_token_revoke
from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import slugify
from uniffy.core.users.cache import invalidate_user_profile
from uniffy.domains.calls.lifecycle import CallEvictionReason, CallRevocationLifecycle
from uniffy.domains.mail.jobs.contracts import SEND_EMAIL
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.users.operations import UserOperations

logger = logger.bind(component="platform.directory.operations")


async def _safe_publish_token_revoke(user_id: UUID, version: int) -> None:
    """The Valkey ``min_tkv`` watermark is authoritative; the realtime
    publish is a UX nudge for live WebSockets.
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

# Per-operator throughput caps; well above legitimate hand-driven use.
_PLATFORM_MUTATION_LIMIT = 20
_PLATFORM_MUTATION_WINDOW_SECONDS = 60
_PLATFORM_SUSPEND_LIMIT = 10
_PLATFORM_SUSPEND_WINDOW_SECONDS = 60


def _operator_mutation_key(user_id: UUID, scope: str) -> str:
    return f"rl:platform:{scope}:{user_id}"


class PlatformOrgSummary(NamedTuple):
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
    max_members: int | None


class PlatformOrgPage(NamedTuple):
    rows: list[PlatformOrgSummary]
    total_count: int
    page: int
    page_size: int


class PlatformUserSummary(NamedTuple):
    id: UUID
    email: str
    username: str
    full_name: str | None
    is_active: bool
    is_system_admin: bool
    email_verified: bool
    mfa_enabled: bool
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


_PLAN_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,49}$")
_DOMAIN_RE = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$")


def normalize_org_name(name: str) -> str:
    name = name.strip()
    if not name:
        raise ValidationError("name", "name is required")
    if len(name) > 255:
        raise ValidationError("name", "name must be 255 characters or fewer")
    return name


def normalize_slug(slug: str, *, fallback_name: str = "") -> str:
    slug = slug.strip().lower()
    if not slug and fallback_name:
        slug = slugify(fallback_name, max_length=255)
    if not slug or len(slug) < 2 or len(slug) > 255 or slug != slugify(slug):
        raise ValidationError(
            "slug",
            "slug must be 2-255 characters of lowercase letters, digits and hyphens",
        )
    return slug


def normalize_plan(plan: str) -> str:
    plan = plan.strip().lower()
    if not plan:
        return "free"
    if not _PLAN_RE.match(plan):
        raise ValidationError(
            "plan",
            "plan must be 1-50 characters of lowercase letters, digits, hyphens and underscores",
        )
    return plan


_USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,63}$")


def normalize_username(username: str) -> str:
    username = username.strip().lower()
    if not _USERNAME_RE.match(username):
        raise ValidationError(
            "username",
            "username must be 2-64 characters of lowercase letters, digits, dots, "
            "hyphens and underscores, starting with a letter or digit",
        )
    return username


def derive_username(email: str) -> str:
    """Best-effort username from the email local part; caller resolves collisions."""
    local = email.split("@", 1)[0].lower()
    cleaned = re.sub(r"[^a-z0-9._-]", "", local).lstrip("._-")
    if len(cleaned) < 2:
        cleaned = f"user-{cleaned}" if cleaned else "user"
    return cleaned[:64]


def normalize_domain(domain: str) -> str | None:
    """Empty input means no domain; the return value is storable as-is."""
    domain = domain.strip().lower()
    if not domain:
        return None
    if len(domain) > 255 or not _DOMAIN_RE.match(domain):
        raise ValidationError("domain", "domain is not a valid hostname")
    return domain


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


def _audit_user_ids(user_ids: list[UUID]) -> list[str]:
    return [str(user_id) for user_id in user_ids]


class PlatformDirectoryOperations:
    """Platform-operator org + user directory; gated on ``is_system_admin``."""

    def __init__(
        self,
        session: AsyncSession,
        call_lifecycle: CallRevocationLifecycle,
    ) -> None:
        self._session = session
        self._user_ops = UserOperations(session)
        self._call_lifecycle = call_lifecycle

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
            return PlatformOrgPage(rows=[], total_count=int(total), page=page, page_size=page_size)

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

    async def get_organization(self, *, user_id: UUID, organization_id: UUID) -> PlatformOrgDetail:
        await self._user_ops.require_system_admin(user_id)
        org = await self._require_org(organization_id)

        member_count = (await self._fetch_member_counts([org.id])).get(org.id, 0)
        mail_source = (await self._fetch_mail_sources([org.id])).get(org.id, "none")
        encryption_version = (await self._fetch_encryption_versions([org.id])).get(org.id, 0)
        last_activity = (await self._fetch_audit_max([org.id], action=None)).get(org.id)
        last_login = (await self._fetch_audit_max([org.id], action=Action.AUTH_LOGIN_SUCCESS)).get(
            org.id
        )

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
            max_members=org.max_members,
        )

    async def create_organization(
        self,
        *,
        user_id: UUID,
        name: str,
        slug: str,
        owner_email: str,
        domain: str = "",
        plan: str = "",
        storage: ObjectStorage,
        search_indexer: SearchIndexer,
    ) -> PlatformOrgDetail:
        """Full tenant bootstrap via ``OrganizationOperations.create``:
        owner membership, org cipher, default channel/agent/presets.
        """
        await self._user_ops.require_system_admin(user_id)
        await check_rate_limit(
            key=_operator_mutation_key(user_id, "create_org"),
            limit=_PLATFORM_SUSPEND_LIMIT,
            window_seconds=_PLATFORM_SUSPEND_WINDOW_SECONDS,
            resource="platform organization creations",
        )
        name = normalize_org_name(name)
        slug = normalize_slug(slug, fallback_name=name)
        plan = normalize_plan(plan)
        domain_value = normalize_domain(domain)

        email = normalize_email(owner_email)
        if not email:
            raise ValidationError("owner_email", "owner_email is required")
        owner = (
            await self._session.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
        if owner is None or not owner.is_active:
            raise ValidationError("owner_email", "No active user account matches this email")

        existing = (
            await self._session.execute(select(Organization.id).where(Organization.slug == slug))
        ).scalar_one_or_none()
        if existing is not None:
            raise ValidationError("slug", "Slug is already in use")

        org = await OrganizationOperations(self._session).create(
            name=name,
            slug=slug,
            owner_user_id=owner.id,
            domain=domain_value,
            plan=plan,
            actor_user_id=user_id,
            storage=storage,
            search_indexer=search_indexer,
        )
        return await self.get_organization(user_id=user_id, organization_id=org.id)

    async def update_organization(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        reason: str,
        name: str | None = None,
        slug: str | None = None,
        domain: str | None = None,
        plan: str | None = None,
        max_members: int | None = None,
    ) -> PlatformOrgDetail:
        """``None`` leaves a field unchanged; ``domain=""`` clears the
        domain and ``max_members=0`` removes the cap.
        """
        await self._user_ops.require_system_admin(user_id)
        await check_rate_limit(
            key=_operator_mutation_key(user_id, "update_org"),
            limit=_PLATFORM_MUTATION_LIMIT,
            window_seconds=_PLATFORM_MUTATION_WINDOW_SECONDS,
            resource="platform organization updates",
        )
        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")

        org = await self._require_org(organization_id)
        if org.deleted_at is not None:
            raise ValidationError("organization", "Cannot edit a deleted organization")

        changed_keys: list[str] = []
        if name is not None:
            value = normalize_org_name(name)
            if value != org.name:
                org.name = value
                changed_keys.append("name")
        if slug is not None:
            value = normalize_slug(slug)
            if value != org.slug:
                taken = (
                    await self._session.execute(
                        select(Organization.id)
                        .where(Organization.slug == value)
                        .where(Organization.id != org.id)
                    )
                ).scalar_one_or_none()
                if taken is not None:
                    raise ValidationError("slug", "Slug is already in use")
                org.slug = value
                changed_keys.append("slug")
        if domain is not None:
            value = normalize_domain(domain)
            if value != org.domain:
                org.domain = value
                changed_keys.append("domain")
        if plan is not None:
            value = normalize_plan(plan)
            if value != org.plan:
                org.plan = value
                changed_keys.append("plan")
        if max_members is not None:
            if max_members < 0:
                raise ValidationError("max_members", "max_members cannot be negative")
            cap = max_members if max_members > 0 else None
            if cap != org.max_members:
                org.max_members = cap
                changed_keys.append("max_members")

        if changed_keys:
            self._session.add(org)
            await write_audit_event(
                self._session,
                organization_id=org.id,
                actor_user_id=user_id,
                action=Action.ORGANIZATION_SETTINGS_CHANGED,
                resource_type=AuditResourceType.ORGANIZATION,
                resource_id=org.id,
                details={"reason": reason, "changed_keys": changed_keys},
            )
            await self._session.commit()

        return await self.get_organization(user_id=user_id, organization_id=organization_id)

    async def suspend_organization(
        self, *, user_id: UUID, organization_id: UUID, reason: str
    ) -> PlatformOrgDetail:
        """Block sign-in and revoke every member's existing JWTs."""
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
            raise ValidationError("organization", "Cannot suspend a deleted organization")
        if org.is_suspended:
            return await self.get_organization(user_id=user_id, organization_id=organization_id)

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
            resource_type=AuditResourceType.ORGANIZATION,
            resource_id=org.id,
            details={
                "reason": reason,
                "member_token_versions_bumped": _audit_user_ids(bumped_user_ids),
            },
        )
        await self._session.commit()

        for member_id in bumped_user_ids:
            await invalidate_user_profile(member_id)

        await self._call_lifecycle.end_for_organization(
            self._session, org.id, CallEndReason.ORG_SUSPENDED
        )
        await self._publish_member_token_revokes(bumped_user_ids)

        return await self.get_organization(user_id=user_id, organization_id=organization_id)

    async def unsuspend_organization(
        self, *, user_id: UUID, organization_id: UUID, reason: str
    ) -> PlatformOrgDetail:
        """Clear the suspension flag; existing JWTs stay revoked."""
        await self._user_ops.require_system_admin(user_id)
        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")

        org = await self._require_org(organization_id)
        if not org.is_suspended:
            return await self.get_organization(user_id=user_id, organization_id=organization_id)

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
            resource_type=AuditResourceType.ORGANIZATION,
            resource_id=org.id,
            details={"reason": reason},
        )
        await self._session.commit()

        return await self.get_organization(user_id=user_id, organization_id=organization_id)

    async def delete_organization(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        confirm_slug: str,
        reason: str,
    ) -> PlatformOrgDetail:
        """Soft-delete; ARQ purges rows after the grace window."""
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
            return await self.get_organization(user_id=user_id, organization_id=organization_id)

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
            resource_type=AuditResourceType.ORGANIZATION,
            resource_id=org.id,
            details={
                "reason": reason,
                "purge_at": _purge_at_from(org.deleted_at).isoformat() if org.deleted_at else None,
                "member_token_versions_bumped": _audit_user_ids(bumped_user_ids),
            },
        )
        await self._session.commit()

        for member_id in bumped_user_ids:
            await invalidate_user_profile(member_id)
        await self._call_lifecycle.end_for_organization(
            self._session, org.id, CallEndReason.ORG_DELETED
        )
        await self._publish_member_token_revokes(bumped_user_ids)

        await self._enqueue_org_deleted_emails(org, reason)

        return await self.get_organization(user_id=user_id, organization_id=organization_id)

    async def restore_organization(
        self, *, user_id: UUID, organization_id: UUID, reason: str
    ) -> PlatformOrgDetail:
        """Only effective before purge."""
        await self._user_ops.require_system_admin(user_id)
        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")

        org = await self._require_org(organization_id)
        if org.deleted_at is None:
            return await self.get_organization(user_id=user_id, organization_id=organization_id)

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
            resource_type=AuditResourceType.ORGANIZATION,
            resource_id=org.id,
            details={"reason": reason},
        )
        await self._session.commit()

        return await self.get_organization(user_id=user_id, organization_id=organization_id)

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
            return PlatformUserPage(rows=[], total_count=int(total), page=page, page_size=page_size)

        user_ids = [u.id for u in users]
        membership_counts = await self._fetch_membership_counts(user_ids)
        last_logins = await self._fetch_user_last_logins(user_ids)
        mfa_enabled_ids = await self._fetch_mfa_enabled(user_ids)

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
                    mfa_enabled=u.id in mfa_enabled_ids,
                    org_memberships_count=membership_counts.get(u.id, 0),
                    last_login_at=last_logins.get(u.id),
                    created_at=u.created_at,
                )
            )
        return PlatformUserPage(rows=rows, total_count=int(total), page=page, page_size=page_size)

    async def create_user(
        self,
        *,
        user_id: UUID,
        email: str,
        username: str,
        full_name: str,
        password: str,
        email_verified: bool,
        is_system_admin: bool,
        organization_id: UUID | None = None,
        organization_role: str = "",
        reason: str = "",
        search_indexer: SearchIndexer,
    ) -> PlatformUserDetail:
        """Direct provisioning path for operators; no invitation email,
        the password is handed over out of band.
        """
        await self._user_ops.require_system_admin(user_id)
        await check_rate_limit(
            key=_operator_mutation_key(user_id, "create_user"),
            limit=_PLATFORM_MUTATION_LIMIT,
            window_seconds=_PLATFORM_MUTATION_WINDOW_SECONDS,
            resource="platform user creations",
        )
        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")

        email = normalize_email(email)
        if not email or "@" not in email:  # noqa: PLR2004
            raise ValidationError("email", "A valid email address is required")

        username = username.strip().lower()
        username_explicit = bool(username)
        username = normalize_username(username) if username_explicit else derive_username(email)

        full_name_value = full_name.strip() or None

        validate_password(password)

        org: Organization | None = None
        role = OrganizationRole.MEMBER
        if organization_id is not None:
            org = await self._require_org(organization_id)
            if org.deleted_at is not None:
                raise ValidationError(
                    "organization_id", "Cannot add a user to a deleted organization"
                )
            role_value = organization_role.strip().upper()
            if role_value:
                try:
                    role = OrganizationRole(role_value)
                except ValueError as exc:
                    raise ValidationError(
                        "organization_role",
                        "organization_role must be MEMBER, ADMIN or OWNER",
                    ) from exc

        email_taken = (
            await self._session.execute(select(User.id).where(User.email == email))
        ).scalar_one_or_none()
        if email_taken is not None:
            raise ValidationError("email", "A user with this email already exists")

        base_username = username
        for suffix in range(0, 50):
            candidate = base_username if suffix == 0 else f"{base_username}{suffix + 1}"
            taken = (
                await self._session.execute(select(User.id).where(User.username == candidate))
            ).scalar_one_or_none()
            if taken is None:
                username = candidate
                break
            if username_explicit:
                raise ValidationError("username", "Username is already taken")
        else:
            raise ValidationError("username", "Username is already taken")

        target = User(
            email=email,
            username=username,
            full_name=full_name_value,
            hashed_password=hash_password(password),
            email_verified=email_verified,
            is_system_admin=is_system_admin,
        )
        self._session.add(target)
        staged_membership = None
        try:
            await self._session.flush()
            target_id = target.id

            if org is not None:
                staged_membership = await OrganizationOperations(self._session).stage_member(
                    user_id=target_id,
                    org_id=org.id,
                    role=role,
                    actor_user_id=user_id,
                )
            await write_audit_event(
                self._session,
                organization_id=org.id if org else None,
                actor_user_id=user_id,
                action=Action.USER_CREATED,
                resource_type=AuditResourceType.USER,
                resource_id=target_id,
                details={
                    "reason": reason,
                    "email_hash": email_hash(email),
                    "username": username,
                    "email_verified": email_verified,
                    "is_system_admin": is_system_admin,
                    "organization_id": str(org.id) if org else None,
                    "organization_role": role.value if org else None,
                },
            )
            if is_system_admin:
                await write_audit_event(
                    self._session,
                    organization_id=None,
                    actor_user_id=user_id,
                    action=Action.USER_SYSTEM_ADMIN_GRANTED,
                    resource_type=AuditResourceType.USER,
                    resource_id=target_id,
                    details={"reason": reason, "granted_at": "account_creation"},
                )
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            raise

        if staged_membership is not None:
            await OrganizationOperations(self._session).finish_member_add_after_commit(
                staged_membership,
                search_indexer=search_indexer,
            )

        return await self.get_user(user_id=user_id, target_user_id=target_id)

    async def get_user(self, *, user_id: UUID, target_user_id: UUID) -> PlatformUserDetail:
        await self._user_ops.require_system_admin(user_id)
        target = await self._require_user(target_user_id)
        memberships = await self._fetch_user_memberships(target.id)
        last_logins = await self._fetch_user_last_logins([target.id])
        mfa_enabled_ids = await self._fetch_mfa_enabled([target.id])
        summary = PlatformUserSummary(
            id=target.id,
            email=target.email,
            username=target.username,
            full_name=target.full_name,
            is_active=target.is_active,
            is_system_admin=target.is_system_admin,
            email_verified=target.email_verified,
            mfa_enabled=target.id in mfa_enabled_ids,
            org_memberships_count=len(memberships),
            last_login_at=last_logins.get(target.id),
            created_at=target.created_at,
        )
        return PlatformUserDetail(summary=summary, memberships=memberships)

    async def update_user(
        self,
        *,
        user_id: UUID,
        target_user_id: UUID,
        reason: str,
        email: str | None = None,
        username: str | None = None,
        full_name: str | None = None,
        is_active: bool | None = None,
        email_verified: bool | None = None,
        password: str | None = None,
    ) -> PlatformUserDetail:
        """``None`` leaves a field unchanged. Deactivation, an email change and
        a password reset each revoke the target's existing tokens.
        """
        await self._user_ops.require_system_admin(user_id)
        await check_rate_limit(
            key=_operator_mutation_key(user_id, "update_user"),
            limit=_PLATFORM_MUTATION_LIMIT,
            window_seconds=_PLATFORM_MUTATION_WINDOW_SECONDS,
            resource="platform user updates",
        )
        reason = reason.strip()
        if not reason:
            raise ValidationError("reason", "reason is required")

        target = await self._require_user(target_user_id)

        # An operator who locks themselves out cannot unlock themselves, and
        # the last active operator locking out is an unrecoverable deployment.
        if is_active is False:
            if target_user_id == user_id:
                raise PermissionDeniedError("Cannot deactivate your own account")
            if target.is_system_admin:
                await self._require_another_active_sysadmin(target.id)

        changed_keys: list[str] = []
        revoke_tokens = False
        previous_email = target.email

        if email is not None:
            value = normalize_email(email)
            if not value or "@" not in value:  # noqa: PLR2004
                raise ValidationError("email", "A valid email address is required")
            if value != target.email:
                taken = (
                    await self._session.execute(
                        select(User.id).where(User.email == value).where(User.id != target.id)
                    )
                ).scalar_one_or_none()
                if taken is not None:
                    raise ValidationError("email", "A user with this email already exists")
                target.email = value
                # A new address has not been proven to belong to the user.
                target.email_verified = False
                changed_keys.append("email")
                revoke_tokens = True

        if username is not None:
            value = normalize_username(username)
            if value != target.username:
                taken = (
                    await self._session.execute(
                        select(User.id).where(User.username == value).where(User.id != target.id)
                    )
                ).scalar_one_or_none()
                if taken is not None:
                    raise ValidationError("username", "Username is already taken")
                target.username = value
                changed_keys.append("username")

        if full_name is not None:
            value = full_name.strip() or None
            if value != target.full_name:
                target.full_name = value
                changed_keys.append("full_name")

        if email_verified is not None and email_verified != target.email_verified:
            target.email_verified = email_verified
            changed_keys.append("email_verified")

        if password is not None and password:
            validate_password(password)
            target.hashed_password = hash_password(password)
            changed_keys.append("password")
            revoke_tokens = True

        activation_action: str | None = None
        if is_active is not None and is_active != target.is_active:
            target.is_active = is_active
            changed_keys.append("is_active")
            activation_action = Action.USER_ACTIVATED if is_active else Action.USER_DEACTIVATED
            if not is_active:
                revoke_tokens = True

        if not changed_keys:
            return await self.get_user(user_id=user_id, target_user_id=target_user_id)

        new_version: int | None = None
        revoked_session_ids: list[UUID] = []
        if revoke_tokens:
            target.token_version += 1
            new_version = target.token_version
            revoked_session_ids = await stage_revoke_user_sessions(self._session, target.id)
        self._session.add(target)

        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=user_id,
            action=Action.USER_UPDATED,
            resource_type=AuditResourceType.USER,
            resource_id=target.id,
            details={"reason": reason, "changed_keys": changed_keys},
        )
        if "email" in changed_keys:  # noqa: PLR2004
            await write_audit_event(
                self._session,
                organization_id=None,
                actor_user_id=user_id,
                action=Action.USER_EMAIL_CHANGED,
                resource_type=AuditResourceType.USER,
                resource_id=target.id,
                details={
                    "reason": reason,
                    "previous_email_hash": email_hash(previous_email),
                    "new_email_hash": email_hash(target.email),
                },
            )
        if "password" in changed_keys:  # noqa: PLR2004
            await write_audit_event(
                self._session,
                organization_id=None,
                actor_user_id=user_id,
                action=Action.AUTH_PASSWORD_CHANGED,
                resource_type=AuditResourceType.USER,
                resource_id=target.id,
                details={"reason": reason, "initiator": "platform_admin"},
            )
        if activation_action is not None:
            await write_audit_event(
                self._session,
                organization_id=None,
                actor_user_id=user_id,
                action=activation_action,
                resource_type=AuditResourceType.USER,
                resource_id=target.id,
                details={"reason": reason},
            )
        await self._session.commit()

        if new_version is not None:
            await mark_token_version_revoked(target.id, new_version)
            await mark_sessions_revoked(revoked_session_ids)
            await _safe_publish_token_revoke(target.id, new_version)
            await self._call_lifecycle.evict_user(
                self._session,
                target.id,
                reason=(
                    CallEvictionReason.USER_DEACTIVATED
                    if is_active is False
                    else CallEvictionReason.SESSION_REVOKED
                ),
            )
        await invalidate_user_profile(target.id)

        return await self.get_user(user_id=user_id, target_user_id=target_user_id)

    async def _require_another_active_sysadmin(self, excluding_id: UUID) -> None:
        remaining = (
            await self._session.execute(
                select(func.count())
                .select_from(User)
                .where(User.is_system_admin.is_(True))
                .where(User.is_active.is_(True))
                .where(User.id != excluding_id)
            )
        ).scalar_one()
        if int(remaining) == 0:
            raise PermissionDeniedError("Cannot deactivate the last remaining system admin")

    async def force_logout_user(self, *, user_id: UUID, target_user_id: UUID, reason: str) -> None:
        """Bumping ``token_version`` kills every existing JWT."""
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
        revoked_session_ids = await stage_revoke_user_sessions(self._session, target.id)

        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=user_id,
            action=Action.USER_FORCE_LOGOUT,
            resource_type=AuditResourceType.USER,
            resource_id=target.id,
            details={"reason": reason},
        )
        await self._session.commit()

        await mark_token_version_revoked(target.id, new_version)
        await mark_sessions_revoked(revoked_session_ids)
        await invalidate_user_profile(target.id)
        await _safe_publish_token_revoke(target.id, new_version)
        await self._call_lifecycle.evict_user(
            self._session,
            target.id,
            reason=CallEvictionReason.SESSION_REVOKED,
        )

    async def set_system_admin(
        self,
        *,
        user_id: UUID,
        target_user_id: UUID,
        is_system_admin: bool,
        reason: str,
    ) -> PlatformUserDetail:
        """Operators cannot demote themselves; the last active sysadmin cannot be demoted."""
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
            raise PermissionDeniedError("Cannot revoke your own system admin role")

        target = await self._require_user(target_user_id)
        if target.is_system_admin == is_system_admin:
            return await self.get_user(user_id=user_id, target_user_id=target_user_id)

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
                raise PermissionDeniedError("Cannot revoke the last remaining system admin")

        target.is_system_admin = is_system_admin
        target.token_version += 1
        new_version = target.token_version
        self._session.add(target)

        action = (
            Action.USER_SYSTEM_ADMIN_GRANTED if is_system_admin else Action.USER_SYSTEM_ADMIN_REVOKED
        )
        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=user_id,
            action=action,
            resource_type=AuditResourceType.USER,
            resource_id=target.id,
            details={"reason": reason},
        )
        await self._session.commit()

        await mark_token_version_revoked(target.id, new_version)
        await invalidate_user_profile(target.id)
        await _safe_publish_token_revoke(target.id, new_version)

        return await self.get_user(user_id=user_id, target_user_id=target_user_id)

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

    async def _fetch_mfa_enabled(self, user_ids: list[UUID]) -> set[UUID]:
        if not user_ids:
            return set()
        from uniffy.core.models.login.user_mfa import UserMfa

        rows = (
            await self._session.execute(
                select(UserMfa.user_id)
                .where(UserMfa.user_id.in_(user_ids))
                .where(UserMfa.enabled.is_(True))
            )
        ).all()
        return {uid for (uid,) in rows}

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
        """Priority: per_org > deployment > env > none."""
        if not org_ids:
            return {}
        per_org_rows = (
            await self._session.execute(
                select(OrgSetting.organization_id)
                .where(OrgSetting.organization_id.in_(org_ids))
                .where(OrgSetting.namespace == MAIL_NAMESPACE)
                .where(OrgSetting.key == MAIL_FROM_ADDRESS_KEY)
                .where(OrgSetting.is_secret.is_(False))
                .distinct()
            )
        ).all()
        per_org = {row[0] for row in per_org_rows}

        deployment_present = (
            await self._session.execute(
                select(func.count())
                .select_from(DeploymentSetting)
                .where(DeploymentSetting.namespace == MAIL_NAMESPACE)
                .where(DeploymentSetting.key == MAIL_FROM_ADDRESS_KEY)
            )
        ).scalar_one() > 0
        env_present = MailConfig.from_env() is not None

        fallback = "deployment" if deployment_present else ("env" if env_present else "none")
        return {oid: ("per_org" if oid in per_org else fallback) for oid in org_ids}

    async def _fetch_encryption_versions(self, org_ids: list[UUID]) -> dict[UUID, int]:
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

    async def _fetch_user_last_logins(self, user_ids: list[UUID]) -> dict[UUID, datetime]:
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

    async def _fetch_user_memberships(self, user_id: UUID) -> list[PlatformUserMembership]:
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
        """Bump ``token_version`` on every active member; return ids bumped."""
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
            (await self._session.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        )
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

    async def _enqueue_org_deleted_emails(self, org: Organization, reason: str) -> None:
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
        context: dict[str, Any] = {
            "org_name": org.name,
            "deleted_at": org.deleted_at.strftime("%B %d, %Y at %H:%M UTC"),
            "purge_at": (purge_at.strftime("%B %d, %Y at %H:%M UTC") if purge_at else ""),
            "grace_days": PURGE_GRACE_DAYS,
            "reason": reason,
        }
        for owner_id, email in owners:
            idempotency_key = f"platform_org_deleted/{org.id}/{owner_id}"
            try:
                await enqueue_job(
                    SEND_EMAIL,
                    email,
                    "platform/org_deleted",
                    dumps_str(context),
                    organization_id=str(org.id),
                    idempotency_key=idempotency_key,
                    user_id=str(owner_id),
                )
            except RuntimeError:
                logger.warning(
                    "platform org_deleted email enqueue skipped: core queue not initialised",
                    org_id=str(org.id),
                )
                return
