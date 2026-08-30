from prometheus_client import Histogram

RESOURCE_ACCESS_DURATION = Histogram(
    "uniffy_resource_access_duration_seconds",
    "PostgreSQL resource authorization duration",
    ["purpose"],
    buckets=(0.0005, 0.001, 0.0025, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5),
)

RESOURCE_ACCESS_CANDIDATES = Histogram(
    "uniffy_resource_access_candidates",
    "Candidates in a PostgreSQL resource authorization batch",
    ["purpose"],
    buckets=(1, 5, 10, 20, 60, 100, 200, 300),
)
