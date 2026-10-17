"""Agent runs on live PostgreSQL: a failing write tool keeps earlier writes and cron bookkeeping.

The model is the one boundary double: a scripted client sits in the provider client cache, where a
decrypted credential would put the real one.
"""

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from uniffy.core.database import SESSION_FACTORY_CTX_KEY
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.cron_task import AgentCronRunStatus, AgentCronTask
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.models.agents.provider_key import ProviderKey
from uniffy.core.models.agents.run_log import AgentRunKind, AgentRunLog, AgentRunStatus
from uniffy.core.models.agents.session import AgentSession
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.notes.note import Note
from uniffy.core.realtime.buffer import UPDATE_BUFFER_CTX_KEY, UpdateBuffer
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY, ObjectStorage
from uniffy.core.types import generate_id
from uniffy.domains.agents.cron.jobs.jobs import (
    execute_agent_cron_tasks,
    execute_single_agent_cron_task,
)
from uniffy.domains.agents.providers.base import (
    CompletionResult,
    CompletionStopReason,
    LLMProvider,
    ModelInfo,
    ToolCall,
)
from uniffy.domains.agents.providers.clients import get_provider_lru
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.domains.calls.lifecycle import CALL_LIFECYCLE_CTX_KEY
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.realtime_live import BUDGET
from uniffy.tests.integration.access.recording_search import recording_indexer

pytestmark = pytest.mark.asyncio(loop_scope="session")

MODEL = "scripted-model"
FOLDER = "Cron folder"


class ScriptedModel(LLMProvider):
    """Answers each completion with the next scripted turn."""

    name = "anthropic"

    def __init__(self, turns: list[CompletionResult]) -> None:
        self.turns = turns

    async def validate(self) -> tuple[bool, str | None]:
        return True, None

    async def chat_completion(self, messages: list[dict], model: str, **_: Any) -> CompletionResult:
        return self.turns.pop(0)

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


def tool_turn() -> list[CompletionResult]:
    """One turn with two write tools, the second of which names a task that does not exist."""
    calls = [
        ToolCall(id="create", name="notes-create_folder", input={"name": FOLDER}),
        ToolCall(
            id="update",
            name="tasks-update_task",
            input={"task_id": str(generate_id()), "title": "Never there"},
        ),
    ]
    return [
        CompletionResult(
            content="", model=MODEL, stop_reason=CompletionStopReason.TOOL_USE, tool_calls=calls
        ),
        CompletionResult(content="Done", model=MODEL),
    ]


@pytest_asyncio.fixture(loop_scope="session")
async def cron(access: SimpleNamespace) -> AsyncIterator[SimpleNamespace]:
    """A member's agent with a scripted model and a due cron task that runs as that member."""
    async with open_session() as db:
        key = ProviderKey(
            organization_id=access.org_id,
            provider="anthropic",
            label="Scripted",
            encrypted_credential="unused",
            key_hint="none",
            created_by=access.member_id,
        )
        db.add(key)
        await db.flush()
        agent = Agent(
            organization_id=access.org_id,
            owner_id=access.member_id,
            name=f"Scheduler {generate_id().hex[:8]}",
            soul_prompt="",
            primary_model=MODEL,
            primary_provider_key_id=key.id,
            enabled_tools=["notes.create_folder", "tasks.update_task"],
        )
        db.add(agent)
        await db.flush()
        task = AgentCronTask(
            organization_id=access.org_id,
            owner_id=access.member_id,
            agent_id=agent.id,
            execution_user_id=access.member_id,
            name="Nightly tidy",
            prompt="Tidy up",
            cron_expression="0 3 * * *",
            timezone="UTC",
            next_run_at=datetime.now(UTC) - timedelta(minutes=1),
        )
        db.add(task)
        await db.commit()
        ids = SimpleNamespace(key_id=key.id, agent_id=agent.id, task_id=task.id)
    model = ScriptedModel(tool_turn())
    await get_provider_lru().set(ids.key_id, "unused", model)
    ctx = {
        SESSION_FACTORY_CTX_KEY: open_session,
        OBJECT_STORAGE_CTX_KEY: MagicMock(spec=ObjectStorage),
        SEARCH_INDEXER_CTX_KEY: recording_indexer(),
        UPDATE_BUFFER_CTX_KEY: UpdateBuffer(pending_budget_bytes=BUDGET),
        CALL_LIFECYCLE_CTX_KEY: CallsLifecycle(open_session),
    }
    try:
        yield SimpleNamespace(**vars(ids), ctx=ctx, model=model, access=access)
    finally:
        async with open_session() as db:
            await db.execute(delete(AgentRunLog).where(AgentRunLog.agent_id == ids.agent_id))
            sessions = select(AgentSession.id).where(AgentSession.agent_id == ids.agent_id)
            await db.execute(delete(AgentMessage).where(AgentMessage.session_id.in_(sessions)))
            await db.execute(delete(AgentCronTask).where(AgentCronTask.id == ids.task_id))
            await db.execute(delete(AgentSession).where(AgentSession.agent_id == ids.agent_id))
            await db.execute(delete(Agent).where(Agent.id == ids.agent_id))
            await db.execute(delete(ProviderKey).where(ProviderKey.id == ids.key_id))
            await db.commit()


