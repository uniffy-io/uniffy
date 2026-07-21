"""Fixture tests for the unified block-framed provider stream protocol.

Every provider parser must emit the same EventType sequence shape from
its native stream: MODEL_CALL_START, block START/DELTA/END framing with
consistent block_ids, and a terminal MODEL_CALL_END carrying the
CompletionResult. Thinking must never leak into answer text.
No network; SDK clients are replaced with canned streams.
"""

import asyncio
from types import SimpleNamespace

from uniffy.domains.agents.providers.anthropic.provider import AnthropicProvider
from uniffy.domains.agents.providers.base import EventType, StreamEvent
from uniffy.domains.agents.providers.google.provider import GoogleProvider
from uniffy.domains.agents.providers.openrouter.provider import OpenRouterProvider
from uniffy.domains.agents.providers.xai.provider import XAIProvider

MESSAGES = [{"role": "user", "content": "hi"}]


def _collect(coro_stream) -> list[StreamEvent]:
    async def _run() -> list[StreamEvent]:
        stream = await coro_stream
        return [event async for event in stream]

    return asyncio.run(_run())


def _types(events: list[StreamEvent]) -> list[EventType]:
    return [event.type for event in events]


def _only(events: list[StreamEvent], event_type: EventType) -> list[StreamEvent]:
    return [e for e in events if e.type is event_type]


class _FakeAnthropicStream:
    def __init__(self, events: list, final: SimpleNamespace) -> None:
        self._events = events
        self._final = final

    async def __aenter__(self) -> _FakeAnthropicStream:
        return self

    async def __aexit__(self, *args) -> bool:
        return False

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for event in self._events:
            yield event

    async def get_final_message(self) -> SimpleNamespace:
        return self._final


def _anthropic_events() -> list:
    return [
        SimpleNamespace(
            type="content_block_start",
            index=0,
            content_block=SimpleNamespace(type="thinking"),
        ),
        SimpleNamespace(
            type="content_block_delta",
            index=0,
            delta=SimpleNamespace(type="thinking_delta", thinking="pondering "),
        ),
        SimpleNamespace(
            type="content_block_delta",
            index=0,
            delta=SimpleNamespace(type="thinking_delta", thinking="deeply"),
        ),
        SimpleNamespace(
            type="content_block_delta",
            index=0,
            delta=SimpleNamespace(type="signature_delta", signature="sig-abc"),
        ),
        SimpleNamespace(
            type="content_block_stop",
            index=0,
            content_block=SimpleNamespace(type="thinking"),
        ),
        SimpleNamespace(
            type="content_block_start",
            index=1,
            content_block=SimpleNamespace(type="text"),
        ),
        SimpleNamespace(
            type="content_block_delta",
            index=1,
            delta=SimpleNamespace(type="text_delta", text="Hello"),
        ),
        SimpleNamespace(
            type="content_block_delta",
            index=1,
            delta=SimpleNamespace(type="text_delta", text=" world"),
        ),
        SimpleNamespace(
            type="content_block_stop",
            index=1,
            content_block=SimpleNamespace(type="text"),
        ),
        SimpleNamespace(
            type="content_block_start",
            index=2,
            content_block=SimpleNamespace(
                type="tool_use", id="tc_1", name="notes.read_note"
            ),
        ),
        SimpleNamespace(
            type="content_block_delta",
            index=2,
            delta=SimpleNamespace(type="input_json_delta", partial_json='{"note_id"'),
        ),
        SimpleNamespace(
            type="content_block_delta",
            index=2,
            delta=SimpleNamespace(type="input_json_delta", partial_json=': "n1"}'),
        ),
        SimpleNamespace(
            type="content_block_stop",
            index=2,
            content_block=SimpleNamespace(
                type="tool_use", id="tc_1", name="notes.read_note",
                input={"note_id": "n1"},
            ),
        ),
    ]


def _anthropic_final() -> SimpleNamespace:
    return SimpleNamespace(
        model="claude-sonnet-4-6",
        stop_reason="tool_use",
        usage=SimpleNamespace(
            input_tokens=10,
            output_tokens=5,
            cache_read_input_tokens=3,
            cache_creation_input_tokens=0,
        ),
    )


def _make_anthropic(events: list | None = None) -> AnthropicProvider:
    provider = AnthropicProvider("sk-ant-api03-test")
    fake = _FakeAnthropicStream(
        events if events is not None else _anthropic_events(), _anthropic_final()
    )
    provider._client = SimpleNamespace(
        messages=SimpleNamespace(stream=lambda **kwargs: fake)
    )
    return provider


