from prometheus_client import Counter

OUTBOUND_FETCH_TOTAL = Counter(
    "uniffy_outbound_fetch_total",
    "Fetches of user-supplied URLs by caller and outcome (HTTP status or failure)",
    ["caller", "outcome"],
)
