from prometheus_client import Counter, Gauge, Histogram

PUBSUB_ACTIVE_SUBSCRIBERS = Gauge(
    "uniffy_pubsub_active_subscribers",
    "Number of active Pub/Sub streaming connections",
    multiprocess_mode="livesum",
)

CACHE_HIT_TOTAL = Counter(
    "uniffy_cache_hit_total",
    "Valkey cache hits per namespace",
    ["namespace"],
)

CACHE_MISS_TOTAL = Counter(
    "uniffy_cache_miss_total",
    "Valkey cache misses per namespace",
    ["namespace"],
)

CACHE_SET_TOTAL = Counter(
    "uniffy_cache_set_total",
    "Valkey cache writes per namespace",
    ["namespace"],
)

CACHE_INVALIDATE_TOTAL = Counter(
    "uniffy_cache_invalidate_total",
    "Valkey cache invalidations per namespace",
    ["namespace"],
)

CACHE_LOAD_DURATION = Histogram(
    "uniffy_cache_load_duration_seconds",
    "Cache loader duration on miss, per namespace",
    ["namespace"],
)

CACHE_STAMPEDE_LOCK_WAIT_TOTAL = Counter(
    "uniffy_cache_stampede_lock_wait_total",
    "Callers that waited for a cache stampede lock, per namespace",
    ["namespace"],
)

CACHE_OP_TIMEOUT_TOTAL = Counter(
    "uniffy_cache_op_timeout_total",
    "Valkey ops-client calls that tripped the per-call deadline guard",
    ["namespace", "op"],
)
