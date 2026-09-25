"""Proto <-> domain converters for storage quota types."""

from uniffy_proto.files.v1.files_pb import (
    OrgStorageQuota as ProtoOrgStorageQuota,
)
from uniffy_proto.files.v1.files_pb import (
    StorageUsageInfo as ProtoStorageUsageInfo,
)
from uniffy_proto.files.v1.files_pb import (
    UserStorageQuotaOverrideInfo as ProtoUserStorageQuotaOverrideInfo,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.files.storage_quota import StorageQuota
from uniffy.core.models.files.storage_usage import StorageUsage
from uniffy.core.models.files.user_storage_quota_override import UserStorageQuotaOverride
from uniffy.domains.files.quota.operations import UserUsageRow


def storage_quota_to_proto(quota: StorageQuota) -> ProtoOrgStorageQuota:
    proto = ProtoOrgStorageQuota(
        id=str(quota.id),
        organization_id=str(quota.organization_id),
        warn_at_percent=quota.warn_at_percent,
        enforce=quota.enforce,
        created_at=datetime_to_timestamp(quota.created_at),
    )

    if quota.org_quota_bytes is not None:
        proto.org_quota_bytes = quota.org_quota_bytes

    if quota.default_user_quota_bytes is not None:
        proto.default_user_quota_bytes = quota.default_user_quota_bytes

    if quota.updated_at:
        proto.updated_at = datetime_to_timestamp(quota.updated_at)

    return proto


def user_quota_override_to_proto(
    override: UserStorageQuotaOverride,
) -> ProtoUserStorageQuotaOverrideInfo:
    proto = ProtoUserStorageQuotaOverrideInfo(
        id=str(override.id),
        organization_id=str(override.organization_id),
        user_id=str(override.user_id),
        quota_bytes=override.quota_bytes,
        created_by=str(override.created_by),
        created_at=datetime_to_timestamp(override.created_at),
    )

    if override.note:
        proto.note = override.note

    if override.updated_at:
        proto.updated_at = datetime_to_timestamp(override.updated_at)

    return proto


def storage_usage_to_proto(
    usage: StorageUsage,
    effective_quota_bytes: int | None = None,
    has_override: bool = False,
) -> ProtoStorageUsageInfo:
    usage_percent = 0.0
    if effective_quota_bytes is not None and effective_quota_bytes > 0:
        usage_percent = usage.used_bytes / effective_quota_bytes * 100

    proto = ProtoStorageUsageInfo(
        user_id=str(usage.user_id),
        organization_id=str(usage.organization_id),
        used_bytes=usage.used_bytes,
        file_count=usage.file_count,
        usage_percent=usage_percent,
        has_override=has_override,
    )

    if effective_quota_bytes is not None:
        proto.effective_quota_bytes = effective_quota_bytes

    if usage.last_recalculated_at:
        proto.last_recalculated_at = datetime_to_timestamp(usage.last_recalculated_at)

    return proto


def user_usage_row_to_proto(row: UserUsageRow) -> ProtoStorageUsageInfo:
    """Admin row to proto; row already has effective_quota_bytes and has_override resolved."""
    usage_percent = 0.0
    if row.effective_quota_bytes is not None and row.effective_quota_bytes > 0:
        usage_percent = row.used_bytes / row.effective_quota_bytes * 100

    proto = ProtoStorageUsageInfo(
        user_id=str(row.user_id),
        organization_id=str(row.organization_id),
        used_bytes=row.used_bytes,
        file_count=row.file_count,
        usage_percent=usage_percent,
        has_override=row.has_override,
    )

    if row.effective_quota_bytes is not None:
        proto.effective_quota_bytes = row.effective_quota_bytes

    if row.last_recalculated_at:
        proto.last_recalculated_at = datetime_to_timestamp(row.last_recalculated_at)

    return proto
