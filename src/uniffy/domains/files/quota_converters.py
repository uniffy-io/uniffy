"""Proto <-> domain converters for storage quota types."""

from uniffy_proto.files.v1.files_pb2 import (
    OrgStorageQuota as ProtoOrgStorageQuota,
)
from uniffy_proto.files.v1.files_pb2 import (
    StorageUsageInfo as ProtoStorageUsageInfo,
)
from uniffy_proto.files.v1.files_pb2 import (
    UserStorageQuotaOverrideInfo as ProtoUserStorageQuotaOverrideInfo,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.files.storage_quota import StorageQuota
from uniffy.core.models.files.storage_usage import StorageUsage
from uniffy.core.models.files.user_storage_quota_override import UserStorageQuotaOverride
from uniffy.domains.files.quota_operations import UserUsageRow


def storage_quota_to_proto(quota: StorageQuota) -> ProtoOrgStorageQuota:
    """
    Convert a StorageQuota model to its proto representation.

    Parameters
    ----------
    quota : StorageQuota
        Storage quota model instance.

    Returns
    -------
    ProtoOrgStorageQuota
        Proto message.

    """
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
        proto.updated_at.CopyFrom(datetime_to_timestamp(quota.updated_at))

    return proto


def user_quota_override_to_proto(
    override: UserStorageQuotaOverride,
) -> ProtoUserStorageQuotaOverrideInfo:
    """
    Convert a UserStorageQuotaOverride model to its proto representation.

    Parameters
    ----------
    override : UserStorageQuotaOverride
        Override model instance.

    Returns
    -------
    ProtoUserStorageQuotaOverrideInfo
        Proto message.

    """
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
        proto.updated_at.CopyFrom(datetime_to_timestamp(override.updated_at))

    return proto


def storage_usage_to_proto(
    usage: StorageUsage,
    effective_quota_bytes: int | None = None,
    has_override: bool = False,
) -> ProtoStorageUsageInfo:
    """
    Convert a StorageUsage model to its proto representation.

    Parameters
    ----------
    usage : StorageUsage
        Usage model instance.
    effective_quota_bytes : int | None
        Resolved effective quota for this user.
    has_override : bool
        Whether the user has a custom quota override.

    Returns
    -------
    ProtoStorageUsageInfo
        Proto message.

    """
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
        proto.last_recalculated_at.CopyFrom(datetime_to_timestamp(usage.last_recalculated_at))

    return proto


def user_usage_row_to_proto(row: UserUsageRow) -> ProtoStorageUsageInfo:
    """Convert a ``UserUsageRow`` (admin table row) to its proto shape.

    Handles zero-usage members (no ``StorageUsage`` row) and members with
    an explicit per-user override -- the row already carries the resolved
    ``effective_quota_bytes`` and ``has_override`` flag.
    """
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
        proto.last_recalculated_at.CopyFrom(datetime_to_timestamp(row.last_recalculated_at))

    return proto
