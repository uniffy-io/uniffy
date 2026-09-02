from prometheus_client import Counter

REALTIME_BLANK_CONTENT_OVERWRITES_TOTAL = Counter(
    "uniffy_realtime_blank_content_overwrites_total",
    "Realtime saves that replaced non-empty content with an empty render",
    ["content_type"],
)
