#!/usr/bin/env python3
"""Inject matching .agents/rules guidance into Codex before repository edits."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

RULES_DIR = Path(__file__).resolve().parents[2] / ".agents" / "rules"
STATE_DIR = Path(tempfile.gettempdir()) / "uniffy-codex-path-rules"
PATCH_PATH_RE = re.compile(
    r"^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$",
    re.MULTILINE,
)


@dataclass(frozen=True)
class Rule:
    path: Path
    patterns: tuple[str, ...]
    content: str
    digest: str

    @property
    def relative_path(self) -> str:
        return self.path.relative_to(RULES_DIR.parents[1]).as_posix()


def _parse_rule(path: Path) -> Rule:
    content = path.read_text(encoding="utf-8")
    patterns: list[str] = []

    if content.startswith("---\n"):
        end = content.find("\n---\n", 4)
        if end == -1:
            raise ValueError(f"unclosed frontmatter in {path}")
        frontmatter = content[4:end]
        in_paths = False
        for line in frontmatter.splitlines():
            if line.strip() == "paths:":
                in_paths = True
                continue
            if in_paths and line.lstrip().startswith("- "):
                value = line.lstrip()[2:].strip()
                if value.startswith(('"', "'")):
                    value = json.loads(value) if value.startswith('"') else value[1:-1]
                patterns.append(value)
                continue
            if in_paths and line.strip():
                in_paths = False

    if not patterns:
        raise ValueError(f"missing paths frontmatter in {path}")

    digest = hashlib.sha256(content.encode()).hexdigest()
    return Rule(path=path, patterns=tuple(patterns), content=content, digest=digest)


def _load_rules() -> tuple[Rule, ...]:
    if not RULES_DIR.is_dir():
        raise FileNotFoundError(f"rules directory not found: {RULES_DIR}")
    return tuple(_parse_rule(path) for path in sorted(RULES_DIR.rglob("*.md")))


def _glob_regex(pattern: str) -> re.Pattern[str]:
    parts: list[str] = ["^"]
    index = 0
    while index < len(pattern):
        char = pattern[index]
        if char == "*" and index + 1 < len(pattern) and pattern[index + 1] == "*":
            index += 2
            if index < len(pattern) and pattern[index] == "/":
                parts.append("(?:.*/)?")
                index += 1
            else:
                parts.append(".*")
            continue
        if char == "*":
            parts.append("[^/]*")
        elif char == "?":
            parts.append("[^/]")
        else:
            parts.append(re.escape(char))
        index += 1
    parts.append("$")
    return re.compile("".join(parts))


def _matches(rule: Rule, relative_path: str) -> bool:
    return any(_glob_regex(pattern).match(relative_path) for pattern in rule.patterns)


def _normalize_target(raw_path: str) -> str | None:
    raw_path = raw_path.strip()
    path = Path(raw_path)
    repo_root = RULES_DIR.parents[1]
    if path.is_absolute():
        try:
            path = path.resolve().relative_to(repo_root)
        except ValueError:
            return None
    normalized = PurePosixPath(path.as_posix())
    if normalized.parts[:1] in (("a",), ("b",)):
        normalized = PurePosixPath(*normalized.parts[1:])
    if ".." in normalized.parts:
        return None
    return normalized.as_posix()


def _patch_targets(command: str) -> tuple[str, ...]:
    targets: set[str] = set()
    for match in PATCH_PATH_RE.finditer(command):
        normalized = _normalize_target(match.group(1) or match.group(2))
        if normalized:
            targets.add(normalized)
    return tuple(sorted(targets))


def _state_path(payload: dict[str, object]) -> Path:
    identity = "\0".join(
        str(payload.get(key) or "") for key in ("session_id", "transcript_path", "cwd", "agent_id")
    )
    return STATE_DIR / f"{hashlib.sha256(identity.encode()).hexdigest()}.json"


def _read_state(path: Path) -> dict[str, str]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_state(path: Path, state: dict[str, str]) -> None:
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(state, sort_keys=True), encoding="utf-8")
    temporary.replace(path)


def _context(rules: tuple[Rule, ...], reason: str) -> str:
    sections = [
        "Repository path-rule loader: these files are mandatory developer guidance. "
        f"{reason} Read and apply every included rule before continuing."
    ]
    for rule in rules:
        sections.append(f"## Source: {rule.relative_path}\n\n{rule.content}")
    return "\n\n".join(sections)


def _startup(payload: dict[str, object], rules: tuple[Rule, ...]) -> None:
    always_on = tuple(rule for rule in rules if "**/*" in rule.patterns)
    state = {rule.relative_path: rule.digest for rule in always_on}
    _write_state(_state_path(payload), state)
    event = str(payload.get("hook_event_name"))
    print(
        json.dumps({
            "hookSpecificOutput": {
                "hookEventName": event,
                "additionalContext": _context(
                    always_on, "These repository-wide rules apply to every task."
                ),
            }
        })
    )


def _pre_tool_use(payload: dict[str, object], rules: tuple[Rule, ...]) -> None:
    tool_input = payload.get("tool_input")
    command = tool_input.get("command") if isinstance(tool_input, dict) else None
    if not isinstance(command, str):
        raise ValueError("apply_patch hook input has no command string")

    targets = _patch_targets(command)
    if not targets:
        print(
            json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        "Path-rule loader could not determine the apply_patch targets. "
                        "Use standard Add, Update, Delete, or Move patch headers."
                    ),
                }
            })
        )
        return

    state_path = _state_path(payload)
    state = _read_state(state_path)
    matching = tuple(
        rule
        for rule in rules
        if any(_matches(rule, target) for target in targets)
        and state.get(rule.relative_path) != rule.digest
    )
    if not matching:
        return

    state.update({rule.relative_path: rule.digest for rule in matching})
    _write_state(state_path, state)
    target_list = ", ".join(f"`{target}`" for target in targets)
    print(
        json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    "Loaded newly applicable repository rules for "
                    f"{target_list}. Reassess the pending edit and retry it."
                ),
                "additionalContext": _context(
                    matching,
                    f"These path-scoped rules match the pending edit to {target_list}.",
                ),
            }
        })
    )


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise ValueError("hook input must be a JSON object")
        rules = _load_rules()
        event = payload.get("hook_event_name")
        if event in {"SessionStart", "SubagentStart"}:
            _startup(payload, rules)
        elif event == "PreToolUse" and payload.get("tool_name") == "apply_patch":
            _pre_tool_use(payload, rules)
        return 0
    except Exception as error:
        event = "PreToolUse"
        try:
            event = str(payload.get("hook_event_name") or event)
        except UnboundLocalError:
            pass
        if event == "PreToolUse":
            print(
                json.dumps({
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": f"Path-rule loader failed: {error}",
                    }
                })
            )
            return 0
        print(json.dumps({"systemMessage": f"Path-rule loader failed: {error}"}))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
