"""Custom-field value validation against field definitions."""

import re
from typing import Any
from uuid import UUID

from uniffy.core.models.projects.field_definition import FieldDefinition, ProjectFieldType


def validate_field_values(
    field_values: dict[str, Any],
    field_definitions: list[FieldDefinition],
    task_type: str | None = None,
    type_field_schemas: dict[str, Any] | None = None,
) -> list[str]:
    """Return a list of error messages; empty when valid."""
    field_map = {f.id: f for f in field_definitions}

    errors: list[str] = []

    if field_values:
        for field_id, value in field_values.items():
            field_def = field_map.get(field_id)
            if not field_def:
                continue

            if value is None or value == "":
                continue

            error = _validate_single_field(field_def, value)
            if error:
                errors.append(f"Field '{field_def.name}': {error}")

    if task_type and type_field_schemas:
        schema = type_field_schemas.get(task_type)
        if schema:
            required_ids = schema.get("required_field_ids", [])
            for req_id in required_ids:
                field_def = field_map.get(req_id)
                if not field_def:
                    continue
                value = field_values.get(req_id) if field_values else None
                if value is None or value == "" or value == []:
                    type_label = task_type.replace("_", " ").title()
                    errors.append(
                        f"Please fill in the '{field_def.name}' field. "
                        f"It is required for {type_label} tasks."
                    )

    return errors


def _validate_single_field(field_def: FieldDefinition, value: Any) -> str | None:
    field_type = field_def.type
    config = field_def.config or {}

    if field_type == ProjectFieldType.TEXT:
        if not isinstance(value, str):
            return "must be a text value"
        max_length = config.get("max_length", 1000)
        if len(value) > max_length:
            return f"exceeds maximum length of {max_length} characters"

    elif field_type == ProjectFieldType.NUMBER:
        if not isinstance(value, (int, float)):
            try:
                float(value)
            except ValueError, TypeError:
                return "must be a numeric value"

    elif field_type == ProjectFieldType.SINGLE_SELECT:
        options = option_ids(config)
        if options and str(value) not in options:
            labels = _get_option_labels(config)
            return f"must be one of: {', '.join(labels)}"

    elif field_type == ProjectFieldType.MULTI_SELECT:
        if not isinstance(value, list):
            return "must be a list of values"
        options = option_ids(config)
        if options:
            invalid = [str(v) for v in value if str(v) not in options]
            if invalid:
                labels = _get_option_labels(config)
                return f"contains invalid options. Valid options: {', '.join(labels)}"

    elif field_type == ProjectFieldType.DATE:
        if not isinstance(value, str):
            return "must be a date string (YYYY-MM-DD)"
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", value):
            return "must be in YYYY-MM-DD format"

    elif field_type == ProjectFieldType.PERSON:
        if isinstance(value, list):
            for v in value:
                if not _is_valid_uuid(str(v)):
                    return "contains invalid user ID"
        elif not _is_valid_uuid(str(value)):
            return "must be a valid user ID"

    elif field_type == ProjectFieldType.REFERENCE:
        if not isinstance(value, str) or not value.startswith("urn:uniffy:"):
            return "must be a valid URN reference"

    return None


def option_ids(config: dict) -> set[str]:
    options = config.get("options", [])
    return {str(opt.get("id", opt.get("label", ""))) for opt in options if isinstance(opt, dict)}


def _get_option_labels(config: dict) -> list[str]:
    options = config.get("options", [])
    return [opt.get("label", opt.get("id", "")) for opt in options if isinstance(opt, dict)]


def _is_valid_uuid(value: str) -> bool:
    try:
        UUID(value)
        return True
    except ValueError:
        return False
