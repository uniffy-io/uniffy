"""Generic utilities for LLM provider credential management."""


def build_key_hint(credential: str) -> str:
    """Build a masked hint from a credential for safe display.

    Shows the first 12 characters and last 4 characters with "..." in between.

    Parameters
    ----------
    credential : str
        The full credential string.

    Returns
    -------
    str
        Masked hint (e.g. "sk-ant-oat01-...abcd").

    """
    credential = credential.strip()
    if len(credential) <= 16:
        return credential[:4] + "..." + credential[-4:]
    return credential[:12] + "..." + credential[-4:]
