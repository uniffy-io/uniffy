"""Runtime-specific tool advertisement and turn execution helpers."""

from __future__ import annotations

import asyncio
from dataclasses import replace

from uniffy.core.database import SessionFactory
from uniffy.domains.agents.providers.base import ToolCall
from uniffy.domains.agents.tools.deferral import (
    LOAD_GROUP_TOOL,
    LOADED_GROUPS_METADATA_KEY,
)
from uniffy.domains.agents.tools.definitions import ToolContext, ToolResult
from uniffy.domains.agents.tools.executor import ToolExecutor
from uniffy.domains.agents.tools.registry import ToolRegistry, from_api_name

MAX_TOOL_ITERATIONS = 10
MAX_LOAD_ONLY_ITERATIONS = 3
READ_TOOL_POOL_SIZE = 5


def resolve_tool_schemas(
    registry: ToolRegistry,
    enabled_tools: list[str],
) -> list[dict] | None:
    schemas = registry.get_anthropic_schemas(enabled_tools)
    return schemas or None


def allowed_tool_names(tool_schemas: list[dict] | None) -> frozenset[str]:
    return frozenset(from_api_name(schema.get("name", "")) for schema in tool_schemas or [])


def is_load_only_turn(tool_calls: list[ToolCall]) -> bool:
    return bool(tool_calls) and all(
        from_api_name(tool_call.name) == LOAD_GROUP_TOOL for tool_call in tool_calls
    )


def expand_loaded_schemas(
    tool_schemas: list[dict],
    deferred_pool: dict[str, list[dict]] | None,
    tool_results: dict[str, ToolResult],
) -> None:
    if not deferred_pool:
        return
    for result in tool_results.values():
        for group in (result.metadata or {}).get(LOADED_GROUPS_METADATA_KEY, []):
            tool_schemas.extend(deferred_pool.pop(group, []))


def split_read_write(
    registry: ToolRegistry,
    tool_calls: list[ToolCall],
) -> tuple[list[ToolCall], list[ToolCall]]:
    reads: list[ToolCall] = []
    writes: list[ToolCall] = []
    for tool_call in tool_calls:
        definition = registry.get(tool_call.name)
        if definition is not None and definition.read_only:
            reads.append(tool_call)
        else:
            writes.append(tool_call)
    return reads, writes


async def _execute_read_tool_isolated(
    registry: ToolRegistry,
    base_context: ToolContext,
    tool_call: ToolCall,
    semaphore: asyncio.Semaphore,
    session_factory: SessionFactory,
) -> ToolResult:
    async with semaphore, session_factory() as fresh_session:
        context = replace(base_context, session=fresh_session)
        return await ToolExecutor(registry, context).execute(tool_call)


async def gather_read_tool_results(
    registry: ToolRegistry,
    base_context: ToolContext,
    read_calls: list[ToolCall],
    session_factory: SessionFactory,
) -> dict[str, ToolResult]:
    if not read_calls:
        return {}
    semaphore = asyncio.Semaphore(READ_TOOL_POOL_SIZE)
    tasks = [
        _execute_read_tool_isolated(
            registry,
            base_context,
            tool_call,
            semaphore,
            session_factory,
        )
        for tool_call in read_calls
    ]
    raw_results = await asyncio.gather(*tasks, return_exceptions=True)
    results: dict[str, ToolResult] = {}
    for tool_call, result in zip(read_calls, raw_results, strict=True):
        if isinstance(result, BaseException):
            results[tool_call.id] = ToolResult(
                success=False,
                data="",
                error=f"Internal error executing {tool_call.name}: {result}",
            )
        else:
            results[tool_call.id] = result
    return results
