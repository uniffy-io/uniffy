"""Normalized model params map onto each provider's native request shape."""

from google.genai import types

from uniffy.domains.agents.providers.anthropic.provider import AnthropicProvider
from uniffy.domains.agents.providers.google.provider import GoogleProvider
from uniffy.domains.agents.providers.openai.provider import OpenAIProvider
from uniffy.domains.agents.providers.openrouter.provider import OpenRouterProvider
from uniffy.domains.agents.providers.xai.provider import XAIProvider

MESSAGES = [{"role": "user", "content": "hi"}]


def _anthropic_kwargs(model: str, params: dict | None) -> dict:
    provider = AnthropicProvider("sk-ant-test")
    return provider._build_request_kwargs(
        messages=MESSAGES, model=model, system=None, tools=None, params=params,
    )


def test_anthropic_adaptive_effort() -> None:
    kwargs = _anthropic_kwargs("claude-opus-4-8", {"reasoning_effort": "xhigh"})
    assert kwargs["thinking"] == {"type": "adaptive", "display": "summarized"}
    assert kwargs["output_config"] == {"effort": "xhigh"}
    assert kwargs["max_tokens"] == 8192


def test_anthropic_legacy_budget_extends_ceiling() -> None:
    kwargs = _anthropic_kwargs(
        "claude-opus-4-1-20250805", {"reasoning_effort": "on", "max_tokens": 2048},
    )
    assert kwargs["thinking"] == {"type": "enabled", "budget_tokens": 4096}
    assert kwargs["max_tokens"] == 2048 + 4096


def test_anthropic_off_maps_sampling() -> None:
    kwargs = _anthropic_kwargs(
        "claude-sonnet-4-6",
        {"temperature": 0.3, "top_p": 0.9, "provider_options": {"top_k": 40}},
    )
    assert "thinking" not in kwargs
    assert kwargs["temperature"] == 0.3
    assert kwargs["top_p"] == 0.9
    assert kwargs["top_k"] == 40


def test_anthropic_thinking_drops_sampling() -> None:
    kwargs = _anthropic_kwargs(
        "claude-sonnet-4-6", {"reasoning_effort": "high", "temperature": 0.3},
    )
    assert kwargs["thinking"]["type"] == "adaptive"
    assert "temperature" not in kwargs


def test_anthropic_no_params_matches_defaults() -> None:
    kwargs = _anthropic_kwargs("claude-sonnet-4-6", None)
    assert kwargs["max_tokens"] == 8192
    assert "thinking" not in kwargs
    assert "temperature" not in kwargs


def _openai_kwargs(provider, model: str, params: dict | None, tools=None) -> dict:
    return provider._build_request_kwargs(
        messages=MESSAGES, model=model, system=None, tools=tools, params=params,
    )


def test_openai_mapping() -> None:
    provider = OpenAIProvider("sk-test")
    kwargs = _openai_kwargs(
        provider,
        "gpt-5.5",
        {"reasoning_effort": "high", "max_tokens": 4096, "temperature": 0.7},
    )
    assert kwargs["reasoning_effort"] == "high"
    assert kwargs["max_completion_tokens"] == 4096
    assert kwargs["temperature"] == 0.7


def test_openai_off_omits_reasoning() -> None:
    provider = OpenAIProvider("sk-test")
    kwargs = _openai_kwargs(provider, "gpt-4o", {"temperature": 1.5})
    assert "reasoning_effort" not in kwargs


def test_openai_parallel_tool_calls_requires_tools() -> None:
    provider = OpenAIProvider("sk-test")
    tools = [{"name": "t", "description": "d", "input_schema": {"type": "object"}}]
    with_tools = _openai_kwargs(
        provider, "gpt-4o", {"provider_options": {"parallel_tool_calls": False}}, tools,
    )
    without_tools = _openai_kwargs(
        provider, "gpt-4o", {"provider_options": {"parallel_tool_calls": False}},
    )
    assert with_tools["parallel_tool_calls"] is False
    assert "parallel_tool_calls" not in without_tools


def test_openrouter_reasoning_in_extra_body() -> None:
    provider = OpenRouterProvider("sk-or-test")
    effort = _openai_kwargs(
        provider, "openai/gpt-5.5", {"reasoning_effort": "high"},
    )
    assert effort["extra_body"]["reasoning"] == {"effort": "high"}
    bare = _openai_kwargs(
        provider, "deepseek/deepseek-v4-pro", {"reasoning_effort": "on"},
    )
    assert bare["extra_body"]["reasoning"] == {"enabled": True}
    assert "reasoning_effort" not in effort
    assert "reasoning_effort" not in bare


def test_xai_sends_no_reasoning() -> None:
    provider = XAIProvider("xai-test")
    kwargs = _openai_kwargs(provider, "grok-4.5", {"reasoning_effort": "on"})
    assert "reasoning_effort" not in kwargs
    assert "extra_body" not in kwargs


def test_google_thinking_level() -> None:
    provider = GoogleProvider("g-test")
    config = provider._build_config(
        model="gemini-3.5-flash",
        system=None,
        tools=None,
        params={"reasoning_effort": "low", "temperature": 0.5,
                "max_tokens": 2048, "provider_options": {"top_k": 20}},
    )
    assert config.thinking_config.thinking_level == types.ThinkingLevel.LOW
    assert config.thinking_config.include_thoughts is True
    assert config.temperature == 0.5
    assert config.max_output_tokens == 2048
    assert config.top_k == 20


def test_google_budget_reasoner_on() -> None:
    provider = GoogleProvider("g-test")
    config = provider._build_config(
        model="gemini-2.5-pro", system=None, tools=None,
        params={"reasoning_effort": "on"},
    )
    assert config.thinking_config.thinking_budget == -1
    assert config.thinking_config.include_thoughts is True


def test_google_off_omits_thinking_config() -> None:
    provider = GoogleProvider("g-test")
    config = provider._build_config(
        model="gemini-2.5-pro", system=None, tools=None, params={},
    )
    assert config.thinking_config is None
