"""Credential format validation for the OpenAI provider."""

from uniffy.core.errors import ValidationError

# OpenAI API key prefix
OPENAI_API_KEY_PREFIX = "sk-"

# Minimum credential length
OPENAI_MIN_CREDENTIAL_LENGTH = 20


def validate_openai_credential(credential: str, credential_type: str) -> None:
    """Validate an OpenAI credential format.

    For API keys, checks for the ``sk-`` prefix and minimum length.
    The actual validity is confirmed by calling the OpenAI API.

    Parameters
    ----------
    credential : str
        The raw credential string.
    credential_type : str
        Must be "api_key" for OpenAI.

    Raises
    ------
    ValidationError
        If the credential format is invalid.

    """
    if not credential or not credential.strip():
        raise ValidationError("credential", "Credential cannot be empty")

    credential = credential.strip()

    if credential_type == "api_key":
        if not credential.startswith(OPENAI_API_KEY_PREFIX):
            raise ValidationError(
                "credential",
                f"API key must start with '{OPENAI_API_KEY_PREFIX}'",
            )
        if len(credential) < OPENAI_MIN_CREDENTIAL_LENGTH:
            raise ValidationError(
                "credential",
                f"API key must be at least {OPENAI_MIN_CREDENTIAL_LENGTH} characters",
            )
    else:
        raise ValidationError(
            "credential_type",
            f"OpenAI only supports 'api_key' credential type, got: {credential_type}",
        )
