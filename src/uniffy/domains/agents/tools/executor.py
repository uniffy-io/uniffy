"""Tool executor for agent runtime."""

import asyncio
import time

from loguru import logger

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import tool_call_action
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditActorKind
from uniffy.domains.agents.cache import fetch_agent_row
from uniffy.domains.agents.metrics import AGENT_TOOL_CALLS_TOTAL, AGENT_TOOL_DURATION
from uniffy.domains.agents.providers.base import ToolCall
from uniffy.domains.agents.tools.definitions import (
    ToolContext,
    ToolDefinition,
    ToolResult,
)
from uniffy.domains.agents.tools.registry import ToolRegistry
from uniffy.domains.agents.tools.sanitization import sanitize_tool_error

logger = logger.bind(component="agents.tools.executor")

MAX_TOOL_RESULT_CHARS = 100_000

# Metric label values stay bounded: the typed failure reasons pass through,
# every other exception collapses to "error".
_METRIC_STATUSES = {"timeout", "not_found", "permission_denied", "validation_error"}


def _metric_status(result: ToolResult, error_reason: str | None) -> str:
    if result.success:
        return "success"
    if error_reason in _METRIC_STATUSES:
        return error_reason
    return "error"


def _truncate_result(data: str) -> str:
    """Truncate tool result data if it exceeds MAX_TOOL_RESULT_CHARS."""
    if len(data) <= MAX_TOOL_RESULT_CHARS:
        return data
    return (
        data[:MAX_TOOL_RESULT_CHARS] + f"\n\n[Truncated: showing {MAX_TOOL_RESULT_CHARS:,} "
        f"of {len(data):,} characters]"
    )


def _drop_optional_nulls(value: object, schema: dict) -> object:
    if isinstance(value, list):
        item_schema = schema.get("items")
        if not isinstance(item_schema, dict):
            return value
        return [_drop_optional_nulls(item, item_schema) for item in value]
    if not isinstance(value, dict):
        return value
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return value
    required = set(schema.get("required") or [])
    normalized: dict = {}
    for name, item in value.items():
        property_schema = properties.get(name)
        if item is None and name not in required:
            continue
        normalized[name] = (
            _drop_optional_nulls(item, property_schema)
            if isinstance(property_schema, dict)
            else item
        )
    return normalized


class ToolExecutor:
    """Executes tool calls within a permission-scoped context."""

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
        """Run one tool call, converting every failure into a ``ToolResult``.

        This is the authorization point for the agent's enabled-tool set: the
        provider tools param only advertises, and a model can emit a name it
        was never offered. Mutating tools (``read_only=False``) also write an
        ``agent.tool_call.<name>`` audit row attributed to the human.
        """
        tool_def = self._registry.get(tool_call.name)
        if tool_def is None:
            AGENT_TOOL_CALLS_TOTAL.labels(tool="unknown", status="unknown_tool").inc()
            return ToolResult(
                success=False,
                data="",
                error=f"Unknown tool: {tool_call.name}",
            )

        # Internal tools (view_skill, load_group) are advertised by the runtime
        # on its own terms and never appear in a builder's enabled set.
        if not tool_def.internal and tool_def.name not in self._context.allowed_tools:
            AGENT_TOOL_CALLS_TOTAL.labels(tool=tool_def.name, status="not_enabled").inc()
            logger.warning(
                "Tool call rejected: not enabled for this agent",
                tool=tool_def.name,
                agent_id=str(self._context.agent_id),
            )
            return ToolResult(
                success=False,
                data="",
                error=(
                    f"Tool {tool_call.name} is not enabled for this agent. "
                    "Work with the tools you have."
                ),
            )

        error_reason: str | None = None
        started = time.perf_counter()
        try:
            tool_input = _drop_optional_nulls(
                tool_call.input,
                tool_def.parameter_schema,
            )
            result = await asyncio.wait_for(
                tool_def.executor(self._context, tool_input),
                timeout=tool_def.timeout_seconds,
            )
            if result.success and result.data:
                result = ToolResult(
                    success=result.success,
                    data=_truncate_result(result.data),
                    error=result.error,
                    metadata=result.metadata,
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
                error=(f"Tool {tool_call.name} exceeded {tool_def.timeout_seconds}s timeout"),
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
            logger.exception("Tool execution failed", tool=tool_call.name, error=str(exc))
            error_reason = type(exc).__name__
            result = ToolResult(
                success=False,
                data="",
                error=sanitize_tool_error(tool_call.name, exc),
            )

        AGENT_TOOL_DURATION.labels(tool=tool_def.name).observe(time.perf_counter() - started)
        AGENT_TOOL_CALLS_TOTAL.labels(
            tool=tool_def.name, status=_metric_status(result, error_reason)
        ).inc()

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
                "actor_kind": AuditActorKind.AGENT,
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
                "Failed to emit tool-call audit row", tool=tool_def.name
            )
