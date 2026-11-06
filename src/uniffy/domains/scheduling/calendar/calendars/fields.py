"""Limits and cleaning for the fields a member types into a calendar."""

from uniffy.core.errors import ValidationError

NAME_LIMIT = 200
COLOR_LIMIT = 50
DESCRIPTION_LIMIT = 2000


def validated_name(name: str) -> str:
    cleaned = name.strip()
    if not cleaned:
        raise ValidationError("name", "A calendar needs a name.")
    if len(cleaned) > NAME_LIMIT:
        raise ValidationError("name", f"Calendar names are limited to {NAME_LIMIT} characters.")
    return cleaned


def validated_color(color: str) -> str:
    cleaned = color.strip()
    if not cleaned or len(cleaned) > COLOR_LIMIT:
        raise ValidationError("color", "Choose a calendar colour.")
    return cleaned


def validated_description(description: str) -> str:
    if len(description) > DESCRIPTION_LIMIT:
        raise ValidationError(
            "description", f"Descriptions are limited to {DESCRIPTION_LIMIT} characters."
        )
    return description
