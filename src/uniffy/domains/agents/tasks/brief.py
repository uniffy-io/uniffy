"""The task an agent was assigned, rendered as delimited data on the run's trigger turn."""

import re
import secrets
from dataclasses import dataclass

from uniffy.core.data_files import DATA_DIR

MAX_DESCRIPTION_CHARS = 8000
MAX_PROJECT_DESCRIPTION_CHARS = 2000
MAX_FIELD_CHARS = 500
_TRUNCATED = " ... [truncated; read the rest with tasks.read_task]"


def _prompt(name: str) -> str:
    return (DATA_DIR / "prompts" / f"task-run-{name}.md").read_text(encoding="utf-8").strip()


TASK_CONFIRMATION_UNAVAILABLE = _prompt("confirmation-unavailable")
_PREAMBLE = _prompt("preamble")
_WORKING_NOTES = _prompt("working-notes")
_HANDBACK_REVIEW = _prompt("handback-review")
_HANDBACK_SUMMARY = _prompt("handback-summary")
_FOLLOW_UP = _prompt("follow-up")

# Spacing variants ("< /task-brief-x>") must not survive as a lookalike closing tag.
_DELIMITER_RE = re.compile(r"<\s*/?\s*task-brief[-\w]*\s*>?", re.IGNORECASE)


@dataclass(frozen=True)
class TaskBrief:
    task_id: str
    key: str
    title: str
    status: str
    priority: str
    due_date: str | None
    description: str
    project_id: str
    project_name: str
    project_description: str
    assigned_by_name: str
    review_status: str | None
    # A run that continues an earlier one with the assigner's requested changes.
    follow_up: bool = False


def _clean(text: str, limit: int) -> str:
    """Workspace text cannot close or fake the brief block."""
    cleaned = _DELIMITER_RE.sub("", text or "").strip()
    if len(cleaned) > limit:
        return cleaned[:limit] + _TRUNCATED
    return cleaned


def render_task_brief(brief: TaskBrief) -> str:
    tag = f"task-brief-{secrets.token_hex(4)}"
    lines = [
        f"<{tag}>",
        _PREAMBLE.format(assigner=_clean(brief.assigned_by_name, MAX_FIELD_CHARS)),
        f"Task: {_clean(brief.key, MAX_FIELD_CHARS)} {_clean(brief.title, MAX_FIELD_CHARS)}",
        f"Task id: {brief.task_id}",
        f"Status: {_clean(brief.status, MAX_FIELD_CHARS)}",
        f"Priority: {_clean(brief.priority, MAX_FIELD_CHARS)}",
    ]
    if brief.due_date:
        lines.append(f"Due: {_clean(brief.due_date, MAX_FIELD_CHARS)}")
    lines.append(f"Project: {_clean(brief.project_name, MAX_FIELD_CHARS)} (id {brief.project_id})")
    project_description = _clean(brief.project_description, MAX_PROJECT_DESCRIPTION_CHARS)
    if project_description:
        lines += ["Project description:", project_description]
    description = _clean(brief.description, MAX_DESCRIPTION_CHARS)
    lines += ["Task description:", description or "(empty)"]
    lines.append(f"</{tag}>")
    lines.append(_working_notes(brief))
    if brief.follow_up:
        lines.append(_FOLLOW_UP.format(assigner=_clean(brief.assigned_by_name, MAX_FIELD_CHARS)))
    return "\n".join(lines)


def _working_notes(brief: TaskBrief) -> str:
    handback = (
        _HANDBACK_REVIEW.format(review_status=_clean(brief.review_status, MAX_FIELD_CHARS))
        if brief.review_status
        else _HANDBACK_SUMMARY
    )
    return _WORKING_NOTES.format(handback=handback)
