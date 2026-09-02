"""Content policy validation for prompt injection detection.

Provides pattern-based scanning to detect common prompt injection
vectors in user messages, soul prompts, and skill content. Uses a
warn-and-flag approach - suspicious content is logged and flagged
but never blocked, since false positives would break legitimate usage.
"""

import re

from loguru import logger

logger = logger.bind(component="agents.policy")

_INJECTION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # System prompt override attempts
    (
        "override_instructions",
        re.compile(
            r"ignore\s+(?:all\s+)?(?:previous|prior|above)\s+"
            r"(?:instructions|prompts|rules)",
            re.IGNORECASE,
        ),
    ),
    (
        "override_instructions",
        re.compile(
            r"disregard\s+(?:your|all|the)\s+"
            r"(?:instructions|rules|guidelines)",
            re.IGNORECASE,
        ),
    ),
    (
        "override_instructions",
        re.compile(
            r"forget\s+(?:everything|your|all)\s+"
            r"(?:previous|you\s+were\s+told)",
            re.IGNORECASE,
        ),
    ),
    # Role injection (faking conversation turns at line start)
    (
        "role_injection",
        re.compile(
            r"^(?:system|assistant|human)\s*:",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    # Prompt leak requests
    (
        "prompt_leak",
        re.compile(
            r"repeat\s+(?:your|the)\s+(?:system|initial)\s+"
            r"(?:prompt|instructions)",
            re.IGNORECASE,
        ),
    ),
    (
        "prompt_leak",
        re.compile(
            r"show\s+me\s+your\s+(?:prompt|instructions|rules)",
            re.IGNORECASE,
        ),
    ),
    (
        "prompt_leak",
        re.compile(
            r"what\s+are\s+your\s+(?:instructions|rules|system\s+prompt)",
            re.IGNORECASE,
        ),
    ),
    # Delimiter injection (attempting to close system prompt sections)
    (
        "delimiter_injection",
        re.compile(
            r"</(?:system|instructions|prompt)>",
            re.IGNORECASE,
        ),
    ),
    (
        "delimiter_injection",
        re.compile(
            r"```system|^\[SYSTEM\]|<<SYS>>",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    # Identity override attempts
    (
        "identity_override",
        re.compile(
            r"you\s+are\s+now\b",
            re.IGNORECASE,
        ),
    ),
    (
        "identity_override",
        re.compile(
            r"act\s+as\s+if\s+you\b",
            re.IGNORECASE,
        ),
    ),
    (
        "identity_override",
        re.compile(
            r"pretend\s+you\s+are\b",
            re.IGNORECASE,
        ),
    ),
    (
        "identity_override",
        re.compile(
            r"your\s+new\s+(?:role|identity|name)\s+is\b",
            re.IGNORECASE,
        ),
    ),
]


def scan_text(text: str) -> list[str]:
    """Scan text for prompt injection patterns.

    Parameters
    ----------
    text : str
        The text to scan.

    Returns
    -------
    list[str]
        List of matched pattern category names (deduplicated).
        Empty if no patterns matched.

    """
    if not text:
        return []

    matched: list[str] = []
    seen: set[str] = set()
    for name, pattern in _INJECTION_PATTERNS:
        if name not in seen and pattern.search(text):
            matched.append(name)
            seen.add(name)
    return matched


def check_user_message(content: str) -> list[str]:
    """Scan a user message for prompt injection patterns.

    Logs a warning if patterns are detected but never blocks
    the message. Returns the list of matched pattern names
    for optional downstream use.

    Parameters
    ----------
    content : str
        The user message content.

    Returns
    -------
    list[str]
        Matched pattern category names, empty if clean.

    """
    flags = scan_text(content)
    if flags:
        logger.warning(
            "Potential prompt injection detected in user message",
            flags=flags,
        )
    return flags


def check_admin_content(content: str, content_type: str) -> list[str]:
    """Scan admin-authored content for prompt injection patterns.

    Used for soul_prompt and skill content validation at save time.
    Logs warnings but never blocks the save.

    Parameters
    ----------
    content : str
        The content to scan (soul_prompt or skill content).
    content_type : str
        Label for logging (e.g. "soul_prompt", "skill_content").

    Returns
    -------
    list[str]
        Matched pattern category names, empty if clean.

    """
    flags = scan_text(content)
    if flags:
        logger.warning(
            "Prompt injection patterns detected in admin content",
            content_type=content_type,
            flags=flags,
        )
    return flags
