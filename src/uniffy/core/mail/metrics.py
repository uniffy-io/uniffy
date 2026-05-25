"""Prometheus metrics emitted by the mail subsystem."""

from prometheus_client import Counter, Histogram

MAIL_SENT_TOTAL = Counter(
    "uniffy_mail_sent_total",
    "Mail send attempts grouped by outcome.",
    ["template", "status", "config_source"],
)

MAIL_SUPPRESSED_TOTAL = Counter(
    "uniffy_mail_suppressed_total",
    "Sends short-circuited because the recipient was on the suppression list.",
    ["template"],
)

MAIL_RATE_LIMITED_TOTAL = Counter(
    "uniffy_mail_rate_limited_total",
    "Sends rejected by the per-scope rate limiter.",
    ["scope_kind"],
)

MAIL_SEND_DURATION_SECONDS = Histogram(
    "uniffy_mail_send_duration_seconds",
    "Time spent in MailSender.send from entry to backend completion.",
    ["template", "config_source"],
    buckets=(0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)
