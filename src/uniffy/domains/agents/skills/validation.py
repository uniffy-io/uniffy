"""Length caps, sanitization, and injection guards for skill writes.

Skill fields land verbatim in the agent system prompt, so every write is
length-capped (a runaway proposal must not blow the prompt budget), control
characters are stripped, and hard delimiter-injection markers are rejected.
``[[[label|urn]]]`` mentions survive both sanitization and capping. Softer
natural-language injection phrases stay warn-only in ``content_policy`` because
they show up in legitimate instructions.
"""

import re
from dataclasses import dataclass

from uniffy.core.errors import ValidationError

SKILL_NAME_MAX = 100
SKILL_DISPLAY_NAME_MAX = 255
SKILL_DESCRIPTION_MAX = 1000
SKILL_WHEN_TO_USE_MAX = 1000
SKILL_CONTENT_MAX = 20000
SKILL_RATIONALE_MAX = 2000

# Stripped on the way in; newline and tab survive so markdown formatting holds.
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_MENTION = re.compile(r"\[\[\[[^\[\]|]*?\|urn:[^\]]*?\]\]\]")
# Structural delimiters that would break out of a prompt section; never valid
# inside skill markdown, so their presence is treated as an injection attempt.
_HARD_INJECTION = re.compile(
    r"</(?:system|instructions|prompt)>|<<SYS>>|```system|^\s*\[SYSTEM\]",
    re.IGNORECASE | re.MULTILINE,
)


@dataclass
class CleanSkillFields:
    name: str
    display_name: str
    description: str
    content: str
    when_to_use: str


def sanitize_skill_text(text: str) -> str:
    """Drop control chars and trailing whitespace; keep mentions and markdown."""
    if not text:
        return ""
    cleaned = text.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = _CONTROL_CHARS.sub("", cleaned)
    lines = [line.rstrip() for line in cleaned.split("\n")]
    return "\n".join(lines).strip()


def cap_preserving_mentions(text: str, cap: int) -> str:
    """Truncate to ``cap`` chars without slicing through a ``[[[...]]]`` mention."""
    if len(text) <= cap:
        return text
    cut = cap
    for match in _MENTION.finditer(text):
        if match.start() < cap < match.end():
            cut = match.start()
            break
    return text[:cut].rstrip()


def has_hard_injection(*texts: str) -> bool:
    """True when any field carries a structural delimiter-injection marker."""
    return any(t and _HARD_INJECTION.search(t) is not None for t in texts)


def _require_max(field: str, value: str, cap: int) -> None:
    if len(value) > cap:
        raise ValidationError(field, f"exceeds the {cap}-character limit")


def clean_skill_write(
    *,
    name: str,
    display_name: str,
    description: str = "",
    content: str = "",
    when_to_use: str = "",
) -> CleanSkillFields:
    """Validate and sanitize the fields that become a skill row.

    Raises ``ValidationError`` on empty identity, an over-length field, or a
    hard delimiter-injection marker in any injected field.
    """
    clean_name = (name or "").strip()
    clean_display = (display_name or "").strip()
    if not clean_name:
        raise ValidationError("name", "Skill name cannot be empty")
    if not clean_display:
        raise ValidationError("display_name", "Skill display name cannot be empty")
    _require_max("name", clean_name, SKILL_NAME_MAX)
    _require_max("display_name", clean_display, SKILL_DISPLAY_NAME_MAX)

    clean_desc = sanitize_skill_text(description)
    clean_when = sanitize_skill_text(when_to_use)
    clean_content = sanitize_skill_text(content)
    _require_max("description", clean_desc, SKILL_DESCRIPTION_MAX)
    _require_max("when_to_use", clean_when, SKILL_WHEN_TO_USE_MAX)
    _require_max("content", clean_content, SKILL_CONTENT_MAX)

    if has_hard_injection(clean_content, clean_when, clean_desc):
        raise ValidationError(
            "content", "Skill content contains a disallowed system-prompt delimiter"
        )
    return CleanSkillFields(
        name=clean_name,
        display_name=clean_display,
        description=clean_desc,
        content=clean_content,
        when_to_use=clean_when,
    )


@dataclass
class CleanSkillUpdate:
    """Cleaned partial-update fields; ``None`` marks a field the caller left alone."""

    name: str | None = None
    display_name: str | None = None
    description: str | None = None
    content: str | None = None
    when_to_use: str | None = None


def clean_skill_update(
    *,
    name: str | None = None,
    display_name: str | None = None,
    description: str | None = None,
    content: str | None = None,
    when_to_use: str | None = None,
) -> CleanSkillUpdate:
    """Clean only the fields a partial update supplies (``None`` = untouched).

    Applies the same caps, control-char stripping, and hard delimiter-injection
    rejection as ``clean_skill_write`` so a partial update cannot slip content
    past the guards a full write enforces.
    """
    out = CleanSkillUpdate()
    injected: list[str] = []
    if name is not None:
        clean_name = name.strip()
        if not clean_name:
            raise ValidationError("name", "Skill name cannot be empty")
        _require_max("name", clean_name, SKILL_NAME_MAX)
        out.name = clean_name
    if display_name is not None:
        clean_display = display_name.strip()
        if not clean_display:
            raise ValidationError("display_name", "Skill display name cannot be empty")
        _require_max("display_name", clean_display, SKILL_DISPLAY_NAME_MAX)
        out.display_name = clean_display
    if description is not None:
        clean_desc = sanitize_skill_text(description)
        _require_max("description", clean_desc, SKILL_DESCRIPTION_MAX)
        out.description = clean_desc
        injected.append(clean_desc)
    if content is not None:
        clean_content = sanitize_skill_text(content)
        _require_max("content", clean_content, SKILL_CONTENT_MAX)
        out.content = clean_content
        injected.append(clean_content)
    if when_to_use is not None:
        clean_when = sanitize_skill_text(when_to_use)
        _require_max("when_to_use", clean_when, SKILL_WHEN_TO_USE_MAX)
        out.when_to_use = clean_when
        injected.append(clean_when)
    if has_hard_injection(*injected):
        raise ValidationError(
            "content", "Skill content contains a disallowed system-prompt delimiter"
        )
    return out
