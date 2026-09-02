from prometheus_client import Counter, Histogram

S3_OPERATIONS_TOTAL = Counter(
    "uniffy_s3_operations_total",
    "Total S3 operations",
    ["operation"],
)

S3_OPERATION_DURATION = Histogram(
    "uniffy_s3_operation_duration_seconds",
    "S3 operation duration in seconds",
    ["operation"],
)

S3_OPERATION_ERRORS_TOTAL = Counter(
    "uniffy_s3_operation_errors_total",
    "Total S3 operation errors",
    ["operation"],
)

S3_BYTES_TRANSFERRED = Counter(
    "uniffy_s3_bytes_transferred_total",
    "Total bytes transferred to/from S3",
    ["direction"],
)
