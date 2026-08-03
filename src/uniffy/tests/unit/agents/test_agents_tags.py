"""Unit tests for the agents <-> tags wiring.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.models.agents.agent import Agent
from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.agents.agents.operations import AgentOperations


def _make_agent() -> Agent:
    return Agent(
        organization_id=generate_id(),
        owner_id=generate_id(),
        name="Helper",
        soul_prompt="",
        primary_model="claude-sonnet-4-6",
        access_mode=AccessMode.OPEN_TO_ORG,
    )


def _make_ops() -> AgentOperations:
    ops = AgentOperations.__new__(AgentOperations)
    ops.session = MagicMock()
    return ops


class TestSyncAgentTags:
    async def test_none_tag_ids_short_circuits(self) -> None:
        ops = _make_ops()
        agent = _make_agent()
        # ``tag_ids=None`` means "leave manual assignments untouched"
        # so the helper must never reach into TagOperations.
        await ops._sync_agent_tags(actor_id=generate_id(), agent=agent, tag_ids=None)
        ops.session.execute.assert_not_called()

    async def test_replace_routes_through_unified_store(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        ops = _make_ops()
        agent = _make_agent()
        actor_id = generate_id()
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

        await ops._sync_agent_tags(
            actor_id=actor_id, agent=agent, tag_ids=replacement
        )

        assert captured["actor_id"] == actor_id
        assert captured["organization_id"] == agent.organization_id
        assert captured["tag_ids"] == replacement
        assert captured["content_urn"] == f"urn:uniffy:content:AGENT:{agent.id}"


class TestHydrateHelper:
    async def test_hydrate_helper_no_op_on_empty_input(self) -> None:
        from uniffy.domains.agents.agents.handlers import _hydrate_agent_tags

        session = AsyncMock()
        out = await _hydrate_agent_tags(session, generate_id(), [])
        assert out == {}
        session.execute.assert_not_called()
