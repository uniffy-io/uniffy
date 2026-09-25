from __future__ import annotations

from uniffy_proto.superadmin.v1.system_config_pb import (
    SystemConfig as SystemConfigProto,
)
from uniffy_proto.superadmin.v1.system_config_pb import (
    SystemFlag as SystemFlagProto,
)

from uniffy.core.config.registration import PublicRegistrationState


def flag_to_proto(state: PublicRegistrationState) -> SystemFlagProto:
    return SystemFlagProto(enabled=state.enabled, source=state.source.value)


def config_to_proto(states: dict[str, PublicRegistrationState]) -> SystemConfigProto:
    msg = SystemConfigProto()
    public = states.get("public_registration")
    if public is not None:
        msg.public_registration = flag_to_proto(public)
    return msg
