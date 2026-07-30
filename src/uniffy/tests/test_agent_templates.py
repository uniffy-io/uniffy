"""Agent template catalog and default-agent bootstrap tests.

Vanilla pytest + ``asyncio.run`` with mocked sessions, matching the repo's
other agents tests (no pytest-asyncio, no live DB).
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

from uniffy.core.data_files import DATA_DIR, load_documents
from uniffy.core.models.agents.agent import Agent
from uniffy.core.types import AccessMode
from uniffy.domains.agents.templates import (
    AGENT_TEMPLATES,
    get_default_template,
    get_template,
)
from uniffy.domains.agents.tools.registry import get_tool_registry


def _run(coro):
    return asyncio.run(coro)


class TestCatalogIntegrity:
    def test_exactly_one_default_template(self) -> None:
        flagged = [t for t in AGENT_TEMPLATES if t.is_default]
        assert len(flagged) == 1
        assert get_default_template() is flagged[0]

    def test_keys_are_unique(self) -> None:
        keys = [t.key for t in AGENT_TEMPLATES]
        assert len(keys) == len(set(keys))

    def test_get_template_resolves_and_raises(self) -> None:
        assert get_template(AGENT_TEMPLATES[0].key) is AGENT_TEMPLATES[0]
        try:
            get_template("nope")
        except KeyError:
            pass
        else:
            raise AssertionError("expected KeyError")

    def test_enabled_tools_exist_in_registry(self) -> None:
        registry = get_tool_registry()
        for template in AGENT_TEMPLATES:
            for name in template.enabled_tools:
                assert registry.get(name) is not None, (
                    f"{template.key}: unknown tool {name}"
                )

    def test_bundled_skill_names_match_shipped_skills(self) -> None:
        seeded = {doc.scalar("name") for doc in load_documents(DATA_DIR / "skills")}
        for template in AGENT_TEMPLATES:
            for name in template.bundled_skill_names:
                assert name in seeded, f"{template.key}: unknown skill {name}"

    def test_templates_have_prompts_and_tools(self) -> None:
        for template in AGENT_TEMPLATES:
            assert template.soul_prompt.strip()
            assert template.description.strip()
            assert template.enabled_tools

    def test_catalog_loaded_from_shipped_files(self) -> None:
        files = {p.stem for p in (DATA_DIR / "catalog").glob("*.md")}
        assert files == {t.key for t in AGENT_TEMPLATES}


def _org_create(skill_rows: list[tuple[UUID, str]]):
    """Run OrganizationOperations.create on a mocked session; return captured state."""
    from uniffy.domains.organizations.operations import OrganizationOperations

    session = MagicMock()
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    owner_lookup = MagicMock()
    owner_lookup.scalar_one_or_none.return_value = None
    skill_lookup = MagicMock()
    skill_lookup.all.return_value = skill_rows
    session.execute = AsyncMock(side_effect=[owner_lookup, skill_lookup])

    ops = OrganizationOperations.__new__(OrganizationOperations)
    ops._session = session
    ops._user_indexer = MagicMock()

    cipher = MagicMock()
    cipher.provision = AsyncMock()
    attachment_ops = MagicMock()
    attachment_ops.get_or_create_attachments_folder = AsyncMock()
    chat_ops = MagicMock()
    chat_ops.create_channel = AsyncMock()
    agent_ops = MagicMock()
    agent_ops._index_for_search = AsyncMock()

    owner_id = uuid4()
    with (
        patch(
            "uniffy.domains.organizations.operations.OrgCipher",
            return_value=cipher,
        ),
        patch(
            "uniffy.domains.organizations.operations.write_audit_event",
            AsyncMock(),
        ),
        patch(
            "uniffy.domains.files.attachments.operations.AttachmentOperations",
            return_value=attachment_ops,
        ),
        patch(
            "uniffy.domains.files.filters.presets.create_default_presets",
            AsyncMock(),
        ),
        patch(
            "uniffy.domains.tags.filters.presets.create_default_tag_filter_presets",
            AsyncMock(),
        ),
        patch(
            "uniffy.domains.chat.channels.operations.ChatChannelOperations",
            return_value=chat_ops,
        ),
        patch(
            "uniffy.domains.agents.agents.operations.AgentOperations",
            return_value=agent_ops,
        ),
    ):
        org = _run(
            ops.create(name="Acme", slug="acme", owner_user_id=owner_id)
        )

    agents = [
        call.args[0]
        for call in session.add.call_args_list
        if isinstance(call.args[0], Agent)
    ]
    return org, owner_id, agents, agent_ops


class TestDefaultAgentBootstrap:
    def test_seeds_one_default_agent_from_default_template(self) -> None:
        template = get_default_template()
        skill_id = uuid4()
        org, owner_id, agents, agent_ops = _org_create(
            [(skill_id, template.bundled_skill_names[0])]
        )

        assert len(agents) == 1
        agent = agents[0]
        assert agent.is_default is True
        assert agent.name == template.name
        assert agent.soul_prompt == template.soul_prompt
        assert agent.avatar_emoji == template.emoji
        assert agent.organization_id == org.id
        assert agent.owner_id == owner_id
        assert agent.access_mode == AccessMode.OPEN_TO_ORG
        assert agent.baseline_role is None
        assert agent.enabled_tools == template.enabled_tools
        assert agent.enabled_skills == [str(skill_id)]
        assert agent.primary_provider_key_id is None
        assert agent.image_provider_key_id is None
        agent_ops._index_for_search.assert_awaited_once_with(
            agent, skip_member_lookup=True
        )

    def test_bootstrap_tolerates_missing_bundled_skills(self) -> None:
        _, _, agents, _ = _org_create([])

        assert len(agents) == 1
        assert agents[0].is_default is True
        assert agents[0].enabled_skills == []
