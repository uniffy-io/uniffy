from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).parents[5] / "lint" / "capabilities.py"
SPEC = importlib.util.spec_from_file_location("uniffy_capability_lint", MODULE_PATH)
assert SPEC is not None
assert SPEC.loader is not None
CAPABILITIES = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = CAPABILITIES
SPEC.loader.exec_module(CAPABILITIES)


def inspect_source(tmp_path: Path, source: str) -> list[object]:
    path = tmp_path / "sample.py"
    path.write_text(source)
    return CAPABILITIES.inspect_file(path)


@pytest.mark.parametrize(
    "source",
    [
        "value = 1\n",
        'message = "# ty: ignore[missing-argument]"\n',
        'name = "no_type_check"\n',
        "# type: ignore[missing-argument]\nvalue = 1\n",
    ],
)
def test_clean_source_is_accepted(tmp_path: Path, source: str) -> None:
    assert inspect_source(tmp_path, source) == []


@pytest.mark.parametrize(
    "source",
    [
        "call()  # ty: ignore[missing-argument]\n",
        "#ty:ignore\ncall()\n",
    ],
)
def test_ty_ignore_comments_are_rejected(tmp_path: Path, source: str) -> None:
    violations = inspect_source(tmp_path, source)
    assert [violation.message for violation in violations] == [
        "ty ignore comments are forbidden"
    ]


@pytest.mark.parametrize(
    "source",
    [
        "from typing import no_type_check\n",
        "from typing_extensions import no_type_check as unchecked\n",
        "import typing as t\ndecorator = t.no_type_check\n",
    ],
)
def test_no_type_check_is_rejected(tmp_path: Path, source: str) -> None:
    violations = inspect_source(tmp_path, source)
    assert [violation.message for violation in violations] == ["no_type_check is forbidden"]
