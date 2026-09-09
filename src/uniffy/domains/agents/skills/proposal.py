"""One bounded provider response becomes an inert proposal for builder review."""

import re

from uniffy.core.data_files import DATA_DIR
from uniffy.core.errors import ValidationError
from uniffy.core.json_codec import JSONDecodeError, loads
from uniffy.domains.agents.skills.validation import (
    CleanSkillFields,
    clean_skill_write,
    has_hard_injection,
    sanitize_skill_text,
)

GENERATION_PROMPT = (DATA_DIR / "prompts" / "skill-draft.md").read_text(encoding="utf-8")
MAX_PROPOSAL_CHARACTERS = 50000


def parse_proposal(content: str) -> CleanSkillFields:
    if len(content) > MAX_PROPOSAL_CHARACTERS:
        raise ValidationError("proposal", "The generated draft is too large")
    try:
        value = loads(content)
    except JSONDecodeError as exc:
        raise ValidationError("proposal", "The provider returned an invalid draft") from exc
    fields = ("name", "display_name", "description", "content")
    if not isinstance(value, dict) or set(value) != set(fields):
        raise ValidationError("proposal", "The provider must return one complete skill draft")
    if any(not isinstance(value[field], str) for field in fields):
        raise ValidationError("proposal", "Generated draft fields must be text")
    value = {field: sanitize_skill_text(value[field]) for field in fields}
    if has_hard_injection(*value.values()):
        raise ValidationError("proposal", "The draft contains a disallowed instruction delimiter")
    if re.fullmatch(r"[a-z0-9][a-z0-9-]{0,99}", value["name"]) is None:
        raise ValidationError("proposal", "The generated skill needs a lowercase hyphenated name")
    if not value["content"].strip():
        raise ValidationError("proposal", "The generated draft has no instructions")
    return clean_skill_write(**{field: value[field] for field in fields})
