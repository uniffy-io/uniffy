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


class RenameSkip(StrEnum):
    # One candidate's live edits could not be verified, so it keeps the old label.
    DOCUMENT = "document"
    # The buffer could not be scanned, so documents only it lists were not candidates.
    BUFFER_SCAN = "buffer_scan"


MENTION_RENAME_SKIPPED_TOTAL = Counter(
    "uniffy_mention_rename_skipped_total",
    "Mention label renames that left documents out because live edits could not be verified",
    ["reason"],
)
