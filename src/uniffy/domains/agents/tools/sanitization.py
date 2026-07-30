"""Safe error-message construction for tool results returned to the LLM.

Maps typed domain exceptions to concise user-facing strings and scrubs
any other exception for SQL fragments, file paths, driver names, or
tracebacks before it is handed back to the model. The LLM never sees a
raw Python exception message.
"""

import re

from loguru import logger

from uniffy.core.errors import (
    BudgetExceededError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitExceededError,
    ValidationError,
)

logger = logger.bind(component="agents.tools.sanitization")

_SENSITIVE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN)\s", re.IGNORECASE),
    re.compile(r"psycopg|asyncpg|sqlalchemy", re.IGNORECASE),
    re.compile(r"(?:/home/|/usr/|/var/|/tmp/|/etc/|/opt/)[^\s]+"),
    re.compile(r'File "[^"]+", line \d+'),
    re.compile(r"Traceback \(most recent call last\)"),
    re.compile(r"(?:postgresql|valkey|mysql|mongodb)://", re.IGNORECASE),
]


def sanitize_tool_error(tool_name: str, exc: Exception) -> str:
    """Map a failed tool call's exception to a string safe to show the LLM.

    Typed domain exceptions are safe and keep a short prefix; anything else
    is scanned for sensitive fragments and genericized on a match.
    """
    if isinstance(exc, NotFoundError):
        return f"Not found: {exc}"
    if isinstance(exc, PermissionDeniedError):
        return f"Permission denied: {exc}"
    if isinstance(exc, ValidationError):
        return f"Validation error: {exc}"
    if isinstance(exc, RateLimitExceededError):
        return f"Rate limited: {exc} (retry after {exc.retry_after}s)"
    if isinstance(exc, BudgetExceededError):
        return (
            f"Quota exceeded ({exc.scope}/{exc.limit_kind}): "
            f"{exc.current} of {exc.limit} used this period"
        )

    raw = str(exc)
    for pattern in _SENSITIVE_PATTERNS:
        if pattern.search(raw):
            logger.warning(
                "Sanitized sensitive error for LLM",
                tool=tool_name,
                original_error=raw,
            )
            return (
                f"Internal error executing {tool_name}. "
                "The operation could not be completed."
            )
    return f"Internal error executing {tool_name}: {raw}"
