"""Generic utilities for LLM provider credential management."""

_LONG_CREDENTIAL_LENGTH = 16
_MIN_TAIL_LENGTH = 8


def build_key_hint(credential: str) -> str:
    """Mask a credential for display; only a long one may reveal its provider prefix."""
    credential = credential.strip()
    if len(credential) > _LONG_CREDENTIAL_LENGTH:
        return credential[:12] + "..." + credential[-4:]
    if len(credential) > _MIN_TAIL_LENGTH:
        return "..." + credential[-4:]
    return "..."
