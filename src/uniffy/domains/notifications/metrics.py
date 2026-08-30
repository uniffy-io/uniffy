from prometheus_client import Counter

NOTIFICATION_EVENTS_TOTAL = Counter(
    "uniffy_notification_events_total",
    "Total notification events processed",
    ["status"],
)

NOTIFICATION_DELIVERIES_TOTAL = Counter(
    "uniffy_notification_deliveries_total",
    "Total notification deliveries by channel",
    ["channel"],
)

NOTIFICATION_RECIPIENTS_DROPPED_TOTAL = Counter(
    "uniffy_notification_recipients_dropped_total",
    "Recipients dropped before delivery for lacking view access on the content",
)
