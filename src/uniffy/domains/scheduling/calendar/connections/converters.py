"""Connection rows as the API shows them; tokens, cursors and channel secrets never leave."""

from uniffy_proto.cal.v1.calendar_pb import CalendarProvider as ProtoProvider
from uniffy_proto.cal.v1.calendar_pb import CalendarSyncDirection as ProtoDirection
from uniffy_proto.cal.v1.calendar_pb import CalendarSyncError as ProtoSyncError
from uniffy_proto.cal.v1.calendar_pb import ConnectedCalendarState as ProtoCalendarState
from uniffy_proto.cal.v1.calendar_pb import ConnectedCalendarSummary
from uniffy_proto.cal.v1.connections_pb import CalendarConnection as ProtoConnection
from uniffy_proto.cal.v1.connections_pb import CalendarConnectionStatus as ProtoStatus
from uniffy_proto.cal.v1.connections_pb import ProviderCalendar
from uniffy_proto.cal.v1.connections_pb import ProviderCalendarAccess as ProtoAccess
from uniffy_proto.cal.v1.connections_pb import ProviderCredentialSource as ProtoSource

from uniffy.core.converters import datetime_to_timestamp, optional_timestamp
from uniffy.core.models.calendar.connection import (
    CalendarConnection,
    CalendarProvider,
    ConnectedCalendar,
    ConnectionStatus,
    ProviderAccessRole,
    SyncDirection,
    SyncFailure,
)
from uniffy.domains.scheduling.calendar.connections.credentials import CredentialSource
from uniffy.domains.scheduling.calendar.connections.operations import ConnectionView, can_write
from uniffy.domains.scheduling.calendar.connections.state import CalendarHealth, health_of

PROVIDER_TO_PROTO = {
    CalendarProvider.GOOGLE: ProtoProvider.GOOGLE,
    CalendarProvider.MICROSOFT: ProtoProvider.MICROSOFT,
}
PROVIDER_FROM_PROTO = {proto: value for value, proto in PROVIDER_TO_PROTO.items()}
DIRECTION_TO_PROTO = {
    SyncDirection.INBOUND: ProtoDirection.INBOUND,
    SyncDirection.TWO_WAY: ProtoDirection.TWO_WAY,
}
DIRECTION_FROM_PROTO = {proto: value for value, proto in DIRECTION_TO_PROTO.items()}
_STATUS = {
    ConnectionStatus.ACTIVE: ProtoStatus.ACTIVE,
    ConnectionStatus.PAUSED: ProtoStatus.PAUSED,
    ConnectionStatus.REAUTH_REQUIRED: ProtoStatus.REAUTH_REQUIRED,
    ConnectionStatus.DISCONNECTED: ProtoStatus.DISCONNECTED,
}
_ACCESS = {
    ProviderAccessRole.OWNER: ProtoAccess.OWNER,
    ProviderAccessRole.WRITER: ProtoAccess.WRITER,
    ProviderAccessRole.READER: ProtoAccess.READER,
    ProviderAccessRole.FREE_BUSY: ProtoAccess.FREE_BUSY,
}
_HEALTH = {
    CalendarHealth.PENDING: ProtoCalendarState.PENDING,
    CalendarHealth.HEALTHY: ProtoCalendarState.HEALTHY,
    CalendarHealth.FAILING: ProtoCalendarState.FAILING,
    CalendarHealth.BROKEN: ProtoCalendarState.BROKEN,
    CalendarHealth.PAUSED: ProtoCalendarState.PAUSED,
    CalendarHealth.REAUTH_REQUIRED: ProtoCalendarState.REAUTH_REQUIRED,
    CalendarHealth.DETACHED: ProtoCalendarState.DETACHED,
}
_ERRORS = {
    SyncFailure.UNREACHABLE: ProtoSyncError.UNREACHABLE,
    SyncFailure.RATE_LIMITED: ProtoSyncError.RATE_LIMITED,
    SyncFailure.PROVIDER_ERROR: ProtoSyncError.PROVIDER_ERROR,
    SyncFailure.PERMISSION_DENIED: ProtoSyncError.PERMISSION_DENIED,
    SyncFailure.NOT_FOUND: ProtoSyncError.NOT_FOUND,
    SyncFailure.REAUTH_REQUIRED: ProtoSyncError.REAUTH_REQUIRED,
    SyncFailure.UNPROCESSABLE: ProtoSyncError.UNPROCESSABLE,
}
SOURCE_TO_PROTO = {
    None: ProtoSource.NONE,
    CredentialSource.ORGANIZATION: ProtoSource.ORGANIZATION,
    CredentialSource.DEPLOYMENT: ProtoSource.DEPLOYMENT,
}


def error_to_proto(code: SyncFailure | None) -> int:
    return _ERRORS.get(code, ProtoSyncError.UNSPECIFIED) if code else ProtoSyncError.UNSPECIFIED


def calendar_to_proto(
    row: ConnectedCalendar,
    connection: CalendarConnection,
    *,
    writes_enabled: bool,
    policy_allows: bool,
) -> ProviderCalendar:
    message = ProviderCalendar(
        id=str(row.id),
        name=row.name,
        provider_color=row.provider_color or "",
        access=_ACCESS[row.access_role],
        is_primary=row.is_primary,
        is_system=row.is_system,
        sync_enabled=row.sync_enabled,
        direction=DIRECTION_TO_PROTO[row.direction],
        can_write=can_write(row, writes_enabled),
        counts_as_busy=row.counts_as_busy,
        state=_HEALTH[health_of(row, connection, policy_allows=policy_allows)],
        last_error=error_to_proto(row.last_error_code),
        event_count=row.event_count,
        skipped_count=row.skipped_count,
    )
    if row.calendar_id is not None:
        message.calendar_id = str(row.calendar_id)
    if row.last_success_at is not None:
        message.last_success_at = optional_timestamp(row.last_success_at)
    return message


def connection_to_proto(view: ConnectionView) -> ProtoConnection:
    connection = view.connection
    message = ProtoConnection(
        id=str(connection.id),
        provider=PROVIDER_TO_PROTO[connection.provider],
        account_email=connection.account_email,
        status=_STATUS[connection.status],
        calendars=[
            calendar_to_proto(
                row,
                connection,
                writes_enabled=view.writes_enabled,
                policy_allows=view.policy_allows,
            )
            for row in view.calendars
        ],
        created_at=datetime_to_timestamp(connection.created_at),
    )
    if connection.last_synced_at is not None:
        message.last_synced_at = optional_timestamp(connection.last_synced_at)
    return message


def summary_to_proto(
    row: ConnectedCalendar, connection: CalendarConnection, *, policy_allows: bool
) -> ConnectedCalendarSummary:
    message = ConnectedCalendarSummary(
        connected_calendar_id=str(row.id),
        connection_id=str(connection.id),
        provider=PROVIDER_TO_PROTO[connection.provider],
        account_email=connection.account_email,
        direction=DIRECTION_TO_PROTO[row.direction],
        state=_HEALTH[health_of(row, connection, policy_allows=policy_allows)],
        last_error=error_to_proto(row.last_error_code),
        counts_as_busy=row.counts_as_busy,
    )
    if row.last_success_at is not None:
        message.last_success_at = optional_timestamp(row.last_success_at)
    return message
