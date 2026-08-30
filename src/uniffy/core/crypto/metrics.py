from prometheus_client import Counter, Histogram

ORG_DEK_CACHE_HIT_TOTAL = Counter(
    "uniffy_org_dek_cache_hit_total",
    "In-process per-org DEK cache hits",
)

ORG_DEK_CACHE_MISS_TOTAL = Counter(
    "uniffy_org_dek_cache_miss_total",
    "In-process per-org DEK cache misses",
)

ORG_DEK_UNWRAP_SECONDS = Histogram(
    "uniffy_org_dek_unwrap_seconds",
    "Wall time spent unwrapping a per-org DEK with the master cipher",
)

DEPLOYMENT_DEK_CACHE_HIT_TOTAL = Counter(
    "uniffy_deployment_dek_cache_hit_total",
    "In-process deployment DEK cache hits",
)

DEPLOYMENT_DEK_CACHE_MISS_TOTAL = Counter(
    "uniffy_deployment_dek_cache_miss_total",
    "In-process deployment DEK cache misses",
)

DEPLOYMENT_DEK_UNWRAP_SECONDS = Histogram(
    "uniffy_deployment_dek_unwrap_seconds",
    "Wall time spent unwrapping the deployment DEK with the master cipher",
)
