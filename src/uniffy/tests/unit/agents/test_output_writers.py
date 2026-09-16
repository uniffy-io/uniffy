from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from prometheus_client import CollectorRegistry, Counter

from uniffy.core.models.agents.message import AgentMessage, AgentMessageRole
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.types import generate_id
from uniffy.domains.agents.providers.base import CompletionResult, EventType, StreamEvent
from uniffy.domains.agents.runtime import output, publishers, writers
from uniffy.domains.agents.runtime.publishers import ChatStreamPublisher
from uniffy.domains.agents.runtime.runs.complete import CompletionRunner
from uniffy.domains.agents.runtime.runs.segments import stream_segment
from uniffy.domains.agents.runtime.runs.stream import StreamingRunner
from uniffy.domains.agents.runtime.writers import ChatChannelMessageWriter, SessionMessageWriter
from uniffy.domains.agents.tools.definitions import ToolContext
from uniffy.domains.agents.tools.registry import ToolRegistry
from uniffy.domains.chat import agents as chat_events

URN = "urn:uniffy:content:NOTE:019558e0-8700-7000-8000-000000000001"
RAW = f"[Self]: ```markdown\n[[Roadmap|{URN}]]\n```"
EXPECTED = f"[[[Roadmap|{URN}]]]\n"


@pytest.fixture
def chat(monkeypatch):
    rows = {}
    session = MagicMock()
    session.add.side_effect = lambda row: rows.update({row.id: row})
    session.get = AsyncMock(side_effect=lambda _model, identifier: rows.get(identifier))
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    index, resources = AsyncMock(), AsyncMock()
    monkeypatch.setattr(writers, "bump_channel_message_stats", AsyncMock())
    monkeypatch.setattr(writers, "index_agent_message", index)
    monkeypatch.setattr(writers, "track_agent_message_resources", resources)
    counter = Counter(
        "test_repairs", "Repairs", ["kind", "surface", "provider"], registry=CollectorRegistry()
    )
    monkeypatch.setattr(output, "AGENT_OUTPUT_REPAIRS_TOTAL", counter)
    user_id, channel_id, agent_id, trigger_id = [generate_id() for _ in range(4)]
    writer = ChatChannelMessageWriter(
        session=session,
        search_indexer=MagicMock(),
        user_id=user_id,
        organization_id=generate_id(),
        channel_id=channel_id,
        agent_id=agent_id,
        trigger_message_id=trigger_id,
        agent_name="Self",
    )
    publisher = ChatStreamPublisher(
        session=session,
        channel_id=channel_id,
        agent_id=agent_id,
        member_ids=[user_id],
        actor_user_id=user_id,
        trigger_message_id=trigger_id,
        thread_root_id=None,
    )
    fanout = AsyncMock()
    monkeypatch.setattr(publishers, "publish_channel_event_to_members", fanout)
    return SimpleNamespace(
        writer=writer,
        publisher=publisher,
        fanout=fanout,
        rows=rows,
        session=session,
        index=index,
        resources=resources,
        counter=counter,
    )


@pytest.mark.parametrize("path", ["insert", "finalize", "missing_placeholder"])
async def test_chat_storage_references_and_publication_use_repaired_model_output(chat, path):
    completion = CompletionResult(content=RAW, model="mock-model")
    placeholder = None
    if path == "finalize":
        placeholder = await chat.writer.reserve_assistant_placeholder()
        await chat.publisher.publish(StreamEvent(type=EventType.MESSAGE_STORED, message=placeholder))
        await chat.publisher.publish(
            StreamEvent(
                type=EventType.TEXT_BLOCK_DELTA,
                delta=RAW,
                message_id=placeholder.id,
                sequence=1,
            )
        )
        assert chat.fanout.call_args.args[2]["delta"] == RAW
    chat.session.get.reset_mock()
    kwargs = dict(content=completion.content, model=completion.model, provider="openrouter")
    if path == "insert":
        message = await chat.writer.add_message(role=AgentMessageRole.ASSISTANT, **kwargs)
        chat.session.get.assert_not_awaited()
    else:
        identifier = placeholder.id if placeholder else generate_id()
        message = await chat.writer.finalize_assistant_placeholder(message_id=identifier, **kwargs)
        chat.session.get.assert_awaited_once_with(ChatMessage, identifier)
    row = chat.rows[message.id]
    assert row.content == message.content == EXPECTED
    assert row.mentioned_urns == [URN]
    assert "streaming" not in row.message_metadata
    assert chat.index.await_args.args[2].content == EXPECTED
    assert chat.resources.await_args.args[2] == EXPECTED
    for kind in ["fence_unwrap", "mention_brackets", "self_prefix"]:
        assert (
            chat.counter.labels(kind=kind, surface="chat", provider="openrouter")._value.get() == 1
        )
    await chat.publisher.publish(StreamEvent(type=EventType.DONE, assistant_message=message))
    assert chat.fanout.call_args.args[1] == (
        chat_events.MESSAGE_UPDATED if placeholder else chat_events.MESSAGE_CREATED
    )
    assert chat.fanout.call_args.args[2]["content"] == EXPECTED


async def test_intermediate_placeholder_publishes_repaired_text_before_next_model_call(chat):
    placeholder = await chat.writer.reserve_assistant_placeholder()
    await chat.publisher.publish(StreamEvent(type=EventType.MESSAGE_STORED, message=placeholder))
    stored = await chat.writer.finalize_assistant_placeholder(
        message_id=placeholder.id,
        content=RAW,
        model="mock-model",
        provider="openrouter",
    )
    await chat.publisher.publish(StreamEvent(type=EventType.MESSAGE_STORED, message=stored))
    assert chat.fanout.call_args.args[1] == chat_events.MESSAGE_UPDATED
    assert chat.fanout.call_args.args[2]["content"] == EXPECTED
    assert chat.fanout.call_args_list[-2].args[2]["final"] is True


