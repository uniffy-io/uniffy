"""Agent runtime context construction parity."""

import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.models.agents.memory import MemoryScope
from uniffy.core.models.agents.message import AgentMessage, AgentMessageRole
from uniffy.core.models.chat.channel import ChannelType
from uniffy.core.models.chat.message import SenderType
from uniffy.core.types import SubjectType, generate_id
from uniffy.domains.agents.memories.scope import MemoryScopeRef
from uniffy.domains.agents.runtime.context.chat import ChatContextBuilder
from uniffy.domains.agents.runtime.context.memory import MemoryContextBuilder
from uniffy.domains.agents.runtime.context.messages import (
    build_llm_messages,
    build_stored_content,
    resolve_pending_content_blocks,
)
from uniffy.domains.agents.runtime.destinations import ChatDestination, SessionDestination
from uniffy.domains.agents.runtime.files import FileContext


def _message(role: AgentMessageRole, **values) -> AgentMessage:
    return AgentMessage(session_id=generate_id(), role=role, **values)


def _file(**values) -> FileContext:
    defaults = {
        "file_id": str(generate_id()),
        "media_type": "image/png",
        "filename": "roadmap.png",
        "storage_key": "files/roadmap.png",
        "extracted_text": None,
        "extraction_status": "completed",
    }
    defaults.update(values)
    return FileContext(**defaults)


def test_history_conversion_preserves_tool_pairs_and_repairs_orphans() -> None:
    context = [
        _message(AgentMessageRole.SUMMARY, content="Earlier work"),
        _message(
            AgentMessageRole.ASSISTANT,
            content="Checking",
            tool_call_id="call-1",
            tool_name="notes.search",
            tool_args={"query": "roadmap"},
        ),
        _message(
            AgentMessageRole.TOOL,
            tool_call_id="call-1",
            tool_name="notes.search",
            tool_result="Found one",
        ),
        _message(
            AgentMessageRole.ASSISTANT,
            tool_call_id="call-2",
            tool_name="files.read",
            tool_args={"id": "file-1"},
        ),
        _message(AgentMessageRole.SYSTEM, content="not re-fed"),
        _message(AgentMessageRole.ASSISTANT, content="Previous answer"),
    ]

    messages = build_llm_messages(context, "Next question")

    assert messages == [
        {"role": "user", "content": "[Previous conversation summary]\nEarlier work"},
        {
            "role": "assistant",
            "content": [
                {"type": "text", "text": "Checking"},
                {
                    "type": "tool_use",
                    "id": "call-1",
                    "name": "notes-search",
                    "input": {"query": "roadmap"},
                },
            ],
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "call-1",
                    "content": "Found one",
                    "tool_name": "notes.search",
                }
            ],
        },
        {
            "role": "assistant",
            "content": [
                {
                    "type": "tool_use",
                    "id": "call-2",
                    "name": "files-read",
                    "input": {"id": "file-1"},
                }
            ],
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "call-2",
                    "content": "Error: tool execution was interrupted.",
                    "is_error": True,
                }
            ],
        },
        {"role": AgentMessageRole.ASSISTANT, "content": "Previous answer"},
        {"role": "user", "content": "Next question"},
    ]


def test_rerun_context_does_not_append_a_duplicate_trigger_turn() -> None:
    anchor = _message(AgentMessageRole.USER, content="Edited anchor")

    assert build_llm_messages([anchor], "", append_new=False) == [
        {"role": AgentMessageRole.USER, "content": "Edited anchor"}
    ]


def test_file_context_and_stored_message_keep_distinct_payloads() -> None:
    image = _file(filename="Design | plan.png")
    text = _file(
        media_type="text/plain",
        filename="brief.txt",
        storage_key="files/brief.txt",
        extracted_text="Ship on Friday",
    )

    messages = build_llm_messages([], "Review these", files=[image, text])
    stored = build_stored_content("Review these", [image, text])

    assert messages[-1]["content"] == [
        {
            "type": "image",
            "media_type": "image/png",
            "storage_key": "files/roadmap.png",
        },
        {
            "type": "text",
            "text": "--- File: brief.txt ---\nShip on Friday\n--- End of brief.txt ---",
        },
        {"type": "text", "text": "Review these"},
    ]
    assert stored == (
        f"[[[Design plan.png|urn:uniffy:content:FILE:{image.file_id}]]]\n\n"
        f"[[[brief.txt|urn:uniffy:content:FILE:{text.file_id}]]]\n"
        "--- File: brief.txt ---\nShip on Friday\n--- End of brief.txt ---\n\nReview these"
    )


async def test_storage_backed_blocks_resolve_to_inline_bytes() -> None:
    storage = MagicMock()
    storage.download_bytes = AsyncMock(side_effect=[b"image", b"document"])
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "media_type": "image/png",
                    "storage_key": "image-key",
                },
                {
                    "type": "document",
                    "media_type": "application/pdf",
                    "storage_key": "document-key",
                    "filename": "brief.pdf",
                },
            ],
        }
    ]

    await resolve_pending_content_blocks(storage, messages)

    assert messages[0]["content"] == [
        {
            "type": "image",
            "media_type": "image/png",
            "data": base64.b64encode(b"image").decode("ascii"),
        },
        {
            "type": "document",
            "media_type": "application/pdf",
            "data": base64.b64encode(b"document").decode("ascii"),
            "filename": "brief.pdf",
        },
    ]
    assert storage.download_bytes.await_args_list[0].args == ("image-key",)
    assert storage.download_bytes.await_args_list[1].args == ("document-key",)


