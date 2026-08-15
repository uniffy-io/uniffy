"""Deferred tool loading against live provider APIs.

Verifies the two mechanics the runtime relies on, per provider:
a plain tool round trip, and appending new tool schemas between tool-loop
iterations while the history already references the meta tool. The message
shapes mirror what the runtime builds in ``_run_tool_loop``.
"""

import asyncio

from uniffy.domains.agents.runtime.prompt import build_system_prompt
from uniffy.domains.agents.tools.deferral import LOAD_GROUP_TOOL
from uniffy.domains.agents.tools.registry import get_tool_registry, to_api_name

LOAD_API_NAME = to_api_name(LOAD_GROUP_TOOL)

WEATHER_SCHEMA = {
    "name": "weather-get_current",
    "description": "Get the current weather for a city.",
    "input_schema": {
        "type": "object",
        "properties": {
            "city": {"type": "string", "description": "City name."},
        },
        "required": ["city"],
    },
}


def _load_group_schema() -> dict:
    return get_tool_registry().get_anthropic_schemas([LOAD_GROUP_TOOL])[0]


def _tool_calls_by_name(result) -> dict[str, dict]:
    return {tc.name: tc.input for tc in result.tool_calls}


def test_basic_tool_roundtrip(live_provider) -> None:
    name, provider, model = live_provider

    async def scenario():
        result = await provider.chat_completion(
            messages=[
                {
                    "role": "user",
                    "content": (
                        "What is the weather in Paris right now? "
                        "Use your tools; do not answer from memory."
                    ),
                }
            ],
            model=model,
            system="You are a helpful assistant. Always use tools when they apply.",
            tools=[WEATHER_SCHEMA],
        )
        calls = _tool_calls_by_name(result)
        assert "weather-get_current" in calls, (
            f"{name}: expected a weather tool call, got "
            f"stop_reason={result.stop_reason!r} content={result.content[:200]!r}"
        )

    asyncio.run(scenario())


def test_mid_loop_schema_append(live_provider) -> None:
    name, provider, model = live_provider

    async def scenario():
        system = build_system_prompt(
            agent_name="Tester",
            soul_prompt="You are a workspace assistant.",
            org_name="Integration Org",
            deferred_tools={"Weather": ["weather.get_current"]},
        )
        user_turn = {
            "role": "user",
            "content": (
                "What is the weather in Paris right now? Use your tools; do not answer from memory."
            ),
        }

        first = await provider.chat_completion(
            messages=[user_turn],
            model=model,
            system=system,
            tools=[_load_group_schema()],
        )
        calls = _tool_calls_by_name(first)
        assert LOAD_API_NAME in calls, (
            f"{name}: expected a {LOAD_API_NAME} call, got "
            f"stop_reason={first.stop_reason!r} content={first.content[:200]!r}"
        )
        load_call = next(tc for tc in first.tool_calls if tc.name == LOAD_API_NAME)
        assert str(load_call.input.get("group", "")).casefold() == "weather"

        # Continue the loop the way the runtime does: tool_use in the
        # assistant turn, tool_result in the next user turn, and the newly
        # loaded schema appended to the tools array.
        messages = [
            user_turn,
            {
                "role": "assistant",
                "content": [
                    *first.thinking_blocks,
                    *([{"type": "text", "text": first.content}] if first.content else []),
                    {
                        "type": "tool_use",
                        "id": load_call.id,
                        "name": load_call.name,
                        "input": load_call.input,
                        # Gemini rejects re-fed function calls without their
                        # thought_signature; the runtime threads it the same way.
                        **({"metadata": load_call.metadata} if load_call.metadata else {}),
                    },
                ],
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": load_call.id,
                        "tool_name": load_call.name,
                        "content": (
                            "Loaded tool group 'Weather'. These tools are now "
                            "available:\n- weather-get_current: Get the current "
                            "weather for a city.\nCall them directly from now on."
                        ),
                    }
                ],
            },
        ]
        second = await provider.chat_completion(
            messages=messages,
            model=model,
            system=system,
            tools=[_load_group_schema(), WEATHER_SCHEMA],
        )
        calls = _tool_calls_by_name(second)
        assert "weather-get_current" in calls, (
            f"{name}: expected a weather call after the load, got "
            f"stop_reason={second.stop_reason!r} content={second.content[:200]!r}"
        )
        assert calls["weather-get_current"].get("city")

    asyncio.run(scenario())