class TestAnthropicStream:
    def test_event_sequence(self) -> None:
        events = _collect(
            _make_anthropic().chat_completion(MESSAGES, "claude-sonnet-4-6", stream=True)
        )
        assert _types(events) == [
            EventType.MODEL_CALL_START,
            EventType.THINKING_BLOCK_START,
            EventType.THINKING_BLOCK_DELTA,
            EventType.THINKING_BLOCK_DELTA,
            EventType.THINKING_BLOCK_END,
            EventType.TEXT_BLOCK_START,
            EventType.TEXT_BLOCK_DELTA,
            EventType.TEXT_BLOCK_DELTA,
            EventType.TEXT_BLOCK_END,
            EventType.TOOL_CALL_START,
            EventType.TOOL_CALL_DELTA,
            EventType.TOOL_CALL_DELTA,
            EventType.TOOL_CALL_END,
            EventType.MODEL_CALL_END,
        ]

    def test_thinking_never_in_answer_content(self) -> None:
        events = _collect(
            _make_anthropic().chat_completion(MESSAGES, "claude-sonnet-4-6", stream=True)
        )
        result = events[-1].result
        assert result.content == "Hello world"
        assert "pondering" not in result.content

    def test_block_ids_consistent_and_distinct(self) -> None:
        events = _collect(
            _make_anthropic().chat_completion(MESSAGES, "claude-sonnet-4-6", stream=True)
        )
        thinking_ids = {
            e.block_id
            for e in events
            if e.type
            in (
                EventType.THINKING_BLOCK_START,
                EventType.THINKING_BLOCK_DELTA,
                EventType.THINKING_BLOCK_END,
            )
        }
        text_ids = {
            e.block_id
            for e in events
            if e.type
            in (
                EventType.TEXT_BLOCK_START,
                EventType.TEXT_BLOCK_DELTA,
                EventType.TEXT_BLOCK_END,
            )
        }
        assert len(thinking_ids) == 1
        assert len(text_ids) == 1
        assert thinking_ids != text_ids

    def test_signature_captured_on_thinking_end(self) -> None:
        events = _collect(
            _make_anthropic().chat_completion(MESSAGES, "claude-sonnet-4-6", stream=True)
        )
        end = _only(events, EventType.THINKING_BLOCK_END)[0]
        assert end.signature == "sig-abc"

    def test_tool_call_end_and_result(self) -> None:
        events = _collect(
            _make_anthropic().chat_completion(MESSAGES, "claude-sonnet-4-6", stream=True)
        )
        end = _only(events, EventType.TOOL_CALL_END)[0]
        assert end.tool_call_id == "tc_1"
        assert end.tool_name == "notes.read_note"
        assert end.tool_args == {"note_id": "n1"}
        result = events[-1].result
        assert [tc.id for tc in result.tool_calls] == ["tc_1"]
        assert result.stop_reason == "tool_use"

    def test_usage_on_model_call_end(self) -> None:
        events = _collect(
            _make_anthropic().chat_completion(MESSAGES, "claude-sonnet-4-6", stream=True)
        )
        end = events[-1]
        assert end.type is EventType.MODEL_CALL_END
        assert end.input_tokens == 10
        assert end.output_tokens == 5
        assert end.cache_read_input_tokens == 3
        assert end.model == "claude-sonnet-4-6"

    def test_error_event_on_exception(self) -> None:
        provider = AnthropicProvider("sk-ant-api03-test")

        def _boom(**kwargs):
            raise RuntimeError("api down")

        provider._client = SimpleNamespace(
            messages=SimpleNamespace(stream=_boom)
        )
        events = _collect(
            provider.chat_completion(MESSAGES, "claude-sonnet-4-6", stream=True)
        )
        assert _types(events) == [EventType.ERROR]
        assert "api down" in events[0].error


def _openai_chunk(
    *,
    content: str | None = None,
    reasoning_attr: str | None = None,
    reasoning: str | None = None,
    tool_calls: list | None = None,
    finish_reason: str | None = None,
    usage: SimpleNamespace | None = None,
) -> SimpleNamespace:
    delta = SimpleNamespace(content=content, tool_calls=tool_calls)
    if reasoning_attr:
        setattr(delta, reasoning_attr, reasoning)
    return SimpleNamespace(
        usage=usage,
        model="gpt-test",
        choices=[SimpleNamespace(delta=delta, finish_reason=finish_reason)],
    )


