"""Storage quota operations for managing org and user quotas."""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import BigInteger, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.domain_admin import is_domain_admin
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.files.file import File
from uniffy.core.models.files.storage_quota import StorageQuota
from uniffy.core.models.files.storage_usage import StorageUsage
from uniffy.core.models.files.user_storage_quota_override import UserStorageQuotaOverride
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.types import DomainType

logger = logger.bind(component="files.quota_operations")


@dataclass(frozen=True)
class UserUsageRow:
    """Admin storage table row; members without usage get used_bytes=0."""

    user_id: UUID
    organization_id: UUID
    used_bytes: int
    file_count: int
    has_override: bool
    effective_quota_bytes: int | None
    last_recalculated_at: datetime | None


@dataclass(frozen=True)
class QuotaCheckResult:
    """Result of a quota check; quota_bytes=None means unlimited."""

    allowed: bool
    reason: str
    usage_percent: float
    current_used_bytes: int
    quota_bytes: int | None
    remaining_bytes: int | None


class QuotaOperations:
    """Org quota config, per-user overrides, materialized usage tracking, enforcement checks."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.permission_checker = PermissionChecker(session)

    async def _require_admin(self, user_id: UUID, organization_id: UUID) -> None:
        """Org admin, system admin, or files domain admin."""
        is_org_admin = await self.permission_checker.is_org_admin(user_id, organization_id)
        if is_org_admin:
            return

        is_files_admin = await is_domain_admin(
            self.session, user_id, organization_id, DomainType.FILES
        )
        if is_files_admin:
            return

        raise PermissionDeniedError("manage", "storage quotas")

    async def get_org_quota(self, organization_id: UUID) -> StorageQuota:
        """Get-or-create the org quota config; defaults to unlimited."""
        result = await self.session.execute(
            select(StorageQuota).where(StorageQuota.organization_id == organization_id)
        )
        quota = result.scalar_one_or_none()
        if quota is not None:
            return quota

        quota = StorageQuota(
            organization_id=organization_id,
            org_quota_bytes=None,
            default_user_quota_bytes=None,
            warn_at_percent=80,
            enforce=True,
        )
        self.session.add(quota)
        try:
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            result = await self.session.execute(
                select(StorageQuota).where(StorageQuota.organization_id == organization_id)
            )
            existing = result.scalar_one_or_none()
            if existing is None:
                raise
            return existing
        await self.session.refresh(quota)
        return quota

    async def set_org_quota(
        self,
        user_id: UUID,
        organization_id: UUID,
        org_quota_bytes: int | None = None,
        default_user_quota_bytes: int | None = None,
        warn_at_percent: int | None = None,
        enforce: bool | None = None,
    ) -> StorageQuota:
        """Upsert the org quota config; None values keep the existing field."""
        await self._require_admin(user_id, organization_id)

        if warn_at_percent is not None and (warn_at_percent < 1 or warn_at_percent > 100):
            raise ValidationError("warn_at_percent", "Must be between 1 and 100")

        quota = await self.get_org_quota(organization_id)

        if org_quota_bytes is not None:
            quota.org_quota_bytes = org_quota_bytes
        elif org_quota_bytes is None and org_quota_bytes != quota.org_quota_bytes:
            quota.org_quota_bytes = None

        if default_user_quota_bytes is not None:
            quota.default_user_quota_bytes = default_user_quota_bytes

        if warn_at_percent is not None:
            quota.warn_at_percent = warn_at_percent

        if enforce is not None:
            quota.enforce = enforce

        quota.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(quota)
        return quota

    async def get_user_quota_override(
        self,
        organization_id: UUID,
        user_id: UUID,
    ) -> UserStorageQuotaOverride | None:
        result = await self.session.execute(
            select(UserStorageQuotaOverride).where(
                UserStorageQuotaOverride.organization_id == organization_id,
                UserStorageQuotaOverride.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def set_user_quota_override(
        self,
        admin_user_id: UUID,
        organization_id: UUID,
        user_id: UUID,
        quota_bytes: int,
        note: str | None = None,
    ) -> UserStorageQuotaOverride:
        """Upsert a per-user quota override."""
        await self._require_admin(admin_user_id, organization_id)

        if quota_bytes < 0:
            raise ValidationError("quota_bytes", "Quota must be non-negative")

        existing = await self.get_user_quota_override(organization_id, user_id)

        if existing:
            existing.quota_bytes = quota_bytes
            existing.note = note
            existing.created_by = admin_user_id
            existing.updated_at = datetime.now(UTC)
            await self.session.commit()
            await self.session.refresh(existing)
            return existing

        override = UserStorageQuotaOverride(
            organization_id=organization_id,
            user_id=user_id,
            quota_bytes=quota_bytes,
            note=note,
            created_by=admin_user_id,
        )
        self.session.add(override)
        await self.session.commit()
        await self.session.refresh(override)
        return override

    async def remove_user_quota_override(
        self,
        admin_user_id: UUID,
        organization_id: UUID,
        user_id: UUID,
    ) -> bool:
        """Remove a per-user override, reverting to org default."""
        await self._require_admin(admin_user_id, organization_id)

        existing = await self.get_user_quota_override(organization_id, user_id)
        if not existing:
            raise NotFoundError("UserStorageQuotaOverride", user_id)

        await self.session.delete(existing)
        await self.session.commit()
        return True

    async def list_user_quota_overrides(
        self,
        admin_user_id: UUID,
        organization_id: UUID,
    ) -> list[UserStorageQuotaOverride]:
        await self._require_admin(admin_user_id, organization_id)

        result = await self.session.execute(
            select(UserStorageQuotaOverride)
            .where(UserStorageQuotaOverride.organization_id == organization_id)
            .order_by(UserStorageQuotaOverride.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_effective_user_quota(
        self,
        organization_id: UUID,
        user_id: UUID,
    ) -> int | None:
        """Resolution: user override > org default > unlimited (None)."""
        override = await self.get_user_quota_override(organization_id, user_id)
        if override:
            return override.quota_bytes

        org_quota = await self.get_org_quota(organization_id)
        return org_quota.default_user_quota_bytes

    async def get_user_usage(
        self,
        organization_id: UUID,
        user_id: UUID,
    ) -> StorageUsage:
        """Get-or-create a per-user usage row."""
        result = await self.session.execute(
            select(StorageUsage).where(
                StorageUsage.organization_id == organization_id,
                StorageUsage.user_id == user_id,
            )
        )
        usage = result.scalar_one_or_none()

        if usage is None:
            usage = StorageUsage(
                organization_id=organization_id,
                user_id=user_id,
                used_bytes=0,
                file_count=0,
            )
            self.session.add(usage)
            await self.session.commit()
            await self.session.refresh(usage)

        return usage

    async def get_org_usage(self, organization_id: UUID) -> tuple[int, int]:
        """Returns (total_used_bytes, total_file_count) summed across users."""
        result = await self.session.execute(
            select(
                func.coalesce(func.sum(StorageUsage.used_bytes), 0),
                func.coalesce(func.sum(StorageUsage.file_count), 0),
            ).where(StorageUsage.organization_id == organization_id)
        )
        row = result.one()
        return int(row[0]), int(row[1])

    async def list_user_usage(
        self,
        admin_user_id: UUID,
        organization_id: UUID,
    ) -> list[UserUsageRow]:
        """One row per active member; LEFT JOINs surface zero-usage members;
        sort by used_bytes DESC.
        """
        await self._require_admin(admin_user_id, organization_id)

        org_quota = await self.get_org_quota(organization_id)
        org_default = org_quota.default_user_quota_bytes

        used_col = func.coalesce(StorageUsage.used_bytes, 0).label("used_bytes")
        file_col = func.coalesce(StorageUsage.file_count, 0).label("file_count")

        stmt = (
            select(
                OrganizationMember.user_id,
                used_col,
                file_col,
                StorageUsage.last_recalculated_at,
                UserStorageQuotaOverride.quota_bytes.label("override_bytes"),
            )
            .select_from(OrganizationMember)
            .outerjoin(
                StorageUsage,
                (StorageUsage.user_id == OrganizationMember.user_id)
                & (StorageUsage.organization_id == OrganizationMember.organization_id),
            )
            .outerjoin(
                UserStorageQuotaOverride,
                (UserStorageQuotaOverride.user_id == OrganizationMember.user_id)
                & (
                    UserStorageQuotaOverride.organization_id
                    == OrganizationMember.organization_id
                ),
            )
            .where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_active == True,  # noqa: E712
            )
            .order_by(used_col.desc(), OrganizationMember.user_id.asc())
        )

        result = await self.session.execute(stmt)
        rows: list[UserUsageRow] = []
        for row in result.all():
            override_bytes = row.override_bytes
            effective_quota = (
                override_bytes if override_bytes is not None else org_default
            )
            rows.append(
                UserUsageRow(
                    user_id=row.user_id,
                    organization_id=organization_id,
                    used_bytes=int(row.used_bytes),
                    file_count=int(row.file_count),
                    has_override=override_bytes is not None,
                    effective_quota_bytes=effective_quota,
                    last_recalculated_at=row.last_recalculated_at,
                )
            )
        return rows

    async def increment_usage(
        self,
        organization_id: UUID,
        user_id: UUID,
        bytes_delta: int,
        file_count_delta: int = 1,
    ) -> StorageUsage:
        """Atomic increment via SQL arithmetic to survive concurrent uploads."""
        usage = await self.get_user_usage(organization_id, user_id)

        await self.session.execute(
            text(
                "UPDATE files_storage_usage "
                "SET used_bytes = used_bytes + :bytes_delta, "
                "    file_count = file_count + :file_count_delta, "
                "    updated_at = :now "
                "WHERE id = :usage_id"
            ).bindparams(
                bytes_delta=bytes_delta,
                file_count_delta=file_count_delta,
                now=datetime.now(UTC),
                usage_id=usage.id,
            )
        )
        await self.session.commit()

        await self.session.refresh(usage)
        return usage

    async def decrement_usage(
        self,
        organization_id: UUID,
        user_id: UUID,
        bytes_delta: int,
        file_count_delta: int = 1,
    ) -> StorageUsage:
        """Atomic decrement clamped at zero via GREATEST."""
        usage = await self.get_user_usage(organization_id, user_id)

        await self.session.execute(
            text(
                "UPDATE files_storage_usage "
                "SET used_bytes = GREATEST(0, used_bytes - :bytes_delta), "
                "    file_count = GREATEST(0, file_count - :file_count_delta), "
                "    updated_at = :now "
                "WHERE id = :usage_id"
            ).bindparams(
                bytes_delta=bytes_delta,
                file_count_delta=file_count_delta,
                now=datetime.now(UTC),
                usage_id=usage.id,
            )
        )
        await self.session.commit()

        await self.session.refresh(usage)
        return usage

    async def check_quota(
        self,
        organization_id: UUID,
        user_id: UUID,
        additional_bytes: int,
    ) -> QuotaCheckResult:
        """Gate an upload against user-level and org-level quotas."""
        org_quota = await self.get_org_quota(organization_id)
        user_usage = await self.get_user_usage(organization_id, user_id)
        effective_user_quota = await self.get_effective_user_quota(organization_id, user_id)

        projected_user_bytes = user_usage.used_bytes + additional_bytes

        if effective_user_quota is not None:
            if projected_user_bytes > effective_user_quota:
                usage_percent = (
                    (user_usage.used_bytes / effective_user_quota * 100)
                    if effective_user_quota > 0
                    else 100.0
                )
                remaining = max(0, effective_user_quota - user_usage.used_bytes)
                if org_quota.enforce:
                    return QuotaCheckResult(
                        allowed=False,
                        reason="User storage quota exceeded",
                        usage_percent=usage_percent,
                        current_used_bytes=user_usage.used_bytes,
                        quota_bytes=effective_user_quota,
                        remaining_bytes=remaining,
                    )
                logger.warning(
                    "User quota exceeded but enforcement disabled",
                    user_id=str(user_id),
                    used=user_usage.used_bytes,
                    quota=effective_user_quota,
                )

        if org_quota.org_quota_bytes is not None:
            org_used, _ = await self.get_org_usage(organization_id)
            projected_org_bytes = org_used + additional_bytes
            if projected_org_bytes > org_quota.org_quota_bytes:
                org_usage_percent = (
                    (org_used / org_quota.org_quota_bytes * 100)
                    if org_quota.org_quota_bytes > 0
                    else 100.0
                )
                org_remaining = max(0, org_quota.org_quota_bytes - org_used)
                if org_quota.enforce:
                    return QuotaCheckResult(
                        allowed=False,
                        reason="Organization storage quota exceeded",
                        usage_percent=org_usage_percent,
                        current_used_bytes=org_used,
                        quota_bytes=org_quota.org_quota_bytes,
                        remaining_bytes=org_remaining,
                    )
                logger.warning(
                    "Org quota exceeded but enforcement disabled",
                    organization_id=str(organization_id),
                    used=org_used,
                    quota=org_quota.org_quota_bytes,
                )

        usage_percent = 0.0
        remaining = None
        quota_bytes = effective_user_quota
        if effective_user_quota is not None and effective_user_quota > 0:
            usage_percent = user_usage.used_bytes / effective_user_quota * 100
            remaining = max(0, effective_user_quota - user_usage.used_bytes)

        return QuotaCheckResult(
            allowed=True,
            reason="Within quota",
            usage_percent=usage_percent,
            current_used_bytes=user_usage.used_bytes,
            quota_bytes=quota_bytes,
            remaining_bytes=remaining,
        )

    async def recalculate_usage(
        self,
        organization_id: UUID,
        user_id: UUID,
    ) -> StorageUsage:
        """Recalculate usage from the files table; corrects drift from the materialized counter."""
        result = await self.session.execute(
            select(
                func.coalesce(func.sum(File.size_bytes.cast(BigInteger)), 0),
                func.count(File.id),
            ).where(
                File.organization_id == organization_id,
                File.owner_id == user_id,
                File.is_deleted == False,  # noqa: E712
            )
        )
        row = result.one()
        actual_bytes = int(row[0])
        actual_count = int(row[1])

        usage = await self.get_user_usage(organization_id, user_id)
        now = datetime.now(UTC)

        if usage.used_bytes != actual_bytes or usage.file_count != actual_count:
            logger.info(
                "Usage drift corrected",
                user_id=str(user_id),
                old_bytes=usage.used_bytes,
                new_bytes=actual_bytes,
                old_count=usage.file_count,
                new_count=actual_count,
            )

        usage.used_bytes = actual_bytes
        usage.file_count = actual_count
        usage.last_recalculated_at = now
        usage.updated_at = now

        await self.session.commit()
        await self.session.refresh(usage)
        return usage

    async def recalculate_org_usage(
        self,
        organization_id: UUID,
    ) -> list[StorageUsage]:
        """Recalculate usage for every owner in the org."""
        result = await self.session.execute(
            select(File.owner_id).where(File.organization_id == organization_id).distinct()
        )
        owner_ids = [row[0] for row in result.all()]

        usage_records = []
        for owner_id in owner_ids:
            usage = await self.recalculate_usage(organization_id, owner_id)
            usage_records.append(usage)

        return usage_records
