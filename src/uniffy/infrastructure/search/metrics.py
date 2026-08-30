from prometheus_client import Counter, Histogram

SEARCH_OPERATIONS_TOTAL = Counter(
    "uniffy_search_operations_total",
    "Total search-engine operations",
    ["operation"],
)

SEARCH_OPERATION_DURATION = Histogram(
    "uniffy_search_operation_duration_seconds",
    "Search-engine operation duration in seconds",
    ["operation"],
)

SEARCH_OPERATION_ERRORS_TOTAL = Counter(
    "uniffy_search_operation_errors_total",
    "Total search-engine operation errors",
    ["operation"],
)