async def outcome(cron: SimpleNamespace) -> SimpleNamespace:
    async with open_session() as db:
        task = await db.get(AgentCronTask, cron.task_id)
        logs = (
            (await db.execute(select(AgentRunLog).where(AgentRunLog.agent_id == cron.agent_id)))
            .scalars()
            .all()
        )
        actions = (
            (
                await db.execute(
                    select(AuditEvent.action).where(
                        AuditEvent.organization_id == cron.access.org_id,
                        AuditEvent.action.like("agent.tool_call.%"),
                    )
                )
            )
            .scalars()
            .all()
        )
        folders = (
            (
                await db.execute(
                    select(Note.id).where(
                        Note.organization_id == cron.access.org_id, Note.title == FOLDER
                    )
                )
            )
            .scalars()
            .all()
        )
    assert task is not None
    return SimpleNamespace(task=task, logs=logs, actions=sorted(actions), folders=folders)


EXPECTED_AUDIT = ["agent.tool_call.notes.create_folder", "agent.tool_call.tasks.update_task"]


async def test_scheduled_run_with_a_failing_write_tool_completes_its_bookkeeping(cron) -> None:
    result = await execute_agent_cron_tasks(cron.ctx)

    found = await outcome(cron)
    assert result == {"executed": 1, "errors": 0}
    assert (found.task.last_run_status, found.task.run_count) == (AgentCronRunStatus.SUCCESS, 1)
    assert found.task.consecutive_failures == 0
    assert found.task.next_run_at is not None and found.task.next_run_at > datetime.now(UTC)
    assert [(log.kind, log.cron_task_id) for log in found.logs] == [
        (AgentRunKind.CRON, cron.task_id)
    ]
    # The folder committed before the failing write, and both tool calls kept their audit fact.
    assert len(found.folders) == 1
    assert found.actions == EXPECTED_AUDIT


async def test_run_now_with_a_failing_write_tool_replaces_its_placeholder(cron) -> None:
    async with open_session() as db:
        placeholder = AgentRunLog(
            agent_id=cron.agent_id,
            user_id=cron.access.member_id,
            organization_id=cron.access.org_id,
            model="",
            kind=AgentRunKind.CRON,
            cron_task_id=cron.task_id,
            status=AgentRunStatus.PENDING,
        )
        db.add(placeholder)
        await db.commit()
        placeholder_id = placeholder.id

    result = await execute_single_agent_cron_task(cron.ctx, str(cron.task_id), str(placeholder_id))

    found = await outcome(cron)
    assert result == {"status": "success", "task_id": str(cron.task_id)}
    assert placeholder_id not in {log.id for log in found.logs}
    assert [(log.kind, log.status) for log in found.logs] == [
        (AgentRunKind.CRON, AgentRunStatus.SUCCESS)
    ]
    assert (found.task.last_run_status, found.task.run_count) == (AgentCronRunStatus.SUCCESS, 1)
    assert len(found.folders) == 1
    assert found.actions == EXPECTED_AUDIT
