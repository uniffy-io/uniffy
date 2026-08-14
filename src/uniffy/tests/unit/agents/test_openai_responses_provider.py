"""OpenAI Responses API path: request building and stream parsing."""

from decimal import Decimal
from types import SimpleNamespace

from uniffy.domains.agents.providers.base import EventType
from uniffy.domains.agents.providers.openai.provider import OpenAIProvider
from uniffy.domains.agents.providers.openai.responses import (
    build_responses_kwargs,
    convert_messages_to_responses,
)
from uniffy.domains.agents.providers.openrouter.provider import OpenRouterProvider

MESSAGES = [{"role": "user", "content": "hi"}]


async def _collect(awaitable_iter):
    async def _run():
        iterator = await awaitable_iter
        return [event async for event in iterator]

    return await _run()


def _types(events):
    return [e.type for e in events]


def _reasoning_item(item_id: str = "rs_1") -> SimpleNamespace:
    payload = {
        "id": item_id,
        "type": "reasoning",
        "summary": [{"type": "summary_text", "text": "thought summary"}],
        "encrypted_content": "enc-blob",
    }
    return SimpleNamespace(
        id=item_id,
        type="reasoning",
        model_dump=lambda **_kw: payload,
    )


def _message_item(item_id: str = "msg_1", text: str = "Answer") -> SimpleNamespace:
    return SimpleNamespace(
        id=item_id,
        type="message",
        content=[SimpleNamespace(type="output_text", text=text)],
    )


def _refusal_item(item_id: str = "msg_refusal") -> SimpleNamespace:
    return SimpleNamespace(
        id=item_id,
        type="message",
        content=[SimpleNamespace(type="refusal", refusal="I cannot help with that.")],
    )


def _function_item(item_id: str = "fc_1") -> SimpleNamespace:
    return SimpleNamespace(
        id=item_id,
        type="function_call",
        call_id="call_1",
        name="files.search",
        arguments='{"q": "report"}',
    )


def _usage(*, cost: str | None = None) -> SimpleNamespace:
    usage = SimpleNamespace(
        input_tokens=20,
        output_tokens=9,
        input_tokens_details=SimpleNamespace(
            cached_tokens=4,
            cache_write_tokens=6,
        ),
        output_tokens_details=SimpleNamespace(reasoning_tokens=5),
    )
    if cost is not None:
        usage.cost = cost
    return usage


def _completed_response(output: list, *, cost: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        model="gpt-5.6-terra",
        status="completed",
        incomplete_details=None,
        output=output,
        usage=_usage(cost=cost),
    )


def _event(etype: str, **fields) -> SimpleNamespace:
    return SimpleNamespace(type=etype, **fields)


def _install_responses_stream(provider, events: list) -> None:
    async def _gen():
        for event in events:
            yield event

    async def _create(**kwargs):
        return _gen()

    provider._client = SimpleNamespace(responses=SimpleNamespace(create=_create))


def _full_stream_events() -> list:
    reasoning = _reasoning_item()
    message = _message_item()
    function = _function_item()
    return [
        _event("response.output_item.added", item=reasoning, output_index=0),
        _event(
            "response.reasoning_summary_part.added",
            item_id="rs_1",
            summary_index=0,
        ),
        _event(
            "response.reasoning_summary_text.delta",
            item_id="rs_1",
            delta="thought ",
            summary_index=0,
        ),
        _event(
            "response.reasoning_summary_part.added",
            item_id="rs_1",
            summary_index=1,
        ),
        _event(
            "response.reasoning_summary_text.delta",
            item_id="rs_1",
            delta="summary",
            summary_index=1,
        ),
        _event("response.output_item.done", item=reasoning, output_index=0),
        _event("response.output_item.added", item=message, output_index=1),
        _event("response.output_text.delta", item_id="msg_1", delta="Ans"),
        _event("response.output_text.delta", item_id="msg_1", delta="wer"),
        _event("response.output_item.done", item=message, output_index=1),
        _event("response.output_item.added", item=function, output_index=2),
        _event(
            "response.function_call_arguments.delta",
            item_id="fc_1",
            delta='{"q": "report"}',
        ),
        _event("response.output_item.done", item=function, output_index=2),
        _event(
            "response.completed",
            response=_completed_response([reasoning, message, function]),
        ),
    ]


