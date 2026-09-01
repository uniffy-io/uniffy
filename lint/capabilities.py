from __future__ import annotations

import argparse
import ast
import re
import sys
import tokenize
from dataclasses import dataclass
from pathlib import Path

TY_IGNORE = re.compile(r"(?<!\w)ty\s*:\s*ignore(?:\b|\[)")


@dataclass(frozen=True, order=True)
class Violation:
    path: Path
    line: int
    column: int
    message: str


def python_files(paths: list[Path]) -> list[Path]:
    files: set[Path] = set()
    for path in paths:
        if path.is_file() and path.suffix == ".py":
            files.add(path)
        elif path.is_dir():
            files.update(candidate for candidate in path.rglob("*.py") if candidate.is_file())
    return sorted(files)


def inspect_file(path: Path) -> list[Violation]:
    with tokenize.open(path) as source_file:
        source = source_file.read()

    violations: list[Violation] = []
    for token in tokenize.generate_tokens(iter(source.splitlines(keepends=True)).__next__):
        if token.type == tokenize.COMMENT and TY_IGNORE.search(token.string):
            violations.append(
                Violation(
                    path=path,
                    line=token.start[0],
                    column=token.start[1] + 1,
                    message="ty ignore comments are forbidden",
                )
            )

    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError:
        return violations

    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module in {"typing", "typing_extensions"}:
            if any(alias.name == "no_type_check" for alias in node.names):
                violations.append(
                    Violation(
                        path=path,
                        line=node.lineno,
                        column=node.col_offset + 1,
                        message="no_type_check is forbidden",
                    )
                )
        elif isinstance(node, ast.Attribute) and node.attr == "no_type_check":
            violations.append(
                Violation(
                    path=path,
                    line=node.lineno,
                    column=node.col_offset + 1,
                    message="no_type_check is forbidden",
                )
            )

    return violations


def inspect_paths(paths: list[Path]) -> list[Violation]:
    return sorted(
        violation for path in python_files(paths) for violation in inspect_file(path)
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="+", type=Path)
    args = parser.parse_args()

    violations = inspect_paths(args.paths)
    for violation in violations:
        print(
            f"{violation.path}:{violation.line}:{violation.column}: "
            f"{violation.message}",
            file=sys.stderr,
        )
    return 1 if violations else 0


if __name__ == "__main__":
    raise SystemExit(main())
