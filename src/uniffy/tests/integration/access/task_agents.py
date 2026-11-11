"""An org with agents, a scripted model and one project task, for agent assignment suites."""

from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID

import pytest_asyncio
from sqlalchemy import delete, select

from uniffy.core.database import SESSION_FACTORY_CTX_KEY
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.models.agents.provider_key import ProviderKey
from uniffy.core.models.agents.run_log import AgentRunLog
from uniffy.core.models.agents.session import AgentSession
from uniffy.core.models.agents.task_assignment import (
    AgentTaskAssignment,
)
from uniffy.core.models.comments.comment import Comment
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.task import Task
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.buffer import UPDATE_BUFFER_CTX_KEY, UpdateBuffer
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY, ObjectStorage
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.domains.agents.providers.base import (
    CompletionResult,
    CompletionStopReason,
    EventType,
    LLMProvider,
    ModelInfo,
    StreamEvent,
    ToolCall,
)
from uniffy.domains.agents.providers.clients import get_provider_lru
from uniffy.domains.agents.tasks import admission
from uniffy.domains.agents.tasks.admission import START_NOW, RunStart
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.calls.lifecycle import CALL_LIFECYCLE_CTX_KEY
from uniffy.domains.projects.agents.operations import (
    TaskAgentOperations,
)
from uniffy.domains.projects.operations import ProjectOperations, TaskOperations
from uniffy.domains.projects.realtime import TaskRealtimeAdapter
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.realtime_live import BUDGET
from uniffy.tests.integration.access.recording_search import recording_indexer

MODEL = "scripted-model"
DRAFT = "Release notes: faster search, calmer notifications."


class ScriptedStream(LLMProvider):
    """Streams each completion as a single terminal event carrying the next scripted turn."""

    name = "anthropic"

    def __init__(self) -> None:
        self.turns: list[CompletionResult] = []
        self.requests: list[list[dict]] = []

    async def validate(self) -> tuple[bool, str | None]:
        return True, None

    async def chat_completion(self, messages: list[dict], model: str, **kwargs: Any) -> Any:
        self.requests.append([dict(message) for message in messages])
        result = self.turns.pop(0)
        if not kwargs.get("stream"):
            return result

        async def events() -> AsyncIterator[StreamEvent]:
            yield StreamEvent(type=EventType.MODEL_CALL_END, result=result)

        return events()

    async def get_available_models(self) -> list[ModelInfo]:
        return [
            ModelInfo(
                id=MODEL,
                display_name=MODEL,
                provider=self.name,
                context_window=200_000,
                supports_tools=True,
            )
        ]


def working_turns(task_id: UUID) -> list[CompletionResult]:
    """Write the description, try to delete the task, then summarize."""
    calls = [
        ToolCall(
            id="write",
            name="tasks-update_task",
            input={"task_id": str(task_id), "description": DRAFT, "base_description": ""},
        ),
        ToolCall(id="delete", name="tasks-delete_task", input={"task_id": str(task_id)}),
    ]
    return [
        CompletionResult(
            content="", model=MODEL, stop_reason=CompletionStopReason.TOOL_USE, tool_calls=calls
        ),
        CompletionResult(content="Drafted the release notes.", model=MODEL),
    ]


