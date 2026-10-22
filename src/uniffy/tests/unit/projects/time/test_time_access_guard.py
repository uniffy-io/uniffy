"""Time records are member-record data; nothing in the package may reach the content path."""

import ast
from pathlib import Path

import uniffy.domains.projects.time as time_package

TIME_DIR = Path(time_package.__file__).parent

FORBIDDEN_NAMES = frozenset({
    "PermissionChecker",
    "effective_role",
    "build_accessible_filter",
    "build_candidate_filter",
    "visible_sets",
    "register_manage_override",
    "ContentAccessQuery",
})
FORBIDDEN_IMPORT_ROOTS = (
    "uniffy.core.auth.permissions",
    "uniffy.core.content.registry",
    "uniffy.core.search.policy",
    "uniffy.domains.permissions.members",
)


def _content_path_references(tree: ast.AST) -> set[str]:
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            if node.module.startswith(FORBIDDEN_IMPORT_ROOTS):
                found.add(node.module)
        elif isinstance(node, ast.Import):
            found.update(
                alias.name for alias in node.names if alias.name.startswith(FORBIDDEN_IMPORT_ROOTS)
            )
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            found.add(node.id)
        elif isinstance(node, ast.Attribute) and node.attr in FORBIDDEN_NAMES:
            found.add(node.attr)
    return found


def test_time_package_never_touches_the_content_access_path() -> None:
    offenders: dict[str, set[str]] = {}
    for path in sorted(TIME_DIR.glob("*.py")):
        found = _content_path_references(ast.parse(path.read_text(encoding="utf-8")))
        if found:
            offenders[path.name] = found
    assert offenders == {}, f"content-path references in domains/projects/time: {offenders}"
