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

REALTIME_SNAPSHOT_TASK_DURATION = Histogram(
    "uniffy_realtime_snapshot_task_duration_seconds",
    "End-to-end duration of the realtime snapshot job",
    ["content_type"],
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

REALTIME_WRITE_REJECTIONS = Counter(
    "uniffy_realtime_write_rejections_total", "Rejected durable document writes", ["reason"]
)
REALTIME_PROJECTION_OUTCOMES = Counter(
    "uniffy_realtime_projection_outcomes_total", "Worker projection attempts", ["outcome"]
)
REALTIME_BACKLOG_DEPTH = Gauge(
    "uniffy_realtime_backlog_depth", "Pending durable work rows", ["kind"]
)

REALTIME_VALKEY_PREFLIGHT = Gauge(
    "uniffy_realtime_valkey_preflight",
    "Valkey deployment preflight verdict for buffered realtime edits; the current verdict reads 1",
    ["verdict"],
    multiprocess_mode="livemax",
)

# Buffered checkpoint metrics never carry document labels; buckets are the fixed buffer shards.
REALTIME_CHECKPOINT_DURATION = Histogram(
    "uniffy_realtime_checkpoint_duration_seconds",
    "Buffered document checkpoint passes by outcome",
    ["outcome"],
)
REALTIME_CHECKPOINT_AGE = Histogram(
    "uniffy_realtime_checkpoint_age_seconds",
    "Age of the oldest accepted edit a checkpoint commit covered",
    buckets=(1, 2.5, 5, 10, 15, 20, 30, 60, 120, 300, 900),
)
REALTIME_CHECKPOINT_RETRIES_TOTAL = Counter(
    "uniffy_realtime_checkpoint_retries_total",
    "Checkpoint commits recaptured because a competing write changed the checkpoint",
    ["reason"],
)
REALTIME_CHECKPOINT_TRIM_DEBT_TOTAL = Counter(
    "uniffy_realtime_checkpoint_trim_debt_total",
    "Committed buffered records left in Valkey by a failed cleanup, and records maintenance cleaned",
    ["event"],
)
REALTIME_CHECKPOINT_POISON_TOTAL = Counter(
    "uniffy_realtime_checkpoint_poison_total",
    "Checkpoint passes stopped by a stored update that cannot be read or merged",
    ["reason"],
)
REALTIME_CHECKPOINT_DISPATCH_BATCH = Histogram(
    "uniffy_realtime_checkpoint_dispatch_batch",
    "Checkpoint jobs enqueued per dispatcher tick",
    buckets=(0, 1, 2, 4, 8, 16, 32, 64),
)
REALTIME_CHECKPOINT_QUEUE_AGE = Gauge(
    "uniffy_realtime_checkpoint_queue_age_seconds",
    "How long the oldest due checkpoint has waited past its due time",
    multiprocess_mode="livemax",
)
REALTIME_BUFFER_OLDEST_PENDING_SECONDS = Gauge(
    "uniffy_realtime_buffer_oldest_pending_seconds",
    "Age of the oldest uncheckpointed edit; a backed-off document counts from its retry",
    multiprocess_mode="livemax",
)
REALTIME_BUFFER_PENDING_BYTES = Gauge(
    "uniffy_realtime_buffer_pending_bytes",
    "Accepted update bytes awaiting checkpoint per buffer bucket",
    ["bucket"],
    multiprocess_mode="livemax",
)
REALTIME_BUFFER_PENDING_RECORDS = Gauge(
    "uniffy_realtime_buffer_pending_records",
    "Accepted update records awaiting checkpoint per buffer bucket",
    ["bucket"],
    multiprocess_mode="livemax",
)
REALTIME_BUFFER_MAINTENANCE_CYCLE_SECONDS = Gauge(
    "uniffy_realtime_buffer_maintenance_cycle_seconds",
    "Duration of the last complete buffer maintenance walk over the key space",
    multiprocess_mode="livemax",
)
REALTIME_BUFFER_ADMISSIONS_TOTAL = Counter(
    "uniffy_realtime_buffer_admissions_total",
    "Buffered realtime update admissions by outcome",
    ["outcome"],
)
REALTIME_BUFFER_EPOCH_RESETS_TOTAL = Counter(
    "uniffy_realtime_buffer_epoch_resets_total",
    "Buffer epochs replaced, by the condition that forced the reset",
    ["reason"],
)
REALTIME_RECEIPT_LATENCY = Histogram(
    "uniffy_realtime_receipt_latency_seconds",
    "Time from a live update frame arriving to its accepted receipt",
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1, 2.5),
)
REALTIME_GAP_REPAIRS_TOTAL = Counter(
    "uniffy_realtime_gap_repairs_total",
    "Resident documents reloaded from checkpoint and buffer because an update hint did not "
    "continue their head",
    ["cause"],
)