def _openai_usage() -> SimpleNamespace:
    return SimpleNamespace(
        prompt_tokens=20,
        completion_tokens=7,
        prompt_tokens_details=SimpleNamespace(cached_tokens=4),
    )


def _openai_tool_delta(idx: int, tc_id: str | None, name: str | None, args: str | None):
    return SimpleNamespace(
        index=idx,
        id=tc_id,
        function=SimpleNamespace(name=name, arguments=args),
    )


def _install_openai_stream(provider, chunks: list) -> None:
    async def _gen():
        for chunk in chunks:
            yield chunk

    async def _create(**kwargs):
        return _gen()

    provider._client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=_create))
    )


def _openai_reasoning_chunks(reasoning_attr: str) -> list:
    return [
        _openai_chunk(reasoning_attr=reasoning_attr, reasoning="chain "),
        _openai_chunk(reasoning_attr=reasoning_attr, reasoning="of thought"),
        _openai_chunk(content="Answer"),
        _openai_chunk(content=" text"),
        _openai_chunk(finish_reason="stop"),
        SimpleNamespace(usage=_openai_usage(), model="gpt-test", choices=[]),
    ]


class TestOpenAIFamilyStream:
    def test_reasoning_content_becomes_thinking_blocks(self) -> None:
        provider = OpenRouterProvider("sk-or-v1-0123456789abcdef")
        _install_openai_stream(provider, _openai_reasoning_chunks("reasoning_content"))
        events = _collect(provider.chat_completion(MESSAGES, "gpt-test", stream=True))
        assert _types(events) == [
            EventType.MODEL_CALL_START,
            EventType.THINKING_BLOCK_START,
            EventType.THINKING_BLOCK_DELTA,
            EventType.THINKING_BLOCK_DELTA,
            EventType.THINKING_BLOCK_END,
            EventType.TEXT_BLOCK_START,
            EventType.TEXT_BLOCK_DELTA,
            EventType.TEXT_BLOCK_DELTA,
            EventType.TEXT_BLOCK_END,
            EventType.MODEL_CALL_END,
        ]
        thinking = "".join(
            e.delta for e in _only(events, EventType.THINKING_BLOCK_DELTA)
        )
        assert thinking == "chain of thought"

    def test_openrouter_reasoning_field_via_inheritance(self) -> None:
        provider = OpenRouterProvider("sk-or-v1-0123456789abcdef")
        _install_openai_stream(provider, _openai_reasoning_chunks("reasoning"))
        events = _collect(provider.chat_completion(MESSAGES, "gpt-test", stream=True))
        deltas = _only(events, EventType.THINKING_BLOCK_DELTA)
        assert "".join(e.delta for e in deltas) == "chain of thought"

    def test_xai_reasoning_content_via_inheritance(self) -> None:
        provider = XAIProvider("xai-0123456789abcdef1234")
        _install_openai_stream(
            provider, _openai_reasoning_chunks("reasoning_content")
        )
        events = _collect(provider.chat_completion(MESSAGES, "gpt-test", stream=True))
        assert _only(events, EventType.THINKING_BLOCK_DELTA)

    def test_thinking_never_in_answer_content(self) -> None:
        provider = OpenRouterProvider("sk-or-v1-0123456789abcdef")
        _install_openai_stream(provider, _openai_reasoning_chunks("reasoning_content"))
        events = _collect(provider.chat_completion(MESSAGES, "gpt-test", stream=True))
        result = events[-1].result
        assert result.content == "Answer text"
        assert "chain" not in result.content

    def test_tool_call_blocks_with_arg_deltas(self) -> None:
        provider = OpenRouterProvider("sk-or-v1-0123456789abcdef")
        chunks = [
            _openai_chunk(content="Using a tool"),
            _openai_chunk(
                tool_calls=[_openai_tool_delta(0, "call_1", "files.search", '{"q"')]
            ),
            _openai_chunk(
                tool_calls=[_openai_tool_delta(0, None, None, ': "report"}')]
            ),
            _openai_chunk(finish_reason="tool_calls"),
            SimpleNamespace(usage=_openai_usage(), model="gpt-test", choices=[]),
        ]
        _install_openai_stream(provider, chunks)
        events = _collect(provider.chat_completion(MESSAGES, "gpt-test", stream=True))
        starts = _only(events, EventType.TOOL_CALL_START)
        deltas = _only(events, EventType.TOOL_CALL_DELTA)
        ends = _only(events, EventType.TOOL_CALL_END)
        assert len(starts) == 1
        assert starts[0].tool_call_id == "call_1"
        assert starts[0].tool_name == "files.search"
        assert "".join(e.delta for e in deltas) == '{"q": "report"}'
        assert ends[0].tool_args == {"q": "report"}
        assert {e.block_id for e in starts + deltas + ends} == {starts[0].block_id}
        result = events[-1].result
        assert result.stop_reason == "tool_use"
        assert result.tool_calls[0].input == {"q": "report"}

    def test_usage_split_on_model_call_end(self) -> None:
        provider = OpenRouterProvider("sk-or-v1-0123456789abcdef")
        _install_openai_stream(provider, _openai_reasoning_chunks("reasoning_content"))
        events = _collect(provider.chat_completion(MESSAGES, "gpt-test", stream=True))
        end = events[-1]
        assert end.input_tokens == 16
        assert end.cache_read_input_tokens == 4
        assert end.output_tokens == 7

    def test_error_event_on_exception(self) -> None:
        provider = OpenRouterProvider("sk-or-v1-0123456789abcdef")

        async def _create(**kwargs):
            raise RuntimeError("quota")

        provider._client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=_create))
        )
        events = _collect(provider.chat_completion(MESSAGES, "gpt-test", stream=True))
        assert _types(events) == [EventType.ERROR]
        assert "quota" in events[0].error


