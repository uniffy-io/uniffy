"""Proto <-> domain mapping for ``superadmin.v1.SystemConfigService``."""

from __future__ import annotations

from uniffy_proto.superadmin.v1.system_config_pb2 import (
    SystemConfig as SystemConfigProto,
)
from uniffy_proto.superadmin.v1.system_config_pb2 import (
    SystemFlag as SystemFlagProto,
)

from uniffy.domains.system_config.operations import SystemFlagState


def flag_to_proto(state: SystemFlagState) -> SystemFlagProto:
    return SystemFlagProto(enabled=state.enabled, source=state.source)


def config_to_proto(states: dict[str, SystemFlagState]) -> SystemConfigProto:
    msg = SystemConfigProto()
    public = states.get("public_registration")
    if public is not None:
        msg.public_registration.CopyFrom(flag_to_proto(public))
    return msg