@pytest.mark.parametrize(
    "role", [AgentMessageRole.USER, AgentMessageRole.TOOL, AgentMessageRole.SUMMARY]
)
async def test_chat_does_not_normalize_non_answer_rows(chat, role):
    message = await chat.writer.add_message(role=role, content=RAW)
    assert message.content == RAW
    assert not [sample for family in chat.counter.collect() for sample in family.samples]


@pytest.mark.parametrize(
    ("role", "thinking", "expected"),
    [
        (AgentMessageRole.ASSISTANT, False, "[Self]: " + EXPECTED.rstrip("\n")),
        (AgentMessageRole.ASSISTANT, True, f"[Self]: [[Roadmap|{URN}]]"),
        (AgentMessageRole.USER, False, f"[Self]: [[Roadmap|{URN}]]"),
        (AgentMessageRole.TOOL, False, f"[Self]: [[Roadmap|{URN}]]"),
        (AgentMessageRole.SUMMARY, False, f"[Self]: [[Roadmap|{URN}]]"),
    ],
)
async def test_session_writer_limits_repairs_to_assistant_text(role, thinking, expected):
    operations = MagicMock()
    operations.add_message = AsyncMock(side_effect=lambda **kwargs: AgentMessage(**kwargs))
    writer = SessionMessageWriter(
        session_ops=operations,
        user_id=generate_id(),
        organization_id=generate_id(),
        session_id=generate_id(),
    )
    message = await writer.add_message(
        role=role,
        content=f"[Self]: [[Roadmap|{URN}]]",
        model="mock-model",
        provider="openrouter",
        is_thinking=thinking,
    )
    assert message.content == expected
    assert operations.add_message.await_args.kwargs["content"] == expected


@pytest.mark.parametrize("streaming", [False, True])
async def test_runners_store_mocked_completion_and_attribute_actual_provider(monkeypatch, streaming):
    import uniffy.domains.agents.runtime.runs.complete as complete_mod
    import uniffy.domains.agents.runtime.runs.stream as stream_mod

    raw = "```md\n[Self]: " + f"[[Roadmap|{URN}]]\n```"
    response = CompletionResult(content=raw, model="fallback-model")
    controller = SimpleNamespace(
        target=SimpleNamespace(provider_name="openrouter"),
        complete=AsyncMock(return_value=response),
    )
    module = stream_mod if streaming else complete_mod
    monkeypatch.setattr(module, "ModelCallController", lambda **_kwargs: controller)
    monkeypatch.setattr(module, "get_runtime_settings", AsyncMock())
    counter = MagicMock()
    monkeypatch.setattr(output, "AGENT_OUTPUT_REPAIRS_TOTAL", counter)
    operations = MagicMock()
    operations.add_message = AsyncMock(side_effect=lambda **kwargs: AgentMessage(**kwargs))
    ctx = ToolContext(session=MagicMock(), user_id=generate_id(), organization_id=generate_id())
    session_id = generate_id()
    kwargs = dict(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        session_id=session_id,
        agent_id=generate_id(),
        provider=SimpleNamespace(name="openai"),
        provider_key_id=None,
        model="primary-model",
        fallback_models=["fallback-model"],
        agent_model_params=None,
        request_params=None,
        system_prompt="system",
        tool_schemas=None,
        llm_messages=[],
        registry=ToolRegistry(),
        tool_context=ctx,
        deferred_pool={},
    )
    recorder = SimpleNamespace(record=AsyncMock())
    if streaming:

        async def model_stream():
            yield StreamEvent(type=EventType.TEXT_BLOCK_DELTA, delta=raw)
            yield StreamEvent(type=EventType.MODEL_CALL_END, result=response)

        async def segment(**segment_kwargs):
            async for event in stream_segment(model_stream(), segment_kwargs["writer"]):
                yield event

        monkeypatch.setattr(stream_mod, "controlled_stream_segment", segment)
        runner = StreamingRunner(
            session=ctx.session,
            provider_operations=MagicMock(),
            recorder=recorder,
            tool_loop=MagicMock(),
        )
        writer = SessionMessageWriter(
            session_ops=operations,
            user_id=ctx.user_id,
            organization_id=ctx.organization_id,
            session_id=session_id,
        )
        events = [
            event
            async for event in runner.run(
                **kwargs,
                writer=writer,
                channel_id=None,
                params_override=None,
            )
        ]
        assert (
            next(event.delta for event in events if event.type == EventType.TEXT_BLOCK_DELTA) == raw
        )
        message = events[-1].assistant_message
        assert events[-1].type == EventType.DONE
    else:
        runner = CompletionRunner(
            session=ctx.session,
            session_operations=operations,
            session_factory=MagicMock(),
            provider_operations=MagicMock(),
            recorder=recorder,
        )
        message, model = await runner.run(**kwargs)
        assert model == "fallback-model"
    assert message.content == "[Self]: " + EXPECTED
    assert operations.add_message.await_args.kwargs["content"] == message.content
    assert response.content == raw
    assert {call.kwargs["provider"] for call in counter.labels.call_args_list} == {"openrouter"}
    assert {call.kwargs["surface"] for call in counter.labels.call_args_list} == {"session"}
