"""
Benchmarks for logger escape functions.

Run with: ./run.sh bench
Or directly: uv run pytest tests/benchmarks/ --benchmark-only

These benchmarks compare different approaches for escaping loguru markup characters.
The current implementation uses the "simple" approach which benchmarked fastest.
"""

import re

import pytest

# =============================================================================
# Test data representing real-world log messages
# =============================================================================

# Typical access log - no special characters (most common case ~90%)
CLEAN_ACCESS_LOG = "access notes.v1.NotesService/GetNote"

# Error message with JSON - has special characters
DIRTY_JSON_ERROR = 'Error parsing JSON: {"key": "value", "items": [1,2,3]}'

# Message with markup-like characters
DIRTY_MARKUP_MSG = "User <admin> logged in with role [admin]"

# Long clean message
LONG_CLEAN_MSG = "Processing request for user authentication " * 10

# Long dirty message
LONG_DIRTY_MSG = "Error in {module} at <line> with [context]: " * 10


# =============================================================================
# Implementation variants for comparison
# =============================================================================


def escape_naive(s: str) -> str:
    """Naive approach: always run 6x replace chains."""
    return (
        s.replace("{", "{{")
        .replace("}", "}}")
        .replace("<", "\\<")
        .replace(">", "\\>")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )


def escape_simple_check(s: str) -> str:
    """Simple check: inline 'in' operators with early return."""
    if not ("{" in s or "}" in s or "<" in s or ">" in s or "[" in s or "]" in s):
        return s
    return (
        s.replace("{", "{{")
        .replace("}", "}}")
        .replace("<", "\\<")
        .replace(">", "\\>")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )


_SPECIAL_CHARS_FROZENSET = frozenset("{}[]<>")


def escape_frozenset_check(s: str) -> str:
    """Frozenset check: use set.isdisjoint() for early return."""
    if _SPECIAL_CHARS_FROZENSET.isdisjoint(s):
        return s
    return (
        s.replace("{", "{{")
        .replace("}", "}}")
        .replace("<", "\\<")
        .replace(">", "\\>")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )


_ESCAPE_PATTERN = re.compile(r"([{}<>\[\]])")
_ESCAPE_MAP = {
    "{": "{{",
    "}": "}}",
    "<": "\\<",
    ">": "\\>",
    "[": "\\[",
    "]": "\\]",
}


def _escape_match(m: re.Match) -> str:
    return _ESCAPE_MAP[m.group(1)]


def escape_regex(s: str) -> str:
    """Regex approach: compiled pattern with replacement function."""
    if _SPECIAL_CHARS_FROZENSET.isdisjoint(s):
        return s
    return _ESCAPE_PATTERN.sub(_escape_match, s)


# =============================================================================
# Correctness tests
# =============================================================================


@pytest.mark.parametrize(
    "escape_fn",
    [escape_naive, escape_simple_check, escape_frozenset_check, escape_regex],
    ids=["naive", "simple_check", "frozenset_check", "regex"],
)
class TestEscapeCorrectness:
    """Verify all implementations produce identical results."""

    def test_clean_string_unchanged(self, escape_fn):
        """Clean strings should pass through unchanged."""
        assert escape_fn(CLEAN_ACCESS_LOG) == CLEAN_ACCESS_LOG

    def test_braces_doubled(self, escape_fn):
        """Curly braces should be doubled."""
        assert escape_fn("{test}") == "{{test}}"

    def test_angle_brackets_escaped(self, escape_fn):
        """Angle brackets should be backslash-escaped."""
        assert escape_fn("<test>") == "\\<test\\>"

    def test_square_brackets_escaped(self, escape_fn):
        """Square brackets should be backslash-escaped."""
        assert escape_fn("[test]") == "\\[test\\]"

    def test_mixed_special_chars(self, escape_fn):
        """All special chars in one string."""
        result = escape_fn("{<[test]>}")
        assert result == "{{\\<\\[test\\]\\>}}"

    def test_empty_string(self, escape_fn):
        """Empty string should return empty."""
        assert escape_fn("") == ""

    def test_real_json_error(self, escape_fn):
        """Real-world JSON error message."""
        result = escape_fn(DIRTY_JSON_ERROR)
        assert "{" not in result or "{{" in result
        assert "[" not in result or "\\[" in result


# =============================================================================
# Benchmarks
# =============================================================================


class TestBenchmarkCleanMessages:
    """Benchmark clean messages (typical case - ~90% of logs)."""

    def test_naive_clean(self, benchmark):
        benchmark(escape_naive, CLEAN_ACCESS_LOG)

    def test_simple_check_clean(self, benchmark):
        benchmark(escape_simple_check, CLEAN_ACCESS_LOG)

    def test_frozenset_check_clean(self, benchmark):
        benchmark(escape_frozenset_check, CLEAN_ACCESS_LOG)

    def test_regex_clean(self, benchmark):
        benchmark(escape_regex, CLEAN_ACCESS_LOG)


class TestBenchmarkDirtyMessages:
    """Benchmark dirty messages (need escaping - ~10% of logs)."""

    def test_naive_dirty(self, benchmark):
        benchmark(escape_naive, DIRTY_JSON_ERROR)

    def test_simple_check_dirty(self, benchmark):
        benchmark(escape_simple_check, DIRTY_JSON_ERROR)

    def test_frozenset_check_dirty(self, benchmark):
        benchmark(escape_frozenset_check, DIRTY_JSON_ERROR)

    def test_regex_dirty(self, benchmark):
        benchmark(escape_regex, DIRTY_JSON_ERROR)


class TestBenchmarkLongMessages:
    """Benchmark long messages."""

    def test_naive_long_clean(self, benchmark):
        benchmark(escape_naive, LONG_CLEAN_MSG)

    def test_simple_check_long_clean(self, benchmark):
        benchmark(escape_simple_check, LONG_CLEAN_MSG)

    def test_naive_long_dirty(self, benchmark):
        benchmark(escape_naive, LONG_DIRTY_MSG)

    def test_simple_check_long_dirty(self, benchmark):
        benchmark(escape_simple_check, LONG_DIRTY_MSG)


class TestBenchmarkRealWorldMix:
    """Benchmark realistic mix: 90% clean, 10% dirty."""

    def _run_mixed_workload(self, escape_fn):
        """Simulate realistic workload."""
        for _ in range(9):
            escape_fn(CLEAN_ACCESS_LOG)
        escape_fn(DIRTY_JSON_ERROR)

    def test_naive_mixed(self, benchmark):
        benchmark(self._run_mixed_workload, escape_naive)

    def test_simple_check_mixed(self, benchmark):
        benchmark(self._run_mixed_workload, escape_simple_check)

    def test_frozenset_check_mixed(self, benchmark):
        benchmark(self._run_mixed_workload, escape_frozenset_check)

    def test_regex_mixed(self, benchmark):
        benchmark(self._run_mixed_workload, escape_regex)
