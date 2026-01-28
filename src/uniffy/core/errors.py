"""
Custom exceptions for UNIFFY.

Provides consistent error handling across all modules with
structured error information for API responses.
"""

from uuid import UUID


class UNIFFYError(Exception):
    """
    Base exception for all UNIFFY errors.

    All custom exceptions should inherit from this class.
    """

    pass


class NotFoundError(UNIFFYError):
    """
    Resource not found exception.

    Raised when a requested resource does not exist.

    Attributes
    ----------
    resource : str
        Type of resource that was not found.
    resource_id : UUID | str
        ID of the resource that was not found.

    """

    def __init__(self, resource: str, resource_id: UUID | str) -> None:
        """
        Initialize NotFoundError.

        Parameters
        ----------
        resource : str
            Type of resource (e.g., "note", "user").
        resource_id : UUID | str
            ID of the resource.

        """
        self.resource = resource
        self.resource_id = resource_id
        super().__init__(f"{resource} not found: {resource_id}")


class PermissionDeniedError(UNIFFYError):
    """
    Permission denied exception.

    Raised when a user lacks permission for a requested action.

    Attributes
    ----------
    action : str
        The action that was denied (e.g., "edit", "delete").
    resource : str | None
        Optional resource type the action was attempted on.

    """

    def __init__(self, action: str, resource: str | None = None) -> None:
        """
        Initialize PermissionDeniedError.

        Parameters
        ----------
        action : str
            The action that was denied.
        resource : str | None
            Optional resource type.

        """
        self.action = action
        self.resource = resource
        msg = f"Permission denied: {action}"
        if resource:
            msg += f" on {resource}"
        super().__init__(msg)


class ValidationError(UNIFFYError):
    """
    Validation error exception.

    Raised when input validation fails.

    Attributes
    ----------
    field : str
        The field that failed validation.
    message : str
        Description of the validation failure.

    """

    def __init__(self, field: str, message: str) -> None:
        """
        Initialize ValidationError.

        Parameters
        ----------
        field : str
            The field that failed validation.
        message : str
            Description of the validation failure.

        """
        self.field = field
        self.message = message
        super().__init__(f"Validation error on '{field}': {message}")


class ConflictError(UNIFFYError):
    """
    Resource conflict exception.

    Raised when an operation conflicts with existing state
    (e.g., duplicate slug, concurrent edit).

    Attributes
    ----------
    resource : str
        Type of resource with conflict.
    conflict : str
        Description of the conflict.

    """

    def __init__(self, resource: str, conflict: str) -> None:
        """
        Initialize ConflictError.

        Parameters
        ----------
        resource : str
            Type of resource with conflict.
        conflict : str
            Description of the conflict.

        """
        self.resource = resource
        self.conflict = conflict
        super().__init__(f"{resource} conflict: {conflict}")


class AuthenticationError(UNIFFYError):
    """
    Authentication error exception.

    Raised when authentication fails (invalid credentials, expired token, etc.).

    Attributes
    ----------
    reason : str
        Reason for authentication failure.

    """

    def __init__(self, reason: str) -> None:
        """
        Initialize AuthenticationError.

        Parameters
        ----------
        reason : str
            Reason for authentication failure.

        """
        self.reason = reason
        super().__init__(f"Authentication failed: {reason}")
