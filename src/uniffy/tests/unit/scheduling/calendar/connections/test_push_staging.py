"""Every event mutation that commits also queues its change for two-way provider calendars."""

import ast
from pathlib import Path

import pytest

EVENTS = Path(__file__).resolve().parents[5] / "domains" / "scheduling" / "calendar" / "events"
MUTATION_FILES = (
    "creation.py",
    "updates.py",
    "deletion.py",
    "attendees.py",
    "recurrence/mutations.py",
)


def _calls(node: ast.AST) -> list[tuple[int, str]]:
    found = []
    for child in ast.walk(node):
        if isinstance(child, ast.Call):
            func = child.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
            found.append((child.lineno, name))
    return sorted(found)


def _functions(path: Path) -> list[ast.AsyncFunctionDef]:
    tree = ast.parse(path.read_text())
    return [node for node in ast.walk(tree) if isinstance(node, ast.AsyncFunctionDef)]


@pytest.mark.parametrize("filename", MUTATION_FILES)
def test_each_commit_is_preceded_by_push_staging(filename: str) -> None:
    for function in _functions(EVENTS / filename):
        calls = _calls(function)
        for line, name in calls:
            if name != "commit":
                continue
            staged = [
                stage for stage, other in calls if other == "stage_provider_push" and stage < line
            ]
            assert staged, f"{filename}:{line} commits in {function.name} without staging a push"


def test_the_guard_sees_every_known_commit_point() -> None:
    commits = sum(
        1
        for filename in MUTATION_FILES
        for function in _functions(EVENTS / filename)
        for _line, name in _calls(function)
        if name == "commit"
    )
    assert commits >= 11
