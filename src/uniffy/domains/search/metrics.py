from enum import StrEnum

from prometheus_client import Counter


class SearchAuthorizationOutcome(StrEnum):
    ALLOWED = "allowed"
    DENIED = "denied"
    UNRESOLVED = "unresolved"


SEARCH_AUTHORIZATION_TOTAL = Counter(
    "uniffy_search_authorization_total",
    "Search candidates classified by the PostgreSQL authorization gate",
    ["outcome"],
)
