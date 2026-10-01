from prometheus_client import Counter, Gauge, Histogram

REALTIME_BLANK_CONTENT_OVERWRITES_TOTAL = Counter(
    "uniffy_realtime_blank_content_overwrites_total",
    "Realtime saves that replaced non-empty content with an empty render",
    ["content_type"],
)

REALTIME_ACTIVE_DOCS = Gauge(
    "uniffy_realtime_active_docs",
    "Yjs documents currently hydrated in this replica's YDocManager",
    ["content_type"],
    multiprocess_mode="livesum",
)

REALTIME_ACTIVE_CLIENTS = Gauge(
    "uniffy_realtime_active_clients",
    "Realtime client handles attached on this replica",
    ["content_type"],
    multiprocess_mode="livesum",
)

REALTIME_HYDRATION_DURATION = Histogram(
    "uniffy_realtime_hydration_duration_seconds",
    "Time to hydrate a fresh YDoc on first acquire",
    ["content_type", "source"],
)

REALTIME_SNAPSHOT_DURATION = Histogram(
    "uniffy_realtime_snapshot_duration_seconds",
    "Time to encode and enqueue a debounced snapshot",
    ["content_type"],
)

REALTIME_SNAPSHOT_TASK_DURATION = Histogram(
    "uniffy_realtime_snapshot_task_duration_seconds",
    "End-to-end duration of the realtime snapshot job",
    ["content_type"],
)

REALTIME_SNAPSHOT_DROPPED_TOTAL = Counter(
    "uniffy_realtime_snapshot_dropped_total",
    "Snapshot attempts that did not result in a persisted row",
    ["content_type", "reason"],
)

REALTIME_SNAPSHOT_SUPERSEDED_TOTAL = Counter(
    "uniffy_realtime_snapshot_superseded_total",
    "Snapshot jobs skipped because a newer snapshot or a newer plain write landed first",
    ["content_type", "reason"],
)

REALTIME_RENDER_CONFLICTS_TOTAL = Counter(
    "uniffy_realtime_render_conflicts_total",
    "Domain renders that lost their version race and were handed to the worker retry",
    ["content_type"],
)

REALTIME_UPDATE_MESSAGES_TOTAL = Counter(
    "uniffy_realtime_update_messages_total",
    "Yjs synchronization update frames observed per direction",
    ["content_type", "direction"],
)

REALTIME_AWARENESS_MESSAGES_TOTAL = Counter(
    "uniffy_realtime_awareness_messages_total",
    "Awareness frames echoed across realtime sessions",
    ["content_type"],
)

REALTIME_PUBSUB_LATENCY = Histogram(
    "uniffy_realtime_pubsub_latency_seconds",
    "Latency from publish to in-process realtime router dispatch",
    ["channel"],
)

REALTIME_PUBSUB_RECONNECTS_TOTAL = Counter(
    "uniffy_realtime_pubsub_reconnects_total",
    "Realtime router subscribers that crashed and re-attached",
    ["pattern"],
)

REALTIME_FRAMES_DROPPED_TOTAL = Counter(
    "uniffy_realtime_frames_dropped_total",
    "Realtime frames dropped before reaching their destination",
    ["kind"],
)

REALTIME_PERMISSION_REJECTIONS_TOTAL = Counter(
    "uniffy_realtime_permission_rejections_total",
    "Realtime sessions or frames rejected by permission checks",
    ["content_type", "reason"],
)

REALTIME_AUTH_FAILURES_TOTAL = Counter(
    "uniffy_realtime_auth_failures_total",
    "Realtime WebSocket upgrades that failed authentication or origin checks",
    ["reason"],
)

REALTIME_REAUTH_CLOSES_TOTAL = Counter(
    "uniffy_realtime_reauth_closes_total",
    "Live realtime sockets closed by periodic re-authorization",
    ["reason"],
)
