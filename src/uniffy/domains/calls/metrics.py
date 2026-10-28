"""Bounded operator metrics; identities belong in logs, never labels."""

from enum import StrEnum

from prometheus_client import Counter, Gauge, Histogram

from uniffy.core.models.calls import CallEndReason, CallType


class JoinOutcome(StrEnum):
    SUCCESS = "success"
    NOT_FOUND = "not_found"
    DENIED = "denied"
    DISABLED = "disabled"
    FULL = "full"
    ENDED = "ended"
    DEVICE_LIMIT = "device_limit"
    ANOTHER_CALL = "another_call"
    INVALID = "invalid"
    NOT_CONFIGURED = "not_configured"
    MEDIA_UNAVAILABLE = "media_unavailable"
    ERROR = "error"
    CANCELLED = "cancelled"


class RingOutcome(StrEnum):
    DISPATCHED = "dispatched"
    DECLINED = "declined"
    SUPPRESSED = "suppressed"
    NO_RECIPIENTS = "no_recipients"
    ERROR = "error"


class Outcome(StrEnum):
    SUCCESS = "success"
    ERROR = "error"
    SKIPPED = "skipped"
    DEGRADED = "degraded"
    CANCELLED = "cancelled"


class MediaEvent(StrEnum):
    PARTICIPANT_JOINED = "participant_joined"
    PARTICIPANT_LEFT = "participant_left"
    PARTICIPANT_ABORTED = "participant_connection_aborted"
    ROOM_FINISHED = "room_finished"
    ROOM_STARTED = "room_started"
    TRACK_PUBLISHED = "track_published"
    TRACK_UNPUBLISHED = "track_unpublished"
    EGRESS_STARTED = "egress_started"
    EGRESS_UPDATED = "egress_updated"
    EGRESS_ENDED = "egress_ended"
    INGRESS_STARTED = "ingress_started"
    INGRESS_ENDED = "ingress_ended"
    UNKNOWN = "unknown"


CALLS_STARTED = Counter("uniffy_calls_started_total", "Committed new calls", ["type"])
CALLS_ENDED = Counter("uniffy_calls_ended_total", "Committed call endings", ["reason"])
CALL_DURATION = Histogram(
    "uniffy_calls_duration_seconds",
    "Duration of committed ended calls",
    buckets=(10, 30, 60, 180, 300, 900, 1800, 3600, 7200, 14400, 28800),
)
JOINS = Counter(
    "uniffy_calls_joins_total", "Admission attempts, not ICE connections", ["operation", "outcome"]
)
RINGS = Counter(
    "uniffy_calls_rings_total",
    "Ring dispatch batches and explicit decline acknowledgements",
    ["outcome"],
)
WEBHOOK_VERIFICATION = Counter(
    "uniffy_calls_webhook_verifications_total", "Received webhook verification attempts", ["outcome"]
)
WEBHOOK_EVENTS = Counter(
    "uniffy_calls_webhook_events_total", "Verified webhook processing attempts", ["event", "outcome"]
)
MAINTENANCE_RUNS = Counter(
    "uniffy_calls_maintenance_runs_total", "Maintenance passes", ["task", "outcome"]
)
MAINTENANCE_REPAIRS = Counter(
    "uniffy_calls_maintenance_repairs_total",
    "Repairs reported by completed maintenance passes",
    ["task", "repair"],
)
MAINTENANCE_LAST_SUCCESS = Gauge(
    "uniffy_calls_maintenance_last_success_timestamp_seconds",
    "Last successful maintenance pass",
    ["task"],
    multiprocess_mode="livemax",
)
CIRCUIT_OPENED = Counter("uniffy_calls_livekit_circuit_opened_total", "LiveKit circuit openings")
CIRCUIT_OPEN_UNTIL = Gauge(
    "uniffy_calls_livekit_circuit_open_until_timestamp_seconds",
    "Circuit is open while this Unix timestamp is in the future",
    multiprocess_mode="livemax",
)
LIVE_CALLS = Gauge(
    "uniffy_calls_live",
    "PostgreSQL active calls at last snapshot",
    multiprocess_mode="livemostrecent",
)
LIVE_PARTICIPANTS = Gauge(
    "uniffy_calls_participants_live",
    "PostgreSQL active participant devices at last snapshot",
    multiprocess_mode="livemostrecent",
)
SNAPSHOT_TIME = Gauge(
    "uniffy_calls_snapshot_timestamp_seconds",
    "Last successful PostgreSQL snapshot",
    multiprocess_mode="livemostrecent",
)
PROBE_UP = Gauge(
    "uniffy_calls_probe_up",
    "Dependency probe result: 1 healthy, 0 failed, -1 not configured",
    ["target"],
    multiprocess_mode="livemostrecent",
)
PROBE_TIME = Gauge(
    "uniffy_calls_probe_timestamp_seconds",
    "Last completed dependency probe",
    ["target"],
    multiprocess_mode="livemostrecent",
)
PROBE_DURATION = Histogram(
    "uniffy_calls_probe_duration_seconds",
    "Dependency probe duration",
    ["target"],
    buckets=(0.05, 0.1, 0.5, 1, 2, 5, 10, 20),
)

# Preinitialize bounded counters so the first event has a scrapeable zero baseline.
for _call_type in CallType:
    CALLS_STARTED.labels(_call_type.value)
for _reason in CallEndReason:
    CALLS_ENDED.labels(_reason.value)
for _operation in ("initiate_call", "join_call"):
    for _join_outcome in JoinOutcome:
        JOINS.labels(_operation, _join_outcome)
for _ring_outcome in RingOutcome:
    RINGS.labels(_ring_outcome)
for _outcome in (Outcome.SUCCESS, Outcome.ERROR):
    WEBHOOK_VERIFICATION.labels(_outcome)

for _event in MediaEvent:
    for _event_outcome in (Outcome.SUCCESS, Outcome.ERROR, Outcome.SKIPPED, Outcome.CANCELLED):
        WEBHOOK_EVENTS.labels(_event, _event_outcome)
for _task in ("reconcile_calls", "cleanup_orphan_call_rooms"):
    for _maintenance_outcome in Outcome:
        MAINTENANCE_RUNS.labels(_task, _maintenance_outcome)
    MAINTENANCE_LAST_SUCCESS.labels(_task)
