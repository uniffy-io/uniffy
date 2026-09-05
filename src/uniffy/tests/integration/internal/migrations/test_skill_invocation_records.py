import asyncio
from dataclasses import replace

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.skill import SkillSurface
from uniffy.core.models.agents.skill_invocation import (
    AgentSkillInvocation,
    SkillInvocationErrorCode,
    SkillInvocationStatus,
)
from uniffy.core.types import generate_id
from uniffy.domains.agents.skills.invocations import InvocationTarget, SkillInvocationRecorder
from uniffy.infrastructure.database.session import ALEMBIC_INI_PATH, get_database_url
from uniffy.tests.integration.internal.migrations.test_migration_run import (
    _migrate_to,
    _provision_to,
    _query,
    _execute,
)


@pytest.fixture
async def invocation_store(scratch_database):
    await _provision_to(scratch_database, "101")
    engine = create_async_engine(get_database_url())
    factory = async_sessionmaker(engine)
    try:
        yield SkillInvocationRecorder(factory), factory
    finally:
        await engine.dispose()


def target(**overrides):
    return InvocationTarget(**{
        "organization_id": generate_id(),
        "user_id": generate_id(),
        "agent_id": generate_id(),
        "skill_id": generate_id(),
        "skill_version_id": generate_id(),
        "skill_version_number": 3,
        "surface": SkillSurface.SESSION,
        "session_id": generate_id(),
        "trigger_message_id": generate_id(),
        **overrides,
    })


async def test_concurrent_starts_preserve_one_exact_invocation(invocation_store):
    recorder, factory = invocation_store
    selected = target()
    invocation_id = generate_id()
    rows = await asyncio.gather(*[
        recorder.start(invocation_id=invocation_id, target=selected) for _ in range(4)
    ])
    assert {row.id for row in rows} == {invocation_id}
    assert {row.created_at for row in rows} == {rows[0].created_at}
    for changed in (
        replace(selected, organization_id=generate_id()),
        replace(selected, user_id=generate_id()),
        replace(selected, agent_id=generate_id()),
        replace(selected, skill_version_id=generate_id()),
        replace(selected, skill_version_number=4),
        replace(selected, trigger_message_id=generate_id()),
    ):
        with pytest.raises(ValidationError):
            await recorder.start(invocation_id=invocation_id, target=changed)
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(AgentSkillInvocation)) == 1
        row = await session.get(AgentSkillInvocation, invocation_id)
        assert row.skill_version_id == selected.skill_version_id
        assert row.skill_version_number == 3
        assert row.status == SkillInvocationStatus.STARTED

    caller_id = generate_id()
    caller_row = AgentSkillInvocation(id=caller_id, **selected.values())
    durable_id = generate_id()
    async with factory() as caller_session:
        caller_session.add(caller_row)
        await caller_session.flush()
        await recorder.start(invocation_id=durable_id, target=selected)
        await caller_session.rollback()
    async with factory() as session:
        assert await session.get(AgentSkillInvocation, caller_id) is None
        assert await session.get(AgentSkillInvocation, durable_id) is not None


async def test_terminal_outcomes_keep_correlation_and_ignore_replays(invocation_store):
    recorder, factory = invocation_store
    for surface in SkillSurface:
        selected = target(
            surface=surface,
            session_id=generate_id() if surface == SkillSurface.SESSION else None,
            channel_id=generate_id() if surface == SkillSurface.CHAT else None,
        )
        for status in SkillInvocationStatus:
            if status == SkillInvocationStatus.STARTED:
                continue
            invocation_id, run_id, response_id = generate_id(), generate_id(), generate_id()
            await recorder.start(invocation_id=invocation_id, target=selected)
            assert not await recorder.finalize(
                invocation_id=invocation_id,
                organization_id=generate_id(),
                status=status,
            )
            assert await recorder.finalize(
                invocation_id=invocation_id,
                organization_id=selected.organization_id,
                status=status,
                run_log_id=run_id,
                response_message_id=response_id,
                error_code=None
                if status == SkillInvocationStatus.COMPLETED
                else SkillInvocationErrorCode.RUN_FAILURE,
                tool_calls=[
                    {"success": True},
                    {"success": False},
                    {"success": False},
                    {"success": None},
                    {},
                ],
            )
            assert not await recorder.finalize(
                invocation_id=invocation_id,
                organization_id=selected.organization_id,
                status=SkillInvocationStatus.CANCELLED,
            )
            replay = await recorder.start(invocation_id=invocation_id, target=selected)
            assert replay.status == status
            async with factory() as session:
                row = await session.get(AgentSkillInvocation, invocation_id)
                assert row.run_log_id == run_id
                assert row.response_message_id == response_id
                assert row.tool_error_count == 2
                assert row.status == status
                assert row.completed_at >= row.created_at


async def test_concurrent_finalizers_cannot_overwrite_terminal_facts(invocation_store):
    recorder, factory = invocation_store
    selected = target()
    invocation_id = generate_id()
    await recorder.start(invocation_id=invocation_id, target=selected)
    outcomes = [SkillInvocationStatus.COMPLETED, SkillInvocationStatus.CANCELLED]
    changed = await asyncio.gather(*[
        recorder.finalize(
            invocation_id=invocation_id,
            organization_id=selected.organization_id,
            status=status,
        )
        for status in outcomes
    ])
    assert changed.count(True) == 1
    async with factory() as session:
        row = await session.get(AgentSkillInvocation, invocation_id)
        assert row.status == outcomes[changed.index(True)]


async def test_invocation_constraints_and_migration_round_trip(invocation_store):
    recorder, factory = invocation_store
    selected = target()
    invocation_id = generate_id()
    await recorder.start(invocation_id=invocation_id, target=selected)
    for assignment in (
        "status = 'unknown'",
        "source = 'agent'",
        "surface = 'unknown'",
        "session_id = NULL",
        "skill_version_number = 0",
        "tool_error_count = -1",
        "status = 'completed'",
        "completed_at = now()",
    ):
        async with factory() as session:
            with pytest.raises(IntegrityError):
                await session.execute(text(f"UPDATE agents_skill_invocations SET {assignment}"))
            await session.rollback()
    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    command.downgrade(config, "100")
    assert _query("SELECT to_regclass('agents_skill_invocations')") == [(None,)]
    _migrate_to("101")
    assert _query("SELECT count(*) FROM agents_skill_invocations") == [(0,)]


async def test_usage_cutover_does_not_fabricate_invocations(invocation_store):
    recorder, _ = invocation_store
    selected = target()
    await recorder.start(invocation_id=generate_id(), target=selected)
    _execute(
        "INSERT INTO agents_skill_usages "
        "(id, skill_id, agent_id, user_id, organization_id, invoked) "
        "VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), "
        "gen_random_uuid(), gen_random_uuid(), true)"
    )
    before = _query("SELECT * FROM agents_skill_invocations")
    _migrate_to("102")
    assert _query("SELECT to_regclass('agents_skill_usages')") == [(None,)]
    assert _query("SELECT * FROM agents_skill_invocations") == before
    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    command.downgrade(config, "101")
    assert _query("SELECT count(*) FROM agents_skill_usages") == [(0,)]
    assert _query("SELECT * FROM agents_skill_invocations") == before
    _migrate_to("102")
