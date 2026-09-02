from prometheus_client import Counter, Gauge

PUBSUB_ACTIVE_SUBSCRIBERS = Gauge(
    "uniffy_pubsub_active_subscribers",
    "Number of active Pub/Sub streaming connections",
    multiprocess_mode="livesum",
)

CACHE_OP_TIMEOUT_TOTAL = Counter(
    "uniffy_cache_op_timeout_total",
    "Valkey ops-client calls that tripped the per-call deadline guard",
    ["namespace", "op"],
)
