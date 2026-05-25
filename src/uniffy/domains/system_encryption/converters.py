"""Proto <-> domain mapping for ``superadmin.v1.SystemEncryptionService``."""

from __future__ import annotations

from google.protobuf.timestamp_pb2 import Timestamp
from uniffy_proto.superadmin.v1.system_encryption_pb2 import (
    DeploymentEncryptionStatus as DeploymentEncryptionStatusProto,
)

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
        ts.FromDatetime(status.active_created_at)
        msg.active_created_at.CopyFrom(ts)
    return msg
