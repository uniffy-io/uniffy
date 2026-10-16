from __future__ import annotations

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

from uniffy.core.config.registration import PublicRegistrationState
from uniffy.core.realtime.preflight import PreflightResult, PreflightVerdict
from uniffy.domains.platform.config.realtime import BufferTotals, RealtimeBufferStatus

# Enough to tell instances apart across a restart without echoing the full identity.
RUN_ID_PREFIX_LENGTH = 8

_VERDICT_TO_PROTO = {
    PreflightVerdict.ENABLED: RealtimeBufferVerdict.ENABLED,
    PreflightVerdict.DISABLED: RealtimeBufferVerdict.DISABLED,
    PreflightVerdict.UNKNOWN: RealtimeBufferVerdict.UNKNOWN,
}


def flag_to_proto(state: PublicRegistrationState) -> SystemFlagProto:
    return SystemFlagProto(enabled=state.enabled, source=state.source.value)


def config_to_proto(states: dict[str, PublicRegistrationState]) -> SystemConfigProto:
    msg = SystemConfigProto()
    public = states.get("public_registration")
    if public is not None:
        msg.public_registration = flag_to_proto(public)
    return msg


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