@pytest_asyncio.fixture(loop_scope="session")
async def scene(access: SimpleNamespace, monkeypatch) -> AsyncIterator[SimpleNamespace]:
    """An org agent, a private agent, and an org-editable project with one task."""
    woken: list[UUID] = []

    async def record_wake(assignment_id: UUID) -> None:
        woken.append(assignment_id)

    monkeypatch.setattr(admission, "wake_task_assignment", record_wake)
    indexer = recording_indexer()
    adapter = TaskRealtimeAdapter(indexer)
    register_realtime_adapter(adapter, stage_edits=adapter.stage_edits)
    buffer = UpdateBuffer(pending_budget_bytes=BUDGET)
    storage = MagicMock(spec=ObjectStorage)
    async with open_session() as db:
        key = ProviderKey(
            organization_id=access.org_id,
            provider="anthropic",
            label="Scripted",
            encrypted_credential="unused",
            key_hint="none",
            created_by=access.admin_id,
        )
        db.add(key)
        await db.flush()
        tools = ["tasks.read_task", "tasks.update_task", "tasks.delete_task", "tasks.create_task"]
        tools += ["tasks.add_comment", "tasks.list_comments"]
        writer = Agent(
            organization_id=access.org_id,
            owner_id=access.admin_id,
            name=f"Writer {generate_id().hex[:6]}",
            soul_prompt="",
            primary_model=MODEL,
            primary_provider_key_id=key.id,
            enabled_tools=tools,
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )
        private = Agent(
            organization_id=access.org_id,
            owner_id=access.admin_id,
            name=f"Private {generate_id().hex[:6]}",
            soul_prompt="",
            primary_model=MODEL,
            primary_provider_key_id=key.id,
            access_mode=AccessMode.OWNER_ONLY,
        )
        db.add_all([writer, private])
        await db.commit()
        project = await ProjectOperations(db, storage, indexer).create(
            access.member_id,
            access.org_id,
            name="Launch",
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.EDITOR,
            slug=f"L{generate_id().hex[-3:]}".upper(),
        )
        task = await TaskOperations(db, storage, indexer, buffer).create(
            access.member_id, access.org_id, project.id, title="Write release notes for v2.3"
        )
        ids = SimpleNamespace(
            key_id=key.id,
            agent_id=writer.id,
            private_id=private.id,
            project_id=project.id,
            task_id=task.id,
        )
    model = ScriptedStream()
    await get_provider_lru().set(ids.key_id, "unused", model)
    ctx = {
        SESSION_FACTORY_CTX_KEY: open_session,
        OBJECT_STORAGE_CTX_KEY: storage,
        SEARCH_INDEXER_CTX_KEY: indexer,
        UPDATE_BUFFER_CTX_KEY: buffer,
        CALL_LIFECYCLE_CTX_KEY: CallsLifecycle(open_session),
    }
    try:
        yield SimpleNamespace(
            **vars(ids),
            ctx=ctx,
            model=model,
            access=access,
            woken=woken,
            storage=storage,
            indexer=indexer,
            buffer=buffer,
        )
    finally:
        async with open_session() as db:
            agents = [ids.agent_id, ids.private_id]
            await db.execute(delete(Comment).where(Comment.organization_id == access.org_id))
            await db.execute(
                delete(AgentTaskAssignment).where(
                    AgentTaskAssignment.organization_id == access.org_id
                )
            )
            await db.execute(delete(AgentRunLog).where(AgentRunLog.agent_id.in_(agents)))
            sessions = select(AgentSession.id).where(AgentSession.agent_id.in_(agents))
            await db.execute(delete(AgentMessage).where(AgentMessage.session_id.in_(sessions)))
            await db.execute(delete(AgentSession).where(AgentSession.agent_id.in_(agents)))
            await db.execute(delete(OrgSetting).where(OrgSetting.organization_id == access.org_id))
            task_ids = select(Task.id).where(Task.organization_id == access.org_id)
            await db.execute(delete(TaskActivity).where(TaskActivity.task_id.in_(task_ids)))
            await db.execute(delete(Task).where(Task.organization_id == access.org_id))
            await db.execute(delete(Agent).where(Agent.id.in_(agents)))
            await db.execute(delete(ProviderKey).where(ProviderKey.id == ids.key_id))
            await db.commit()


async def assign(
    scene,
    user_id: UUID,
    agent_id: UUID | None,
    task_id: UUID | None = None,
    start: RunStart = START_NOW,
):
    async with open_session() as db:
        return await TaskAgentOperations(db).assign(
            user_id, scene.access.org_id, task_id or scene.task_id, agent_id, start
        )


async def rows(task_id: UUID) -> list[AgentTaskAssignment]:
    async with open_session() as db:
        return list(
            (
                await db.scalars(
                    select(AgentTaskAssignment)
                    .where(AgentTaskAssignment.task_id == task_id)
                    .order_by(AgentTaskAssignment.created_at)
                )
            ).all()
        )


async def comments(task_id: UUID) -> list[Comment]:
    async with open_session() as db:
        return list(
            (
                await db.scalars(
                    select(Comment)
                    .where(Comment.content_type == ContentType.TASK, Comment.content_id == task_id)
                    .order_by(Comment.created_at)
                )
            ).all()
        )
