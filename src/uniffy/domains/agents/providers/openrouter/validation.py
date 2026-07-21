"""Credential format validation for the OpenRouter provider."""

from uniffy.core.errors import ValidationError

OPENROUTER_API_KEY_PREFIX = "sk-or-"

OPENROUTER_MIN_CREDENTIAL_LENGTH = 20


def validate_openrouter_credential(credential: str, credential_type: str) -> None:
    """Check prefix and length only; actual validity is confirmed against the API."""
    if not credential or not credential.strip():
        raise ValidationError("credential", "Credential cannot be empty")

    credential = credential.strip()

    if credential_type == "api_key":
        if not credential.startswith(OPENROUTER_API_KEY_PREFIX):
            raise ValidationError(
                "credential",
                f"API key must start with '{OPENROUTER_API_KEY_PREFIX}'",
            )
        if len(credential) < OPENROUTER_MIN_CREDENTIAL_LENGTH:
            raise ValidationError(
                "credential",
                f"API key must be at least {OPENROUTER_MIN_CREDENTIAL_LENGTH} characters",
            )
    else:
        raise ValidationError(
            "credential_type",
            f"OpenRouter only supports 'api_key' credential type, got: {credential_type}",
        )
