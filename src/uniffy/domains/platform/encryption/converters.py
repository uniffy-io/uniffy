"""Proto <-> domain mapping for ``superadmin.v1.SystemEncryptionService``."""

from __future__ import annotations

from protobuf.wkt import Timestamp
from uniffy_proto.superadmin.v1.system_encryption_pb import (
    DeploymentEncryptionStatus as DeploymentEncryptionStatusProto,
)

from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.crypto import DeploymentEncryptionStatus


def status_to_proto(
    status: DeploymentEncryptionStatus,
) -> DeploymentEncryptionStatusProto:
    msg = DeploymentEncryptionStatusProto(
        active_version=status.active_version or 0,
        total_versions=status.total_versions,
    )
    if status.active_created_at is not None:
        ts = Timestamp()
        ts = datetime_to_timestamp(status.active_created_at)
        msg.active_created_at = ts
    return msg
