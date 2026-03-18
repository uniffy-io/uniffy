"""
Projects field validation.

Validates custom field values against their field definitions.
"""

import re
from typing import Any
from uuid import UUID

from uniffy.core.models.projects.field_definition import FieldDefinition


def validate_field_values(
    field_values: dict[str, Any],
    field_definitions: list[FieldDefinition],
) -> list[str]:
    """
    Validate field values against their definitions.

    Parameters
    ----------
    field_values : dict[str, Any]
        Field ID to value mapping.
    field_definitions : list[FieldDefinition]
        Field definitions for the project.

    Returns
    -------
    list[str]
        List of error messages. Empty list means all valid.

    """
    if not field_values:
        return []

    # Build lookup by field ID
    field_map = {f.id: f for f in field_definitions}

    errors: list[str] = []
    for field_id, value in field_values.items():
        field_def = field_map.get(field_id)
        if not field_def:
            # Unknown field IDs are silently ignored
            continue

        if value is None or value == "":
            continue

        error = _validate_single_field(field_def, value)
        if error:
            errors.append(f"Field '{field_def.name}': {error}")

    return errors


def _validate_single_field(field_def: FieldDefinition, value: Any) -> str | None:
    """
    Validate a single field value against its definition.

    Returns an error message string, or None if valid.
    """
    field_type = field_def.type
    config = field_def.config or {}

    if field_type == "text":
        if not isinstance(value, str):
            return "must be a text value"
        max_length = config.get("max_length", 1000)
        if len(value) > max_length:
            return f"exceeds maximum length of {max_length} characters"

    elif field_type == "number":
        if not isinstance(value, (int, float)):
            try:
                float(value)
            except (ValueError, TypeError):
                return "must be a numeric value"

    elif field_type == "single_select":
        options = _get_option_ids(config)
        if options and str(value) not in options:
            labels = _get_option_labels(config)
            return f"must be one of: {', '.join(labels)}"

    elif field_type == "multi_select":
        if not isinstance(value, list):
            return "must be a list of values"
        options = _get_option_ids(config)
        if options:
            invalid = [str(v) for v in value if str(v) not in options]
            if invalid:
                labels = _get_option_labels(config)
                return f"contains invalid options. Valid options: {', '.join(labels)}"

    elif field_type == "date":
        if not isinstance(value, str):
            return "must be a date string (YYYY-MM-DD)"
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", value):
            return "must be in YYYY-MM-DD format"

    elif field_type == "person":
        if isinstance(value, list):
            for v in value:
                if not _is_valid_uuid(str(v)):
                    return "contains invalid user ID"
        elif not _is_valid_uuid(str(value)):
            return "must be a valid user ID"

    elif field_type == "reference":
        if not isinstance(value, str) or not value.startswith("urn:uniffy:"):
            return "must be a valid URN reference"

    return None


def _get_option_ids(config: dict) -> set[str]:
    """Extract option IDs from field config."""
    options = config.get("options", [])
    return {str(opt.get("id", opt.get("label", ""))) for opt in options if isinstance(opt, dict)}


def _get_option_labels(config: dict) -> list[str]:
    """Extract option labels from field config."""
    options = config.get("options", [])
    return [opt.get("label", opt.get("id", "")) for opt in options if isinstance(opt, dict)]


def _is_valid_uuid(value: str) -> bool:
    """Check if a string is a valid UUID."""
    try:
        UUID(value)
        return True
    except ValueError:
        return False
