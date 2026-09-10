from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

from uniffy.core.data_files import DATA_DIR, load_documents
from uniffy.core.models.agents.agent import Agent
from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.agents.rules.validation import clean_rule_fields
from uniffy.domains.agents.templates import (
    AGENT_TEMPLATES,
    get_default_template,
    get_template,
)
from uniffy.domains.agents.tools.registry import get_tool_registry


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
                assert registry.get(name) is not None, f"{template.key}: unknown tool {name}"

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

    def test_bundled_rule_names_match_shipped_rules(self) -> None:
        shipped = {doc.scalar("name") for doc in load_documents(DATA_DIR / "rules")}
        for template in AGENT_TEMPLATES:
            assert set(template.bundled_rule_names) <= shipped
        assert get_default_template().bundled_rule_names

    def test_every_catalog_agent_selects_the_shared_rules(self) -> None:
        shared = {
            "clear_communication",
            "no_emojis",
            "clarify_intent",
            "respect_workspace_structure",
            "no_dashes",
        }
        for template in AGENT_TEMPLATES:
            assert shared <= set(template.bundled_rule_names), template.key
            assert len(template.bundled_rule_names) == len(set(template.bundled_rule_names))

    def test_bundled_rules_have_valid_content_and_unique_fixed_ids(self) -> None:
        documents = load_documents(DATA_DIR / "rules")
        ids = [UUID(document.scalar("id")) for document in documents]
        assert len(ids) == len(set(ids))
        assert all(rule_id.version == 7 for rule_id in ids)
        for document in documents:
            fields = clean_rule_fields(
                name=document.scalar("name"),
                display_name=document.scalar("display_name"),
                description=document.scalar("description"),
                content=document.body,
            )
            assert fields["content"] == document.body

    def test_workspace_prompt_leaves_selectable_guidance_to_rules(self) -> None:
        prompt = (DATA_DIR / "prompts" / "workspace.md").read_text(encoding="utf-8")
        assert "### Rules" not in prompt
        assert "Never use emojis" not in prompt
        assert "### Working with Tools" in prompt
        assert "### Content References" in prompt

    def test_navigator_has_rich_people_reads(self) -> None:
        tools = set(get_template("navigator").enabled_tools)
        assert {
            "people.list_members",
            "people.get_person",
            "people.list_teams",
        } <= tools

    def test_catalog_loaded_from_shipped_files(self) -> None:
        files = {p.stem for p in (DATA_DIR / "catalog").glob("*.md")}
        assert files == {t.key for t in AGENT_TEMPLATES}


async def _org_create(skill_rows: list[tuple[UUID, str]]):
    from uniffy.domains.organizations.operations import OrganizationOperations

    session = MagicMock()
    session.add = MagicMock()
    session.add_all = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()

    owner_id = generate_id()
    owner_lookup = MagicMock()
    owner_lookup.scalar_one_or_none.return_value = SimpleNamespace(id=owner_id)
    skill_lookup = MagicMock()
    skill_lookup.all.return_value = skill_rows
    rule_lookup = MagicMock()
    rule_lookup.all.return_value = [
        (doc.scalar("name"), UUID(doc.scalar("id"))) for doc in load_documents(DATA_DIR / "rules")
    ]
    session.execute = AsyncMock(side_effect=[owner_lookup, skill_lookup, rule_lookup])

    ops = OrganizationOperations.__new__(OrganizationOperations)
    ops._session = session

    cipher = MagicMock()
    cipher.provision = AsyncMock()
    chat_ops = MagicMock()
    chat_ops.stage_channel = AsyncMock(return_value=SimpleNamespace(channel=SimpleNamespace()))
    chat_ops.finish_channel_create_after_commit = AsyncMock()
    finish_default_agent = AsyncMock()

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
            "uniffy.domains.organizations.operations.stage_personal_attachments_folder",
            AsyncMock(),
        ),
        patch(
            "uniffy.domains.organizations.operations.create_default_presets",
            AsyncMock(),
        ),
        patch(
            "uniffy.domains.organizations.operations.create_default_tag_filter_presets",
            AsyncMock(),
        ),
        patch(
            "uniffy.domains.organizations.operations.ChatChannelOperations",
            return_value=chat_ops,
        ),
        patch(
            "uniffy.domains.organizations.operations.finish_default_agent_after_commit",
            finish_default_agent,
        ),
        patch(
            "uniffy.domains.organizations.operations.UserDirectoryProjection.index_for_organization",
            AsyncMock(),
        ),
        patch(
            "uniffy.domains.organizations.operations.starter_content_enabled",
            return_value=False,
        ),
    ):
        org = await ops.create(
            name="Acme",
            slug="acme",
            owner_user_id=owner_id,
            storage=MagicMock(),
            search_indexer=MagicMock(),
        )

    agents = [call.args[0] for call in session.add.call_args_list if isinstance(call.args[0], Agent)]
    return org, owner_id, agents, finish_default_agent


class TestDefaultAgentBootstrap:
    async def test_seeds_one_default_agent_from_default_template(self) -> None:
        template = get_default_template()
        skill_id = generate_id()
        org, owner_id, agents, finish_default_agent = await _org_create([
            (skill_id, template.bundled_skill_names[0])
        ])

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
        rule_ids = {
            doc.scalar("name"): doc.scalar("id") for doc in load_documents(DATA_DIR / "rules")
        }
        assert agent.enabled_rules == [rule_ids[name] for name in template.bundled_rule_names]
        assert agent.primary_provider_key_id is None
        assert agent.image_provider_key_id is None
        finish_default_agent.assert_awaited_once()
        assert finish_default_agent.await_args.args[1].agent is agent

    async def test_bootstrap_tolerates_missing_bundled_skills(self) -> None:
        _, _, agents, _ = await _org_create([])

        assert len(agents) == 1
        assert agents[0].is_default is True
        assert agents[0].enabled_skills == []
