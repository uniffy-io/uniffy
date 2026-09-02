"""Domain errors specific to support sessions."""

from uniffy.core.errors import ValidationError


class SupportSessionTransitionError(ValidationError):
    """Raised when a state transition is invalid (e.g. approve EXPIRED)."""

    def __init__(self, current: str, attempted: str) -> None:
        super().__init__(
            "state",
            f"Cannot {attempted} a session in state {current}",
        )


class SupportSessionScopeError(ValidationError):
    """Raised when an unsupported scope is requested (e.g. READ_WRITE in v1)."""

    def __init__(self, scope: str) -> None:
        super().__init__(
            "scope",
            f"Scope {scope} is not supported in v1; only READ_ONLY is available",
        )
