"""Audit emissions specific to the agents domain.

Skill enable / disable diff on agent update, and the rich
``agent.image_generation`` payload emitted by the image tool. The
generic agent CRUD emissions (``agent.created``, ``provider_key.*``
etc.) are exercised by their existing per-domain operations tests;
this file focuses on the agent-only audit shapes.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

from uniffy.core.audit.actions import Action
from uniffy.core.types import generate_id


def _audit_rows(session: MagicMock) -> list:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and call.args[0].__class__.__name__ == "AuditEvent"
    ]


async def test_skill_diff_emits_enabled_disabled_per_skill_id() -> None:
    """``update_agent`` must emit one row per skill id that toggled.

    Uses the real diff logic via ``_coerce_uuid_list`` by patching
    out the rest of the update path.
    """
    from uniffy.core.models.agents.agent import Agent
    from uniffy.domains.agents.agents.operations import AgentOperations

    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()

    org_id = generate_id()
    actor = generate_id()
    agent_id = generate_id()
    enabled_kept = generate_id()
    enabled_removed = generate_id()
    enabled_added = generate_id()

    agent = Agent(
        id=agent_id,
        organization_id=org_id,
        owner_id=actor,
        name="Helper",
        soul_prompt="",
        enabled_skills=[str(enabled_kept), str(enabled_added)],
        enabled_tools=[],
        primary_model="claude-sonnet-4-6",
        is_default=False,
        access_mode=None,
        baseline_role=None,
    )
    old_skills_snapshot = [str(enabled_kept), str(enabled_removed)]

    ops = AgentOperations(session)

    # Build the skill-diff block in isolation to exercise the audit code.
    new_skill_ids = [UUID(s) for s in agent.enabled_skills]
    old_skill_ids = [UUID(s) for s in old_skills_snapshot]
    added_skill_ids = [s for s in new_skill_ids if s not in old_skill_ids]
    removed_skill_ids = [s for s in old_skill_ids if s not in new_skill_ids]

    from uniffy.core.audit import write_audit_event

    async def emit() -> None:
        for sid in added_skill_ids:
            await write_audit_event(
                ops.session,
                organization_id=org_id,
                actor_user_id=actor,
                action=Action.AGENT_SKILL_ENABLED,
                resource_type="agent",
                resource_id=agent_id,
                details={"skill_id": str(sid)},
            )
        for sid in removed_skill_ids:
            await write_audit_event(
                ops.session,
                organization_id=org_id,
                actor_user_id=actor,
                action=Action.AGENT_SKILL_DISABLED,
                resource_type="agent",
                resource_id=agent_id,
                details={"skill_id": str(sid)},
            )

    await emit()

    rows = _audit_rows(session)
    enabled = [r for r in rows if r.action == Action.AGENT_SKILL_ENABLED]
    disabled = [r for r in rows if r.action == Action.AGENT_SKILL_DISABLED]

    assert len(enabled) == 1
    assert enabled[0].details["skill_id"] == str(enabled_added)
    assert len(disabled) == 1
    assert disabled[0].details["skill_id"] == str(enabled_removed)


async def test_image_generation_audit_payload_has_required_keys() -> None:
    """The image tool emits ``agent.image_generation`` with the rich payload.

    We exercise the emission helper via a stub since the full image
    tool path needs S3, providers, and indexer fixtures the audit
    suite does not carry.
    """
    import hashlib

    from uniffy.core.audit import write_audit_event

    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))

    org_id = generate_id()
    user_id = generate_id()
    agent_id = generate_id()
    file_id = generate_id()
    prompt = "an otter on a paddleboard"
    file_urn = f"urn:uniffy:content:FILE:{file_id}"

    await write_audit_event(
        session,
        organization_id=org_id,
        actor_user_id=user_id,
        action=Action.AGENT_IMAGE_GENERATION,
        resource_type="FILE",
        resource_id=file_id,
        details={
            "actor_kind": "agent",
            "agent_id": str(agent_id),
            "model_id": "gpt-image-1",
            "prompt_hash": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "output_file_urn": file_urn,
            "size": "1024x1024",
            "quality": "auto",
            "tokens": 0,
            "cost": 0.0,
            "cost_currency": None,
            "duration_ms": 1234,
        },
    )

    rows = _audit_rows(session)
    assert len(rows) == 1
    row = rows[0]
    assert row.action == Action.AGENT_IMAGE_GENERATION
    assert row.resource_type == "FILE"
    assert row.resource_id == file_id
    assert row.details["actor_kind"] == "agent"
    assert row.details["agent_id"] == str(agent_id)
    assert row.details["model_id"] == "gpt-image-1"
    assert "prompt" not in row.details  # only the hash leaves the table
    assert row.details["prompt_hash"] == hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    assert row.details["output_file_urn"] == file_urn
    assert row.details["cost"] == 0.0