class TestResponsesStream:
    async def test_block_framing(self) -> None:
        provider = OpenAIProvider("sk-test")
        _install_responses_stream(provider, _full_stream_events())
        events = await _collect(provider.chat_completion(MESSAGES, "gpt-5.5", stream=True))
        assert _types(events) == [
            EventType.MODEL_CALL_START,
            EventType.THINKING_BLOCK_START,
            EventType.THINKING_BLOCK_DELTA,
            EventType.THINKING_BLOCK_DELTA,
            EventType.THINKING_BLOCK_DELTA,
            EventType.THINKING_BLOCK_END,
            EventType.TEXT_BLOCK_START,
            EventType.TEXT_BLOCK_DELTA,
            EventType.TEXT_BLOCK_DELTA,
            EventType.TEXT_BLOCK_END,
            EventType.TOOL_CALL_START,
            EventType.TOOL_CALL_DELTA,
            EventType.TOOL_CALL_END,
            EventType.MODEL_CALL_END,
        ]

    async def test_thinking_separate_from_answer(self) -> None:
        provider = OpenAIProvider("sk-test")
        _install_responses_stream(provider, _full_stream_events())
        events = await _collect(provider.chat_completion(MESSAGES, "gpt-5.5", stream=True))
        thinking = "".join(e.delta for e in events if e.type == EventType.THINKING_BLOCK_DELTA)
        assert thinking == "thought \n\nsummary"
        result = events[-1].result
        assert result.content == "Answer"
        assert "thought" not in result.content

    async def test_tool_call_and_result(self) -> None:
        provider = OpenAIProvider("sk-test")
        _install_responses_stream(provider, _full_stream_events())
        events = await _collect(provider.chat_completion(MESSAGES, "gpt-5.5", stream=True))
        ends = [e for e in events if e.type == EventType.TOOL_CALL_END]
        assert ends[0].tool_call_id == "call_1"
        assert ends[0].tool_args == {"q": "report"}
        result = events[-1].result
        assert result.stop_reason == "tool_use"
        assert result.tool_calls[0].id == "call_1"
        assert result.tool_calls[0].input == {"q": "report"}

    async def test_reasoning_items_captured_for_refeed(self) -> None:
        provider = OpenAIProvider("sk-test")
        _install_responses_stream(provider, _full_stream_events())
        events = await _collect(provider.chat_completion(MESSAGES, "gpt-5.5", stream=True))
        blocks = events[-1].result.thinking_blocks
        assert blocks[0]["type"] == "openai_reasoning"
        assert blocks[0]["item"]["encrypted_content"] == "enc-blob"

    async def test_usage_split_and_thinking_tokens(self) -> None:
        provider = OpenAIProvider("sk-test")
        _install_responses_stream(provider, _full_stream_events())
        end = (await _collect(provider.chat_completion(MESSAGES, "gpt-5.5", stream=True)))[-1]
        assert end.input_tokens == 10
        assert end.cache_creation_input_tokens == 6
        assert end.cache_read_input_tokens == 4
        assert end.output_tokens == 4
        assert end.thinking_tokens == 5
        assert end.result.cache_creation_input_tokens == 6
        assert end.result.thinking_tokens == 5

    async def test_openrouter_cost_is_captured_from_completed_response(self) -> None:
        provider = OpenRouterProvider("sk-or-v1-0123456789abcdef")
        response = _completed_response([_message_item()], cost="0.019876")
        _install_responses_stream(
            provider,
            [_event("response.completed", response=response)],
        )

        events = await _collect(
            provider.chat_completion(MESSAGES, "openrouter/fusion", stream=True)
        )

        assert events[-1].result.provider_cost_usd == Decimal("0.019876")

    async def test_openrouter_cost_is_captured_without_streaming(self) -> None:
        provider = OpenRouterProvider("sk-or-v1-0123456789abcdef")
        response = _completed_response([_message_item()], cost="0.012345")

        async def _create(**kwargs):
            return response

        provider._client = SimpleNamespace(responses=SimpleNamespace(create=_create))

        result = await provider.chat_completion(MESSAGES, "openrouter/fusion")

        assert result.provider_cost_usd == Decimal("0.012345")

    async def test_refusal_is_streamed_and_returned_as_answer_text(self) -> None:
        provider = OpenAIProvider("sk-test")
        refusal = _refusal_item()
        _install_responses_stream(
            provider,
            [
                _event("response.output_item.added", item=refusal, output_index=0),
                _event(
                    "response.refusal.delta",
                    item_id=refusal.id,
                    delta="I cannot help with that.",
                ),
                _event("response.output_item.done", item=refusal, output_index=0),
                _event(
                    "response.completed",
                    response=_completed_response([refusal]),
                ),
            ],
        )
        events = await _collect(provider.chat_completion(MESSAGES, "gpt-5.6-terra", stream=True))
        assert (
            "".join(event.delta for event in events if event.type is EventType.TEXT_BLOCK_DELTA)
            == "I cannot help with that."
        )
        assert events[-1].result.content == "I cannot help with that."

    async def test_failed_response_emits_only_provider_error(self) -> None:
        provider = OpenAIProvider("sk-test")
        failed = SimpleNamespace(error=SimpleNamespace(message="upstream detail"))
        _install_responses_stream(
            provider,
            [_event("response.failed", response=failed)],
        )
        events = await _collect(provider.chat_completion(MESSAGES, "gpt-5.6-terra", stream=True))
        assert [event.error for event in events if event.type is EventType.ERROR] == [
            "upstream detail"
        ]

    async def test_error_without_completed(self) -> None:
        provider = OpenAIProvider("sk-test")
        _install_responses_stream(
            provider,
            [_event("response.output_text.delta", item_id="x", delta="hi")],
        )
        events = await _collect(provider.chat_completion(MESSAGES, "gpt-5.5", stream=True))
        assert events[-1].type == EventType.ERROR


