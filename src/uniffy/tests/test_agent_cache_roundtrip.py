"""The agent-row cache serializer must carry every runtime-relevant column."""

from datetime import UTC, datetime

from uniffy.core.models.agents.agent import Agent
from uniffy.core.types import AccessMode, ContentRole, generate_id
from uniffy.domains.agents.cache import _deserialize_agent, _serialize_agent


def test_agent_cache_roundtrip_preserves_all_runtime_fields() -> None:
    agent = Agent(
        id=generate_id(),
        organization_id=generate_id(),
        owner_id=generate_id(),
        name="Roundtrip",
        soul_prompt="soul",
        primary_model="claude-opus-4-8",
        fallback_models=["claude-sonnet-4-6"],
        model_params={"reasoning_effort": "xhigh", "max_tokens": 54212},
        image_model="gpt-image-1",
        primary_provider_key_id=generate_id(),
        image_provider_key_id=generate_id(),
        enabled_tools=["memory.save"],
        enabled_skills=["s1"],
        integration_connections={"github": str(generate_id())},
        avatar_emoji="",
        avatar_key="avatars/x",
        theme_color="violet",
        is_default=True,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.VIEWER,
        is_deleted=False,
        deleted_at=None,
        created_at=datetime(2026, 7, 20, tzinfo=UTC),
        updated_at=datetime(2026, 7, 20, tzinfo=UTC),
    )

    restored = _deserialize_agent(_serialize_agent(agent))

    for field in Agent.model_fields:
        assert getattr(restored, field) == getattr(agent, field), field


def test_agent_cache_roundtrip_defaults() -> None:
    agent = Agent(
        id=generate_id(),
        organization_id=generate_id(),
        owner_id=generate_id(),
        name="Sparse",
    )
    restored = _deserialize_agent(_serialize_agent(agent))
    assert restored.model_params == {}
    assert restored.fallback_models == []
    assert restored.integration_connections == {}
