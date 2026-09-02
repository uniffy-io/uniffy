from prometheus_client import Counter

WORKER_JOB_ENQUEUE_TOTAL = Counter(
    "uniffy_worker_job_enqueue_total",
    "Typed worker job dispatch calls partitioned by outcome",
    ["queue", "job_name", "outcome"],
)
