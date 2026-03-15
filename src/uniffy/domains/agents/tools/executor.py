"""Tool executor for agent runtime."""

import re

from loguru import logger

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.domains.agents.providers.base import ToolCall
from uniffy.domains.agents.tools.definitions import ToolContext, ToolResult
from uniffy.domains.agents.tools.registry import ToolRegistry

MAX_TOOL_RESULT_CHARS = 100_000

_SENSITIVE_PATTERNS = [
    re.compile(r"(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN)\s", re.IGNORECASE),
    re.compile(r"psycopg|asyncpg|sqlalchemy", re.IGNORECASE),
    re.compile(r"(?:/home/|/usr/|/var/|/tmp/|/etc/|/opt/)[^\s]+"),
    re.compile(r'File "[^"]+", line \d+'),
    re.compile(r"Traceback \(most recent call last\)"),
    re.compile(r"(?:postgresql|redis|mysql|mongodb)://", re.IGNORECASE),
]


def _sanitize_error_message(tool_name: str, exc: Exception) -> str:
    """Produce a safe error message for the LLM.

    Checks the raw exception string for patterns that may leak
    internal details (SQL, file paths, connection strings). If any
    sensitive pattern is found, returns a generic message. Otherwise
    returns the original error text.

    Parameters
    ----------
    tool_name : str
        Name of the tool that failed.
    exc : Exception
        The caught exception.

    Returns
    -------
    str
        A sanitized error message safe for LLM consumption.

    """
    raw = str(exc)
    for pattern in _SENSITIVE_PATTERNS:
        if pattern.search(raw):
            logger.warning(
                "Sanitized sensitive error for LLM",
                tool=tool_name,
                original_error=raw,
            )
            return (
                f"Internal error executing {tool_name}. "
                f"The operation could not be completed."
            )
    return f"Internal error executing {tool_name}: {raw}"


def _truncate_result(data: str) -> str:
    """Truncate tool result data if it exceeds MAX_TOOL_RESULT_CHARS.

    Parameters
    ----------
    data : str
        The tool result data.

    Returns
    -------
    str
        The data, truncated with a notice if it exceeded the limit.

    """
    if len(data) <= MAX_TOOL_RESULT_CHARS:
        return data
    return (
        data[:MAX_TOOL_RESULT_CHARS]
        + f"\n\n[Truncated: showing {MAX_TOOL_RESULT_CHARS:,} "
        f"of {len(data):,} characters]"
    )


class ToolExecutor:
    """Executes tool calls within a permission-scoped context.

    Parameters
    ----------
    registry : ToolRegistry
        Tool registry to look up tool definitions.
    context : ToolContext
        Execution context with session, user_id, organization_id.

    """

    def __init__(self, registry: ToolRegistry, context: ToolContext) -> None:
        self._registry = registry
        self._context = context

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute a single tool call.

        Looks up the tool by name, invokes its executor with the
        provided arguments, and returns a structured result. Errors
        are caught and returned as failed ToolResults rather than
        propagated.

        Parameters
        ----------
        tool_call : ToolCall
            The tool call from the LLM (id, name, input).

        Returns
        -------
        ToolResult
            Execution result with success/failure and data or error.

        """
        tool_def = self._registry.get(tool_call.name)
        if tool_def is None:
            return ToolResult(
                success=False,
                data="",
                error=f"Unknown tool: {tool_call.name}",
            )

        try:
            result = await tool_def.executor(self._context, tool_call.input)
            if result.success and result.data:
                result = ToolResult(
                    success=result.success,
                    data=_truncate_result(result.data),
                    error=result.error,
                )
            return result
        except NotFoundError as exc:
            logger.warning(
                "Tool returned not-found",
                tool=tool_call.name,
                error=str(exc),
            )
            return ToolResult(
                success=False,
                data="",
                error=f"Not found: {exc}",
            )
        except PermissionDeniedError as exc:
            logger.warning(
                "Tool permission denied",
                tool=tool_call.name,
                error=str(exc),
            )
            return ToolResult(
                success=False,
                data="",
                error=f"Permission denied: {exc}",
            )
        except ValidationError as exc:
            logger.warning(
                "Tool validation error",
                tool=tool_call.name,
                error=str(exc),
            )
            return ToolResult(
                success=False,
                data="",
                error=f"Validation error: {exc}",
            )
        except Exception as exc:
            logger.error(
                "Tool execution failed",
                tool=tool_call.name,
                error=str(exc),
                exc_info=True,
            )
            return ToolResult(
                success=False,
                data="",
                error=_sanitize_error_message(tool_call.name, exc),
            )
