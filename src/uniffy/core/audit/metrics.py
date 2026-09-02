from prometheus_client import Histogram

AUDIT_ROLE_LOOKUP_SECONDS = Histogram(
    "uniffy_audit_role_lookup_duration_seconds",
    "Duration of the audit writer's organization-member role lookup",
    buckets=(0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0),
)