def _google_part(
    *,
    text: str | None = None,
    thought: bool = False,
    function_call: SimpleNamespace | None = None,
    thought_signature: bytes | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        text=text,
        thought=thought,
        function_call=function_call,
        thought_signature=thought_signature,
    )


def _google_chunk(parts: list, usage: SimpleNamespace | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        usage_metadata=usage,
        candidates=[SimpleNamespace(content=SimpleNamespace(parts=parts))],
    )


def _install_google_stream(provider: GoogleProvider, chunks: list) -> None:
    async def _gen():
        for chunk in chunks:
            yield chunk

    async def _stream(**kwargs):
        return _gen()

    provider._client = SimpleNamespace(
        aio=SimpleNamespace(
            models=SimpleNamespace(generate_content_stream=_stream)
        )
    )


class TestGoogleStream:
    def _events(self) -> list[StreamEvent]:
        provider = GoogleProvider("google-test-key")
        usage = SimpleNamespace(
            prompt_token_count=30,
            candidates_token_count=9,
            cached_content_token_count=0,
        )
        chunks = [
            _google_chunk([_google_part(text="mulling ", thought=True)]),
            _google_chunk([_google_part(text="it over", thought=True)]),
            _google_chunk([_google_part(text="The answer")]),
            _google_chunk(
                [
                    _google_part(
                        function_call=SimpleNamespace(
                            name="calendar.list_events", args={"day": "today"}
                        ),
                        thought_signature=b"gsig",
                    )
                ],
                usage=usage,
            ),
        ]
        _install_google_stream(provider, chunks)
        return _collect(
            provider.chat_completion(MESSAGES, "gemini-2.5-pro", stream=True)
        )

    def test_thought_parts_become_thinking_blocks(self) -> None:
        events = self._events()
        assert _types(events) == [
            EventType.MODEL_CALL_START,
            EventType.THINKING_BLOCK_START,
            EventType.THINKING_BLOCK_DELTA,
            EventType.THINKING_BLOCK_DELTA,
            EventType.THINKING_BLOCK_END,
            EventType.TEXT_BLOCK_START,
            EventType.TEXT_BLOCK_DELTA,
            EventType.TOOL_CALL_START,
            EventType.TOOL_CALL_END,
            EventType.TEXT_BLOCK_END,
            EventType.MODEL_CALL_END,
        ]

    def test_thought_text_filtered_from_answer(self) -> None:
        events = self._events()
        result = events[-1].result
        assert result.content == "The answer"
        assert "mulling" not in result.content

    def test_tool_call_carries_thought_signature_metadata(self) -> None:
        events = self._events()
        result = events[-1].result
        assert result.tool_calls[0].metadata == {"thought_signature": b"gsig"}
        end = _only(events, EventType.TOOL_CALL_END)[0]
        assert end.tool_args == {"day": "today"}

    def test_error_event_on_exception(self) -> None:
        provider = GoogleProvider("google-test-key")

        async def _stream(**kwargs):
            raise RuntimeError("blocked")

        provider._client = SimpleNamespace(
            aio=SimpleNamespace(
                models=SimpleNamespace(generate_content_stream=_stream)
            )
        )
        events = _collect(
            provider.chat_completion(MESSAGES, "gemini-2.5-pro", stream=True)
        )
        assert _types(events) == [EventType.ERROR]
        assert "blocked" in events[0].error
