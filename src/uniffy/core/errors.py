"""Shared exception classes used across all UNIFFY modules."""

from uuid import UUID


class UNIFFYError(Exception):
    """Base exception for all UNIFFY errors."""

    pass


class NotFoundError(UNIFFYError):
    """Requested resource does not exist."""

    def __init__(self, resource: str, resource_id: UUID | str) -> None:
        self.resource = resource
        self.resource_id = resource_id
        super().__init__(f"{resource} not found: {resource_id}")


class PermissionDeniedError(UNIFFYError):
    """User lacks permission for the requested action."""

    def __init__(self, action: str, resource: str | None = None) -> None:
        self.action = action
        self.resource = resource
        msg = f"Permission denied: {action}"
        if resource:
            msg += f" on {resource}"
        super().__init__(msg)


class ValidationError(UNIFFYError):
    """Input validation failed."""

    def __init__(self, field: str, message: str) -> None:
        self.field = field
        self.message = message
        super().__init__(f"Validation error on '{field}': {message}")


class ConflictError(UNIFFYError):
    """Operation conflicts with existing state (e.g. duplicate slug, concurrent edit)."""

    def __init__(self, resource: str, conflict: str) -> None:
        self.resource = resource
        self.conflict = conflict
        super().__init__(f"{resource} conflict: {conflict}")


class AuthenticationError(UNIFFYError):
    """Authentication failed (invalid credentials, expired token, etc.)."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(f"Authentication failed: {reason}")


class BudgetExceededError(UNIFFYError):
    """Raised only when a governing budget row has ``hard_limit=True`` and usage exceeds the cap.

    Soft overages log a warning and let the request proceed; this is the hard-enforcement path.
    """

    def __init__(
        self,
        scope: str,
        limit_kind: str,
        current: str,
        limit: str,
    ) -> None:
        self.scope = scope
        self.limit_kind = limit_kind
        self.current = current
        self.limit = limit
        super().__init__(f"Budget exceeded ({scope}/{limit_kind}): {current} >= {limit}")


class RuntimeDeadlineExceededError(UNIFFYError):
    """Agent message call ran longer than the per-org deadline.

    Maps to ConnectRPC ``Code.DEADLINE_EXCEEDED``.
    """

    def __init__(self, deadline_seconds: int, elapsed_seconds: float) -> None:
        self.deadline_seconds = deadline_seconds
        self.elapsed_seconds = elapsed_seconds
        super().__init__(f"Runtime deadline exceeded: {elapsed_seconds:.1f}s >= {deadline_seconds}s")


class RateLimitExceededError(UNIFFYError):
    """User exceeded the allowed request rate for a resource."""

    def __init__(
        self,
        resource: str,
        limit: int,
        window_seconds: int,
        retry_after: int = 0,
    ) -> None:
        self.resource = resource
        self.limit = limit
        self.window_seconds = window_seconds
        self.retry_after = retry_after
        super().__init__(
            f"Rate limit exceeded for {resource}: max {limit} requests per {window_seconds}s"
        )
