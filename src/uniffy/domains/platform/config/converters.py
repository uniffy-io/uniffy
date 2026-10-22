from __future__ import annotations

from uniffy_proto.superadmin.v1.system_config_pb import (
    OrgCreationPolicy as OrgCreationPolicyProto,
)
from uniffy_proto.superadmin.v1.system_config_pb import (
    OrgCreationSetting as OrgCreationSettingProto,
)
from uniffy_proto.superadmin.v1.system_config_pb import (
    RealtimeBufferPreflight as RealtimeBufferPreflightProto,
)
from uniffy_proto.superadmin.v1.system_config_pb import (
    RealtimeBufferStatus as RealtimeBufferStatusProto,
)
from uniffy_proto.superadmin.v1.system_config_pb import (
    RealtimeBufferTotals as RealtimeBufferTotalsProto,
)
from uniffy_proto.superadmin.v1.system_config_pb import (
    RealtimeBufferVerdict,
)
from uniffy_proto.superadmin.v1.system_config_pb import (
    SystemConfig as SystemConfigProto,
)
from uniffy_proto.superadmin.v1.system_config_pb import (
    SystemFlag as SystemFlagProto,
)

from uniffy.core.config.org_creation import OrgCreationPolicy, OrgCreationState
from uniffy.core.config.registration import PublicRegistrationState
from uniffy.core.realtime.preflight import PreflightResult, PreflightVerdict
from uniffy.domains.platform.config.operations import SystemConfigState
from uniffy.domains.platform.config.realtime import BufferTotals, RealtimeBufferStatus

# Enough to tell instances apart across a restart without echoing the full identity.
RUN_ID_PREFIX_LENGTH = 8

_VERDICT_TO_PROTO = {
    PreflightVerdict.ENABLED: RealtimeBufferVerdict.ENABLED,
    PreflightVerdict.DISABLED: RealtimeBufferVerdict.DISABLED,
    PreflightVerdict.UNKNOWN: RealtimeBufferVerdict.UNKNOWN,
}

_ORG_CREATION_POLICY_TO_PROTO = {
    OrgCreationPolicy.OPERATORS_ONLY: OrgCreationPolicyProto.OPERATORS_ONLY,
    OrgCreationPolicy.OPERATORS_AND_OWNERS: OrgCreationPolicyProto.OPERATORS_AND_OWNERS,
    OrgCreationPolicy.MEMBERS: OrgCreationPolicyProto.MEMBERS,
    OrgCreationPolicy.ANYONE: OrgCreationPolicyProto.ANYONE,
}
_ORG_CREATION_POLICY_FROM_PROTO = {
    proto: policy for policy, proto in _ORG_CREATION_POLICY_TO_PROTO.items()
}


def flag_to_proto(state: PublicRegistrationState) -> SystemFlagProto:
    return SystemFlagProto(enabled=state.enabled, source=state.source.value)


def org_creation_policy_to_proto(policy: OrgCreationPolicy) -> OrgCreationPolicyProto:
    return _ORG_CREATION_POLICY_TO_PROTO[policy]


def org_creation_policy_from_proto(value: OrgCreationPolicyProto) -> OrgCreationPolicy | None:
    """UNSPECIFIED and numbers this build does not know both come back as None."""
    return _ORG_CREATION_POLICY_FROM_PROTO.get(value)


def org_creation_to_proto(state: OrgCreationState) -> OrgCreationSettingProto:
    return OrgCreationSettingProto(
        policy=org_creation_policy_to_proto(state.policy),
        source=state.source.value,
    )


def config_to_proto(state: SystemConfigState) -> SystemConfigProto:
    return SystemConfigProto(
        public_registration=flag_to_proto(state.public_registration),
        org_creation=org_creation_to_proto(state.org_creation),
    )


def realtime_buffer_to_proto(status: RealtimeBufferStatus) -> RealtimeBufferStatusProto:
    preflight = status.preflight
    return RealtimeBufferStatusProto(
        verdict=(
            RealtimeBufferVerdict.NOT_RUN
            if preflight is None
            else _VERDICT_TO_PROTO[preflight.verdict]
        ),
        preflight_mode=status.mode.value,
        pending_budget_from_env=status.budget_from_env,
        preflight=None if preflight is None else _preflight_to_proto(preflight),
        totals=None if status.totals is None else _totals_to_proto(status.totals),
        epoch_resets=status.epoch_resets,
        poisoned_checkpoints=status.poisoned_checkpoints,
    )


def _preflight_to_proto(result: PreflightResult) -> RealtimeBufferPreflightProto:
    return RealtimeBufferPreflightProto(
        eviction_policy=result.policy,
        maxmemory_bytes=result.maxmemory,
        aof_enabled=result.aof_enabled,
        rdb_snapshots_configured=result.rdb_save_configured,
        loss_window=result.loss_window,
        valkey_version=result.version,
        valkey_run_id_prefix=result.run_id[:RUN_ID_PREFIX_LENGTH],
        pending_budget_bytes=result.pending_budget_bytes,
    )


def _totals_to_proto(totals: BufferTotals) -> RealtimeBufferTotalsProto:
    return RealtimeBufferTotalsProto(
        pending_bytes=totals.pending_bytes,
        pending_records=totals.pending_records,
        pending_documents=totals.pending_documents,
        oldest_pending_seconds=totals.oldest_pending_seconds,
    )
