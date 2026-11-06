"""Search-input hygiene for memory lookups."""


def escape_like(text: str) -> str:
    """Escape LIKE metacharacters so a query of ``%`` cannot match everything."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
