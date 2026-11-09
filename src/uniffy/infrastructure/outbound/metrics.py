from prometheus_client import Counter, Histogram

OUTBOUND_FETCH_TOTAL = Counter(
    "uniffy_outbound_fetch_total",
    "Fetches of user-supplied URLs by caller and outcome (HTTP status or failure)",
    ["caller", "outcome"],
)

OUTBOUND_API_TOTAL = Counter(
    "uniffy_outbound_api_total",
    "Calls to fixed provider APIs by provider, method and outcome (HTTP status or failure)",
    ["caller", "method", "outcome"],
)

OUTBOUND_API_DURATION = Histogram(
    "uniffy_outbound_api_duration_seconds",
    "Latency of calls to fixed provider APIs",
    ["caller"],
)
