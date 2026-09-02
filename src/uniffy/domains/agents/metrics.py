from prometheus_client import Counter, Gauge, Histogram

APPROVAL_STORE_PENDING_SIZE = Gauge(
    "uniffy_approval_store_pending_size",
    "In-process pending approvals awaiting user decision",
    multiprocess_mode="livesum",
)

APPROVAL_STORE_VALKEY_UNREACHABLE_TOTAL = Counter(
    "uniffy_approval_store_valkey_unreachable_total",
    "Approval-store Valkey operations that failed and were swallowed",
    ["op"],
)

AGENT_RUN_QUEUE_LAG = Histogram(
    "uniffy_agent_run_queue_lag_seconds",
    "Time from agent run enqueue to worker pickup",
)

AGENT_RUN_DURATION = Histogram(
    "uniffy_agent_run_duration_seconds",
    "Agent run total duration from worker pickup to completion",
)

AGENT_RUN_ACTIVE = Gauge(
    "uniffy_agent_run_active",
    "Agent runs currently executing in the egress worker fleet",
    multiprocess_mode="livesum",
)

AGENT_RUN_ENQUEUE_FAILURES_TOTAL = Counter(
    "uniffy_agent_run_enqueue_failures_total",
    "Agent run enqueue failures",
)

AGENT_RUN_SUBSCRIBE_TIMEOUT_TOTAL = Counter(
    "uniffy_agent_run_subscribe_timeout_total",
    "Agent run subscription loops that exhausted their wall-time budget",
)

AGENT_RUN_RECONNECT_TOTAL = Counter(
    "uniffy_agent_run_reconnect_total",
    "Agent run subscriptions that resumed an in-flight run",
)

AGENT_MODEL_PARAM_DROPPED_TOTAL = Counter(
    "uniffy_agent_model_param_dropped_total",
    "Tuned model parameters stripped because the target model rejects them",
    ["provider", "param"],
)

AGENT_IMAGE_PARAM_DROPPED_TOTAL = Counter(
    "uniffy_agent_image_param_dropped_total",
    "Image parameters stripped because the target image model rejects them",
    ["provider", "param"],
)

AGENT_MEMORY_RECALL_RUNS_TOTAL = Counter(
    "uniffy_agent_memory_recall_runs_total",
    "Query-conditioned memory recall attempts by outcome and query script",
    ["outcome", "script"],
)

AGENT_MEMORY_RECALL_PROMOTED_TOTAL = Counter(
    "uniffy_agent_memory_recall_promoted_total",
    "Memory entries promoted to full content on the trigger turn",
    ["script"],
)

AGENT_MEMORY_RECALL_OVERFLOW_TOTAL = Counter(
    "uniffy_agent_memory_recall_overflow_total",
    "Memory entries above threshold that exceeded promotion caps",
    ["script"],
)

AGENT_MEMORY_RECALL_SECONDS = Histogram(
    "uniffy_agent_memory_recall_seconds",
    "Memory recall scoring query duration",
)

AGENT_MEMORY_READ_AFTER_NO_RECALL_TOTAL = Counter(
    "uniffy_agent_memory_read_after_no_recall_total",
    "Memory reads in runs where query-conditioned recall promoted nothing",
    ["script"],
)

AGENT_TOOL_CALLS_TOTAL = Counter(
    "uniffy_agent_tool_calls_total",
    "Agent tool executions by outcome",
    ["tool", "status"],
)

AGENT_TOOL_DURATION = Histogram(
    "uniffy_agent_tool_duration_seconds",
    "Agent tool execution duration",
    ["tool"],
)

LLM_PROVIDER_LRU_HIT_TOTAL = Counter(
    "uniffy_llm_provider_lru_hit_total",
    "In-process LLM provider client cache hits",
)

LLM_PROVIDER_LRU_MISS_TOTAL = Counter(
    "uniffy_llm_provider_lru_miss_total",
    "In-process LLM provider client cache misses",
)
