from uniffy_proto.cal.v1.calendar_pb import CalendarSubscription as ProtoCalendarSubscription
from uniffy_proto.cal.v1.calendar_pb import CalendarSubscriptionError as ProtoError
from uniffy_proto.cal.v1.calendar_pb import CalendarSubscriptionState as ProtoState

from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.models.calendar.subscription import CalendarSubscription, SubscriptionFailure
from uniffy.domains.scheduling.calendar.subscriptions.state import SubscriptionState, state_of

_STATE_TO_PROTO: dict[SubscriptionState, ProtoState] = {
    SubscriptionState.PENDING: ProtoState.PENDING,
    SubscriptionState.HEALTHY: ProtoState.HEALTHY,
    SubscriptionState.FAILING: ProtoState.FAILING,
    SubscriptionState.BROKEN: ProtoState.BROKEN,
    SubscriptionState.PAUSED: ProtoState.PAUSED,
}

_ERROR_TO_PROTO: dict[SubscriptionFailure, ProtoError] = {
    SubscriptionFailure.INVALID_URL: ProtoError.INVALID_URL,
    SubscriptionFailure.UNRESOLVABLE: ProtoError.UNRESOLVABLE,
    SubscriptionFailure.BLOCKED_ADDRESS: ProtoError.BLOCKED_ADDRESS,
    SubscriptionFailure.UNREACHABLE: ProtoError.UNREACHABLE,
    SubscriptionFailure.TIMEOUT: ProtoError.TIMEOUT,
    SubscriptionFailure.HTTP_STATUS: ProtoError.HTTP_STATUS,
    SubscriptionFailure.TOO_LARGE: ProtoError.TOO_LARGE,
    SubscriptionFailure.REDIRECT_REFUSED: ProtoError.REDIRECT_REFUSED,
    SubscriptionFailure.TOO_MANY_REDIRECTS: ProtoError.TOO_MANY_REDIRECTS,
    SubscriptionFailure.NOT_A_CALENDAR: ProtoError.NOT_A_CALENDAR,
    SubscriptionFailure.TOO_MANY_EVENTS: ProtoError.TOO_MANY_EVENTS,
    SubscriptionFailure.POLICY_DISABLED: ProtoError.POLICY_DISABLED,
    SubscriptionFailure.UNPROCESSABLE: ProtoError.UNPROCESSABLE,
}
_ERROR_CODES = {failure.value: failure for failure in SubscriptionFailure}


def subscription_to_proto(
    row: CalendarSubscription, *, policy_allows: bool
) -> ProtoCalendarSubscription:
    message = ProtoCalendarSubscription(
        url_host=row.url_host,
        refresh_interval_minutes=row.refresh_interval_minutes,
        counts_as_busy=row.counts_as_busy,
        state=_STATE_TO_PROTO[state_of(row, policy_allows=policy_allows)],
        next_refresh_at=datetime_to_timestamp(row.next_refresh_at),
        consecutive_failures=row.consecutive_failures,
        last_error_status=row.last_error_status or 0,
        event_count=row.event_count,
        skipped_count=row.skipped_count,
    )
    if row.last_success_at is not None:
        message.last_success_at = datetime_to_timestamp(row.last_success_at)
    if row.last_attempt_at is not None:
        message.last_attempt_at = datetime_to_timestamp(row.last_attempt_at)
    if row.last_error_code is not None:
        # A code written by a newer build reads as unspecified rather than failing the listing.
        failure = _ERROR_CODES.get(row.last_error_code)
        message.last_error = _ERROR_TO_PROTO.get(failure, ProtoError.UNSPECIFIED)
    return message


def failure_to_proto(failure: SubscriptionFailure) -> ProtoError:
    return _ERROR_TO_PROTO.get(failure, ProtoError.UNSPECIFIED)