class TestResponsesRequest:
    def test_reasoning_effort_with_tools(self) -> None:
        kwargs = build_responses_kwargs(
            messages=MESSAGES,
            model="gpt-5.5",
            system="be helpful",
            tools=[{"name": "t", "description": "d", "input_schema": {"type": "object"}}],
            cache_key="agent-1",
            params={"reasoning_effort": "xhigh", "max_tokens": 4096},
            safety_identifier="privacy-digest",
        )
        assert kwargs["reasoning"] == {"effort": "xhigh", "summary": "auto"}
        assert kwargs["include"] == ["reasoning.encrypted_content"]
        assert kwargs["store"] is False
        assert kwargs["instructions"] == "be helpful"
        assert kwargs["max_output_tokens"] == 4096
        assert kwargs["prompt_cache_key"] == "agent-1"
        assert kwargs["safety_identifier"] == "privacy-digest"
        assert kwargs["tools"][0] == {
            "type": "function",
            "name": "t",
            "description": "d",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": False,
            },
            "strict": True,
        }

    def test_strict_tools_make_optional_properties_nullable(self) -> None:
        kwargs = build_responses_kwargs(
            messages=MESSAGES,
            model="gpt-5.6-sol",
            system=None,
            tools=[
                {
                    "name": "notes-search",
                    "description": "Search notes",
                    "input_schema": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string"},
                            "limit": {"type": "integer"},
                        },
                        "required": ["query"],
                    },
                }
            ],
            cache_key=None,
            params=None,
        )

        tool = kwargs["tools"][0]
        assert tool["strict"] is True
        assert tool["parameters"]["required"] == ["query", "limit"]
        assert tool["parameters"]["additionalProperties"] is False
        assert tool["parameters"]["properties"]["limit"]["type"] == [
            "integer",
            "null",
        ]

    def test_off_omits_reasoning(self) -> None:
        kwargs = build_responses_kwargs(
            messages=MESSAGES,
            model="gpt-4o",
            system=None,
            tools=None,
            cache_key=None,
            params={},
        )
        assert "reasoning" not in kwargs
        assert "include" not in kwargs

    def test_assistant_turn_with_refeed_and_tool_use(self) -> None:
        items = convert_messages_to_responses([
            {"role": "user", "content": "do it"},
            {
                "role": "assistant",
                "content": [
                    {"type": "openai_reasoning", "item": {"id": "rs_1", "type": "reasoning"}},
                    {"type": "text", "text": "Working on it"},
                    {"type": "tool_use", "id": "call_1", "name": "t", "input": {"q": 1}},
                ],
            },
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "call_1", "content": "42"},
                ],
            },
        ])
        assert items[0] == {"role": "user", "content": "do it"}
        assert items[1] == {"id": "rs_1", "type": "reasoning"}
        assert items[2]["role"] == "assistant"
        assert items[2]["content"] == [{"type": "output_text", "text": "Working on it"}]
        assert items[3]["type"] == "function_call"
        assert items[3]["call_id"] == "call_1"
        assert items[4] == {
            "type": "function_call_output",
            "call_id": "call_1",
            "output": "42",
        }
