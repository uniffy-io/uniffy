from prometheus_client import Counter, Histogram

INTEGRATION_HTTP_REQUESTS_TOTAL = Counter(
    "uniffy_integration_http_requests_total",
    "Outbound integration API requests by response class",
    ["provider", "status_class"],
)

INTEGRATION_HTTP_DURATION = Histogram(
    "uniffy_integration_http_duration_seconds",
    "Outbound integration API request duration",
    ["provider"],
)

INTEGRATION_CONNECTION_VALIDATIONS_TOTAL = Counter(
    "uniffy_integration_connection_validations_total",
    "Integration credential probes by outcome",
    ["provider", "outcome"],
)
