"""Credential format validation for the Google AI provider."""

from uniffy.core.errors import ValidationError

# Google AI API keys typically start with "AIza"
GOOGLE_API_KEY_PREFIX = "AIza"

# Minimum credential length
GOOGLE_MIN_CREDENTIAL_LENGTH = 20


def validate_google_credential(credential: str, credential_type: str) -> None:
    """Validate a Google AI credential format.

    For API keys, checks for the ``AIza`` prefix and minimum length.
    The actual validity is confirmed by calling the Google AI API.

    Parameters
    ----------
    credential : str
        The raw credential string.
    credential_type : str
        Must be "api_key" for Google.

    Raises
    ------
    ValidationError
        If the credential format is invalid.

    """
    if not credential or not credential.strip():
        raise ValidationError("credential", "Credential cannot be empty")

    credential = credential.strip()

    if credential_type == "api_key":
        if not credential.startswith(GOOGLE_API_KEY_PREFIX):
            raise ValidationError(
                "credential",
                f"API key must start with '{GOOGLE_API_KEY_PREFIX}'",
            )
        if len(credential) < GOOGLE_MIN_CREDENTIAL_LENGTH:
            raise ValidationError(
                "credential",
                f"API key must be at least {GOOGLE_MIN_CREDENTIAL_LENGTH} characters",
            )
    else:
        raise ValidationError(
            "credential_type",
            f"Google only supports 'api_key' credential type, got: {credential_type}",
        )