async def test_memory_context_reads_org_agent_surface_and_bridge_in_order() -> None:
    session = MagicMock()
    organization_id = generate_id()
    agent_id = generate_id()
    surface = MemoryScopeRef.channel(generate_id())
    bridge = MemoryScopeRef.user(generate_id())
    captured: list[MemoryScopeRef] = []

    async def fetch(_session, *, organization_id, scope_ref):
        captured.append(scope_ref)
        return {
            "pinned": [],
            "index": [
                {
                    "key": scope_ref.scope.value,
                    "category": "facts",
                    "description": f"{scope_ref.scope.value} entry",
                }
            ],
            "total": 1,
        }

    with patch(
        "uniffy.domains.agents.runtime.context.memory.fetch_memory_index",
        fetch,
    ):
        context = await MemoryContextBuilder(session).build_context(
            agent_id=agent_id,
            organization_id=organization_id,
            scope_ref=surface,
            bridge_ref=bridge,
        )

    assert captured == [
        MemoryScopeRef.org(),
        MemoryScopeRef.org(agent_id),
        surface,
        bridge,
    ]
    assert context is not None
    assert "Organization memory" in context
    assert "Channel memory" in context
    assert "they opted in" in context


async def test_memory_and_chat_context_degrade_without_blocking_a_run() -> None:
    session = MagicMock()
    session.get = AsyncMock(side_effect=RuntimeError("database unavailable"))
    memory = MemoryContextBuilder(session)

    with patch(
        "uniffy.domains.agents.runtime.context.memory.fetch_memory_index",
        AsyncMock(side_effect=RuntimeError("cache unavailable")),
    ):
        memory_context = await memory.build_context(
            agent_id=generate_id(),
            organization_id=generate_id(),
            scope_ref=MemoryScopeRef(MemoryScope.CHANNEL, generate_id()),
        )

    destination = ChatDestination(
        channel_id=generate_id(),
        agent_id=generate_id(),
        trigger_message_id=generate_id(),
    )
    chat_context = await ChatContextBuilder(session).build_channel(
        destination=destination,
        trigger_user_name="Alice",
    )

    assert memory_context is None
    assert chat_context is None


async def test_chat_context_excludes_current_agent_and_orients_the_trigger() -> None:
    current_agent_id = generate_id()
    other_agent_id = generate_id()
    trigger_user_id = generate_id()
    other_user_id = generate_id()
    destination = ChatDestination(
        channel_id=generate_id(),
        agent_id=current_agent_id,
        trigger_message_id=generate_id(),
        trigger_rule="mention",
    )
    session = MagicMock()
    session.get = AsyncMock(
        return_value=SimpleNamespace(
            channel_type=ChannelType.PRIVATE,
            name="Delivery",
            description="Release coordination",
        )
    )
    members = [
        SimpleNamespace(subject_type=SubjectType.USER, subject_id=trigger_user_id),
        SimpleNamespace(subject_type=SubjectType.USER, subject_id=other_user_id),
        SimpleNamespace(subject_type=SubjectType.AGENT, subject_id=current_agent_id),
        SimpleNamespace(subject_type=SubjectType.AGENT, subject_id=other_agent_id),
    ]
    rows = MagicMock()
    rows.scalars.return_value.all.return_value = members
    session.execute = AsyncMock(return_value=rows)
    resolver = MagicMock()
    resolver.resolve_many = AsyncMock(
        return_value={
            trigger_user_id: SimpleNamespace(id=trigger_user_id, display_name="Alice"),
            other_user_id: SimpleNamespace(id=other_user_id, display_name="Bob"),
            current_agent_id: SimpleNamespace(id=current_agent_id, display_name="Helper"),
            other_agent_id: SimpleNamespace(id=other_agent_id, display_name="Reviewer"),
        }
    )

    with patch(
        "uniffy.domains.agents.runtime.context.chat.SenderResolver",
        return_value=resolver,
    ):
        context = await ChatContextBuilder(session).build_channel(
            destination=destination,
            trigger_user_name="Alice",
        )

    assert context is not None
    assert 'private channel "Delivery"' in context
    assert "users: Bob" in context
    assert "other agents: Reviewer" in context
    assert "Helper" not in context
    assert "triggered by Alice via an @-mention in a channel message" in context


async def test_thread_context_is_ephemeral_bounded_and_session_safe() -> None:
    session = MagicMock()
    root_author_id = generate_id()
    root = SimpleNamespace(
        sender_type=SenderType.USER,
        sender_id=root_author_id,
        content="  A   long root " + "x" * 200,
    )
    session.get = AsyncMock(return_value=root)
    resolver = MagicMock()
    resolver.resolve_one = AsyncMock(return_value=SimpleNamespace(display_name="Alice"))
    builder = ChatContextBuilder(session)
    destination = ChatDestination(
        channel_id=generate_id(),
        agent_id=generate_id(),
        trigger_message_id=generate_id(),
        thread_root_id=generate_id(),
    )

    with patch(
        "uniffy.domains.agents.runtime.context.chat.SenderResolver",
        return_value=resolver,
    ):
        note = await builder.build_thread(destination)

    assert note is not None
    assert "opened by Alice" in note
    assert "..." in note
    assert await builder.build_thread(SessionDestination(generate_id())) is None
