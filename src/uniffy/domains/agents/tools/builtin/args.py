"""Shared argument guidance and parsing for built-in tools."""

from __future__ import annotations

from uuid import UUID

from uniffy.core.data_files import DATA_DIR
from uniffy.domains.agents.runtime.output import prepare_model_markdown
from uniffy.domains.agents.runtime.output_format import OutputSurface
from uniffy.domains.agents.tools.definitions import ToolContext

MARKDOWN_CONTENT_DOC = (
    (DATA_DIR / "prompts" / "markdown-content.md").read_text(encoding="utf-8").strip()
)

# Bound model-supplied pages to avoid deep OFFSET scans.
MAX_PAGE = 200


def markdown_body(ctx: ToolContext, value: str | None, surface: OutputSurface) -> str | None:
    if value is None:
        return None
    return prepare_model_markdown(
        value, surface=surface, provider=ctx.output_provider, model=ctx.output_model
    )


def clamp_int(value: object, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except TypeError, ValueError:
        return default
    return max(minimum, min(parsed, maximum))


def clamp_page(value: object) -> int:
    """Page numbers are capped: deep paging is a search query, not an offset."""
    return clamp_int(value, 1, 1, MAX_PAGE)


def parse_uuid(value: str, field_name: str) -> tuple[UUID | None, str | None]:
    try:
        return UUID(value), None
    except ValueError:
        return None, f"Invalid {field_name}: {value}"


def parse_uuid_list(
    values: list,
    field_name: str,
) -> tuple[list[UUID] | None, str | None]:
    uuids: list[UUID] = []
    for v in values:
        parsed, err = parse_uuid(str(v), field_name)
        if err:
            return None, err
        uuids.append(parsed)  # type: ignore[arg-type]
    return uuids, None
