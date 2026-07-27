"""Unit tests for the agents <-> tags wiring.

Uses ``asyncio.run`` helpers for the async paths so it works with the
repo's vanilla pytest harness (no pytest-asyncio dependency).
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from uniffy.core.models.agents.agent import Agent
from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.agents.agents.operations import AgentOperations


def _run(coro):
    return asyncio.run(coro)


def _make_agent() -> Agent:
    return Agent(
        organization_id=uuid4(),
        owner_id=uuid4(),
        name="Helper",
        soul_prompt="",
        primary_model="claude-sonnet-4-6",
        access_mode=AccessMode.OPEN_TO_ORG,
    )


def _make_ops() -> AgentOperations:
    ops = AgentOperations.__new__(AgentOperations)
    ops.session = MagicMock()
    return ops


class TestTagFilterSubquery:
    def test_subquery_joins_tag_assignments_and_groups(self) -> None:
        ops = _make_ops()
        tag_ids = [generate_id(), generate_id()]
        subquery = ops._tag_filter_subquery(tag_ids)
        compiled = str(
            subquery.compile(compile_kwargs={"literal_binds": False})
        ).lower()
        assert "tag_assignments" in compiled
        assert "agents_agents" in compiled
        assert "group by" in compiled
        # AND across the tag set requires DISTINCT count == len(tag_ids).
        assert "having" in compiled
        assert "count(distinct" in compiled

    def test_subquery_synthesises_agent_urn(self) -> None:
        ops = _make_ops()
        subquery = ops._tag_filter_subquery([generate_id()])
        compiled = str(
            subquery.compile(compile_kwargs={"literal_binds": True})
        )
        assert "urn:uniffy:content:AGENT:" in compiled


class TestSyncAgentTags:
    def test_none_tag_ids_short_circuits(self) -> None:
        ops = _make_ops()
        agent = _make_agent()
        # ``tag_ids=None`` means "leave manual assignments untouched"
        # so the helper must never reach into TagOperations.
        _run(ops._sync_agent_tags(actor_id=uuid4(), agent=agent, tag_ids=None))
        ops.session.execute.assert_not_called()

    def test_replace_routes_through_unified_store(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        ops = _make_ops()
        agent = _make_agent()
        actor_id = uuid4()
        replacement = [generate_id()]

        captured: dict[str, object] = {}

        async def _fake_replace(
            self,
            *,
            actor_id,
            organization_id,
            content_urn,
            tag_ids,
        ):
            captured.update(
                actor_id=actor_id,
                organization_id=organization_id,
                content_urn=content_urn,
                tag_ids=list(tag_ids),
            )
            return []

        monkeypatch.setattr(
            "uniffy.domains.tags.operations.TagOperations.replace_manual_tags",
            _fake_replace,
            raising=True,
        )

        _run(
            ops._sync_agent_tags(
                actor_id=actor_id, agent=agent, tag_ids=replacement
            )
        )

        assert captured["actor_id"] == actor_id
        assert captured["organization_id"] == agent.organization_id
        assert captured["tag_ids"] == replacement
        assert captured["content_urn"] == f"urn:uniffy:content:AGENT:{agent.id}"


class TestHydrateHelper:
    def test_hydrate_helper_no_op_on_empty_input(self) -> None:
        from uniffy.domains.agents.agents.handlers import _hydrate_agent_tags

        session = AsyncMock()
        out = _run(_hydrate_agent_tags(session, uuid4(), []))
        assert out == {}
        session.execute.assert_not_called()
