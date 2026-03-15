"""Credential format validation for the Anthropic provider."""

from uniffy.core.errors import ValidationError

# Anthropic credential prefixes (known formats, not exhaustive)
ANTHROPIC_API_KEY_PREFIXES = ("sk-ant-api03-",)

# Minimum credential lengths
ANTHROPIC_MIN_CREDENTIAL_LENGTH = 20


def validate_anthropic_credential(credential: str, credential_type: str) -> None:
    """Validate an Anthropic credential format.

    For API keys, we check for known prefixes. For setup tokens, we only
    check minimum length since Anthropic may issue tokens in varying formats.
    The actual validity is confirmed by calling the Anthropic API.

    Parameters
    ----------
    credential : str
        The raw credential string.
    credential_type : str
        Either "api_key" or "setup_token".

    Raises
    ------
    ValidationError
        If the credential format is invalid.

    """
    if not credential or not credential.strip():
        raise ValidationError("credential", "Credential cannot be empty")

    credential = credential.strip()

    if credential_type == "setup_token":
        if len(credential) < ANTHROPIC_MIN_CREDENTIAL_LENGTH:
            raise ValidationError(
                "credential",
                f"Setup token must be at least {ANTHROPIC_MIN_CREDENTIAL_LENGTH} characters",
            )
    elif credential_type == "api_key":
        if not any(credential.startswith(p) for p in ANTHROPIC_API_KEY_PREFIXES):
            raise ValidationError(
                "credential",
                f"API key must start with one of: {', '.join(ANTHROPIC_API_KEY_PREFIXES)}",
            )
        if len(credential) < ANTHROPIC_MIN_CREDENTIAL_LENGTH:
            raise ValidationError(
                "credential",
                f"API key must be at least {ANTHROPIC_MIN_CREDENTIAL_LENGTH} characters",
            )
    else:
        raise ValidationError("credential_type", f"Unknown credential type: {credential_type}")
