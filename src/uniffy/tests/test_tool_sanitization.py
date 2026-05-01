"""Tests for agents tool error sanitization."""

from uniffy.core.errors import (
    BudgetExceededError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitExceededError,
    ValidationError,
)
from uniffy.domains.agents.tools.sanitization import sanitize_tool_error


class TestTypedExceptions:
    """Typed domain exceptions round-trip with a safe prefix."""

    def test_not_found_error(self) -> None:
        err = NotFoundError("Note", "abc-123")
        result = sanitize_tool_error("notes.read_note", err)
        assert result.startswith("Not found:")

    def test_permission_denied(self) -> None:
        err = PermissionDeniedError("read", "Note")
        result = sanitize_tool_error("notes.read_note", err)
        assert result.startswith("Permission denied:")

    def test_validation_error_passes_message_through(self) -> None:
        err = ValidationError("title", "Title cannot be empty")
        result = sanitize_tool_error("notes.create_note", err)
        assert result.startswith("Validation error:")
        assert "Title cannot be empty" in result

    def test_rate_limit_error_includes_retry_after(self) -> None:
        err = RateLimitExceededError(
            resource="image generation (per user)",
            limit=5,
            window_seconds=60,
            retry_after=42,
        )
        result = sanitize_tool_error("images.generate_image", err)
        assert result.startswith("Rate limited:")
        assert "retry after 42s" in result

    def test_budget_exceeded_error_formats_cleanly(self) -> None:
        err = BudgetExceededError(
            scope="user",
            limit_kind="image_count",
            current="5",
            limit="5",
        )
        result = sanitize_tool_error("images.generate_image", err)
        assert "Quota exceeded" in result
        assert "user/image_count" in result
        assert "5 of 5" in result


class TestGenericExceptionScrubbing:
    """Any non-typed exception is scanned for sensitive patterns."""

    def test_sql_fragment_is_scrubbed(self) -> None:
        err = RuntimeError("ERROR: SELECT * FROM notes WHERE id = 'x' failed")
        result = sanitize_tool_error("notes.read_note", err)
        assert "SELECT" not in result
        assert "notes.read_note" in result
        assert "could not be completed" in result

    def test_file_path_is_scrubbed(self) -> None:
        err = RuntimeError('File "/home/user/app/handlers.py", line 42, boom')
        result = sanitize_tool_error("notes.read_note", err)
        assert "/home/user" not in result
        assert "could not be completed" in result

    def test_connection_string_is_scrubbed(self) -> None:
        err = RuntimeError("Could not connect: postgresql://admin:pw@db:5432/uniffy")
        result = sanitize_tool_error("notes.read_note", err)
        assert "postgresql://" not in result

    def test_traceback_is_scrubbed(self) -> None:
        err = RuntimeError("Traceback (most recent call last):\n  File ...")
        result = sanitize_tool_error("notes.read_note", err)
        assert "Traceback" not in result

    def test_driver_name_is_scrubbed(self) -> None:
        err = RuntimeError("sqlalchemy.exc.InvalidRequestError: something")
        result = sanitize_tool_error("notes.read_note", err)
        assert "sqlalchemy" not in result.lower()

    def test_benign_message_passes_through(self) -> None:
        err = RuntimeError("The API returned an unexpected status code")
        result = sanitize_tool_error("notes.read_note", err)
        assert "unexpected status code" in result
        assert "notes.read_note" in result

    def test_unix_path_variants_scrubbed(self) -> None:
        for path in ("/etc/passwd", "/var/log/app.log", "/tmp/secrets.json", "/opt/data"):
            err = RuntimeError(f"could not read {path}")
            result = sanitize_tool_error("files.read_file_content", err)
            assert path not in result
