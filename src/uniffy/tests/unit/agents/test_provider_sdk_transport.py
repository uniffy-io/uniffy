from functools import partial

import anthropic
import httpx
import httpx2
import openai
import pytest
from google import genai
from google.genai import types

from uniffy.core.json_codec import dumps_bytes, loads
from uniffy.domains.agents.providers.anthropic.provider import AnthropicProvider
from uniffy.domains.agents.providers.base import EventType, LLMProvider
from uniffy.domains.agents.providers.catalog import get_parameter_schema, resolve_request_params
from uniffy.domains.agents.providers.google.provider import GoogleProvider
from uniffy.domains.agents.providers.openai.provider import OpenAIProvider
from uniffy.domains.agents.providers.openrouter.provider import OpenRouterProvider
from uniffy.domains.agents.providers.xai.provider import XAIProvider


@pytest.mark.parametrize(
    "provider_type", [AnthropicProvider, OpenAIProvider, OpenRouterProvider, XAIProvider]
)
@pytest.mark.parametrize("stream", [False, True])
async def test_sdk_serializes_and_parses_provider_calls(
    monkeypatch: pytest.MonkeyPatch, provider_type: type[LLMProvider], stream: bool
) -> None:
    requests = []
    anthropic_call = provider_type is AnthropicProvider
    responses_call = provider_type is OpenAIProvider
    model = "claude-sonnet-4-6" if anthropic_call else "gpt-4o"
    if anthropic_call:
        payload = {
            "id": "msg_test",
            "type": "message",
            "role": "assistant",
            "model": model,
            "content": [{"type": "text", "text": "Hello"}],
            "stop_reason": "end_turn",
            "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 2},
        }
        events = [
            {"type": "message_start", "message": {**payload, "content": [], "stop_reason": None}},
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "text", "text": ""},
            },
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": "Hello"},
            },
            {"type": "content_block_stop", "index": 0},
            {
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                "usage": {"output_tokens": 2},
            },
            {"type": "message_stop"},
        ]
    elif responses_call:
        item = {
            "type": "message",
            "id": "message_test",
            "role": "assistant",
            "status": "completed",
            "content": [{"type": "output_text", "text": "Hello", "annotations": []}],
        }
        payload = {
            "id": "resp_test",
            "object": "response",
            "created_at": 1,
            "model": model,
            "status": "completed",
            "output": [item],
            "usage": {"input_tokens": 10, "output_tokens": 2, "total_tokens": 12},
        }
        events = [
            {
                "type": "response.output_item.added",
                "output_index": 0,
                "item": {**item, "content": []},
            },
            {
                "type": "response.output_text.delta",
                "item_id": item["id"],
                "output_index": 0,
                "content_index": 0,
                "delta": "Hello",
            },
            {"type": "response.output_item.done", "output_index": 0, "item": item},
            {"type": "response.completed", "response": payload},
        ]
    else:
        payload = {
            "id": "chat_test",
            "object": "chat.completion",
            "created": 1,
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Hello"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12},
        }
        events = [
            {
                **payload,
                "object": "chat.completion.chunk",
                "choices": [{"index": 0, "delta": {"content": "Hello"}, "finish_reason": "stop"}],
            }
        ]

    def respond(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        if stream:
            content = b"".join(
                (f"event: {event['type']}\n".encode() if "type" in event else b"")
                + b"data: "
                + dumps_bytes(event)
                + b"\n\n"
                for event in events
            )
            return httpx2.Response(
                200, content=content, headers={"content-type": "text/event-stream"}
            )
        return httpx2.Response(200, json=payload)

    sdk = anthropic if anthropic_call else openai
    constructor = "AsyncAnthropic" if anthropic_call else "AsyncOpenAI"
    client_type = getattr(sdk, constructor)
    http_client = sdk.DefaultAsyncHttpxClient(transport=httpx2.MockTransport(respond))
    monkeypatch.setattr(
        sdk, constructor, partial(client_type, http_client=http_client, max_retries=0)
    )
    provider = provider_type("test-key")
    try:
        result = await provider.chat_completion(
            [{"role": "user", "content": "Hi"}],
            model,
            stream=stream,
            params={"temperature": 0.3} if anthropic_call else None,
        )
        if stream:
            emitted = [event async for event in result]
            assert emitted[-1].type is EventType.MODEL_CALL_END
            result = emitted[-1].result
        assert result.content == "Hello"
        assert result.input_tokens == 10
        assert result.output_tokens == 2
        assert requests[0].headers["authorization"] == "Bearer test-key"
        body = loads(requests[0].content)
        if anthropic_call:
            assert requests[0].headers["anthropic-version"] == "2026-10-21"
            assert "temperature" not in body
        if responses_call:
            assert body["store"] is False
    finally:
        await provider._client.close()


@pytest.mark.parametrize("stream", [False, True])
async def test_google_sdk_serializes_and_parses_provider_calls(
    monkeypatch: pytest.MonkeyPatch, stream: bool
) -> None:
    requests = []
    payload = {
        "candidates": [
            {"content": {"role": "model", "parts": [{"text": "Hello"}]}, "finishReason": "STOP"}
        ],
        "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 2, "totalTokenCount": 12},
    }

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if stream:
            return httpx.Response(
                200,
                content=b"data: " + dumps_bytes(payload) + b"\n\n",
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(200, json=payload)

    client_type = genai.Client
    options = types.HttpOptions(async_client_args={"transport": httpx.MockTransport(respond)})
    monkeypatch.setattr(genai, "Client", partial(client_type, http_options=options))
    provider = GoogleProvider("test-key")
    try:
        result = await provider.chat_completion(
            [{"role": "user", "content": "Hi"}], "gemini-2.5-flash", stream=stream
        )
        if stream:
            emitted = [event async for event in result]
            assert emitted[-1].type is EventType.MODEL_CALL_END
            result = emitted[-1].result
        assert result.content == "Hello"
        assert result.input_tokens == 10
        assert result.output_tokens == 2
        assert requests[0].headers["x-goog-api-key"] == "test-key"
    finally:
        await provider._client.aio.aclose()
        provider._client.close()


def test_anthropic_schema_excludes_removed_sampling_controls() -> None:
    schema = get_parameter_schema("anthropic", "claude-sonnet-4-6")
    assert not {"temperature", "top_p", "top_k"} & schema.keys()


def test_saved_anthropic_sampling_is_stripped_before_dispatch() -> None:
    params = resolve_request_params(
        {"temperature": 0.3, "top_p": 0.9, "max_tokens": 1234},
        {"provider_options": {"top_k": 40}},
        "anthropic",
        "claude-sonnet-4-6",
    )
    assert params == {"max_tokens": 1234}
