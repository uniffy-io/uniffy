"""Tool executor for agent runtime."""

import asyncio
import re

from loguru import logger

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import tool_call_action
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.domains.agents.cache import fetch_agent_row
from uniffy.domains.agents.providers.base import ToolCall
from uniffy.domains.agents.tools.definitions import (
    ToolContext,
    ToolDefinition,
    ToolResult,
)
from uniffy.domains.agents.tools.registry import ToolRegistry

logger = logger.bind(component="agents.tools.executor")

MAX_TOOL_RESULT_CHARS = 100_000

_SENSITIVE_PATTERNS = [
    re.compile(r"(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN)\s", re.IGNORECASE),
    re.compile(r"psycopg|asyncpg|sqlalchemy", re.IGNORECASE),
    re.compile(r"(?:/home/|/usr/|/var/|/tmp/|/etc/|/opt/)[^\s]+"),
    re.compile(r'File "[^"]+", line \d+'),
    re.compile(r"Traceback \(most recent call last\)"),
    re.compile(r"(?:postgresql|valkey|mysql|mongodb)://", re.IGNORECASE),
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
            return f"Internal error executing {tool_name}. The operation could not be completed."
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
        data[:MAX_TOOL_RESULT_CHARS] + f"\n\n[Truncated: showing {MAX_TOOL_RESULT_CHARS:,} "
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

    @property
    def registry(self) -> ToolRegistry:
        """Tool registry the executor consults for definitions."""
        return self._registry

    @property
    def context(self) -> ToolContext:
        """Per-call tool context (session, user, org, agent ids)."""
        return self._context

    async def execute(self, tool_call: ToolCall) -> ToolResult:
        """Execute a single tool call.

        Looks up the tool by name, invokes its executor with the
        provided arguments, and returns a structured result. Errors
        are caught and returned as failed ToolResults rather than
        propagated.

        For every mutating tool (``read_only=False``), an
        ``agent.tool_call.<name>`` row is written through the central
        audit pipeline. The row attributes the action to the human
        owner (``ctx.user_id``) and surfaces the agent's identity via
        ``details.actor_kind = "agent"`` + ``details.agent_id``.
        Read-only tools are not audited.

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

        error_reason: str | None = None
        try:
            result = await asyncio.wait_for(
                tool_def.executor(self._context, tool_call.input),
                timeout=tool_def.timeout_seconds,
            )
            if result.success and result.data:
                result = ToolResult(
                    success=result.success,
                    data=_truncate_result(result.data),
                    error=result.error,
                )
        except TimeoutError:
            logger.warning(
                "Tool execution timed out",
                tool=tool_call.name,
                timeout_seconds=tool_def.timeout_seconds,
            )
            error_reason = "timeout"
            result = ToolResult(
                success=False,
                data="",
                error=(
                    f"Tool {tool_call.name} exceeded "
                    f"{tool_def.timeout_seconds}s timeout"
                ),
            )
        except NotFoundError as exc:
            logger.warning(
                "Tool returned not-found",
                tool=tool_call.name,
                error=str(exc),
            )
            error_reason = "not_found"
            result = ToolResult(
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
            error_reason = "permission_denied"
            result = ToolResult(
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
            error_reason = "validation_error"
            result = ToolResult(
                success=False,
                data="",
                error=f"Validation error: {exc}",
            )
        except Exception as exc:
            logger.exception(
                "Tool execution failed",
                tool=tool_call.name,
                error=str(exc)
            )
            error_reason = type(exc).__name__
            result = ToolResult(
                success=False,
                data="",
                error=_sanitize_error_message(tool_call.name, exc),
            )

        if not tool_def.read_only:
            await self._emit_tool_call_audit(tool_def, result, error_reason)

        return result

    async def _emit_tool_call_audit(
        self,
        tool_def: ToolDefinition,
        result: ToolResult,
        error_reason: str | None,
    ) -> None:
        """Emit an ``agent.tool_call.<name>`` row for a mutating tool.

        Best-effort: a failure to write the audit row never breaks the
        tool loop. The audit row is added to the same session the tool
        used, so it commits with the surrounding mutation when the
        tool path commits, and rolls back together when it does not.
        """
        try:
            details: dict = {
                "actor_kind": "agent",
                "tool_name": tool_def.name,
                "status": "success" if result.success else "failed",
            }
            if self._context.agent_id is not None:
                details["agent_id"] = str(self._context.agent_id)
                try:
                    agent = await fetch_agent_row(
                        self._context.session,
                        self._context.agent_id,
                        self._context.organization_id,
                    )
                    if agent is not None:
                        details["agent_name"] = agent.name
                except Exception:  # noqa: BLE001
                    pass
            if self._context.session_id is not None:
                details["agent_session_id"] = str(self._context.session_id)
            if error_reason is not None:
                details["error_reason"] = error_reason

            await write_audit_event(
                self._context.session,
                organization_id=self._context.organization_id,
                actor_user_id=self._context.user_id,
                action=tool_call_action(tool_def.name),
                resource_type=None,
                resource_id=None,
                details=details,
            )
        except Exception:  # noqa: BLE001
            logger.opt(exception=True).warning(
                "Failed to emit tool-call audit row",
                tool=tool_def.name
            )
