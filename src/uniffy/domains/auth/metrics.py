from prometheus_client import Counter

AUTH_ATTEMPTS_TOTAL = Counter(
    "uniffy_auth_attempts_total",
    "Total authentication attempts",
    ["operation", "outcome"],
)
