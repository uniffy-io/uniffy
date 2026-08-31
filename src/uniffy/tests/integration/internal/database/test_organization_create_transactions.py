"""Organization bootstrap transactions against PostgreSQL."""

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import delete, func, select, text

from uniffy.core.audit.actions import Action
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.chat.channel import ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.crypto.org_encryption_key import OrgEncryptionKey
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.files.saved_filter import SavedFileFilter
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.people.identity import IdentitySource
from uniffy.core.models.permissions.org_permission_defaults import OrganizationPermissionDefaults
from uniffy.core.models.tags.saved_filter import SavedTagFilter
from uniffy.core.types import generate_id
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.infrastructure.database import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _delete_organization(session, organization_id) -> None:
    channel_ids = list(
        (
            await session.execute(
                select(ChatChannel.id).where(ChatChannel.organization_id == organization_id)
            )
        ).scalars()
    )
    if channel_ids:
        await session.execute(
            delete(ChatChannelMember).where(ChatChannelMember.channel_id.in_(channel_ids))
        )
        await session.execute(
            delete(ChatChannelStats).where(ChatChannelStats.channel_id.in_(channel_ids))
        )
        await session.execute(delete(ChatChannel).where(ChatChannel.id.in_(channel_ids)))
    await session.execute(delete(Agent).where(Agent.organization_id == organization_id))
    await session.execute(
        delete(SavedFileFilter).where(SavedFileFilter.organization_id == organization_id)
    )
    await session.execute(
        delete(SavedTagFilter).where(SavedTagFilter.organization_id == organization_id)
    )
    await session.execute(delete(Folder).where(Folder.organization_id == organization_id))
    await session.execute(
        delete(OrganizationPermissionDefaults).where(
            OrganizationPermissionDefaults.organization_id == organization_id
        )
    )
    await session.execute(
        delete(IdentitySource).where(IdentitySource.organization_id == organization_id)
    )
    await session.execute(text("SET LOCAL uniffy.audit_maintenance = 'on'"))
    await session.execute(delete(AuditEvent).where(AuditEvent.organization_id == organization_id))
    await session.execute(
        delete(OrgEncryptionKey).where(OrgEncryptionKey.organization_id == organization_id)
    )
    await session.execute(
        delete(OrganizationMember).where(OrganizationMember.organization_id == organization_id)
    )
    await session.execute(delete(Organization).where(Organization.id == organization_id))
    await session.commit()


async def test_organization_bootstrap_rolls_back_every_fact_when_audit_fails(
    session,
    env,
    search_indexer,
) -> None:
    slug = f"rollback-org-{generate_id().hex[:12]}"
    with (
        patch(
            "uniffy.domains.chat.channels.creation.check_chat_mutation_limit",
            new=AsyncMock(),
        ),
        patch(
            "uniffy.domains.organizations.operations.write_audit_event",
            new=AsyncMock(side_effect=RuntimeError("organization audit unavailable")),
        ),
        pytest.raises(RuntimeError, match="organization audit unavailable"),
    ):
        await OrganizationOperations(session, search_indexer=search_indexer).create(
            name="Rollback organization",
            slug=slug,
            owner_user_id=env.admin_id,
        )

    async with open_session() as isolated:
        organization = (
            await isolated.execute(select(Organization).where(Organization.slug == slug))
        ).scalar_one_or_none()

    assert organization is None


async def test_organization_bootstrap_commits_required_rows_and_audits_once(
    session,
    env,
    search_indexer,
) -> None:
    slug = f"atomic-org-{generate_id().hex[:12]}"
    operations = OrganizationOperations(session, search_indexer=search_indexer)
    with (
        patch(
            "uniffy.domains.chat.channels.creation.check_chat_mutation_limit",
            new=AsyncMock(),
        ),
        patch.object(
            operations,
            "finish_organization_create_after_commit",
            new=AsyncMock(),
        ),
    ):
        organization = await operations.create(
            name="Atomic organization",
            slug=slug,
            owner_user_id=env.admin_id,
        )

    try:
        async with open_session() as isolated:
            membership = (
                await isolated.execute(
                    select(OrganizationMember).where(
                        OrganizationMember.organization_id == organization.id,
                        OrganizationMember.user_id == env.admin_id,
                    )
                )
            ).scalar_one()
            channel = (
                await isolated.execute(
                    select(ChatChannel).where(
                        ChatChannel.organization_id == organization.id,
                        ChatChannel.is_default.is_(True),
                    )
                )
            ).scalar_one()
            channel_member = (
                await isolated.execute(
                    select(ChatChannelMember).where(
                        ChatChannelMember.channel_id == channel.id,
                        ChatChannelMember.user_id == env.admin_id,
                    )
                )
            ).scalar_one()
            agent_count = (
                await isolated.execute(
                    select(func.count())
                    .select_from(Agent)
                    .where(
                        Agent.organization_id == organization.id,
                        Agent.is_default.is_(True),
                    )
                )
            ).scalar_one()
            defaults_count = (
                await isolated.execute(
                    select(func.count())
                    .select_from(OrganizationPermissionDefaults)
                    .where(OrganizationPermissionDefaults.organization_id == organization.id)
                )
            ).scalar_one()
            audit_actions = set(
                (
                    await isolated.execute(
                        select(AuditEvent.action).where(
                            AuditEvent.organization_id == organization.id
                        )
                    )
                ).scalars()
            )
            required_counts = {
                "identity": await isolated.scalar(
                    select(func.count())
                    .select_from(IdentitySource)
                    .where(IdentitySource.organization_id == organization.id)
                ),
                "encryption": await isolated.scalar(
                    select(func.count())
                    .select_from(OrgEncryptionKey)
                    .where(OrgEncryptionKey.organization_id == organization.id)
                ),
                "folder": await isolated.scalar(
                    select(func.count())
                    .select_from(Folder)
                    .where(Folder.organization_id == organization.id)
                ),
                "file_presets": await isolated.scalar(
                    select(func.count())
                    .select_from(SavedFileFilter)
                    .where(SavedFileFilter.organization_id == organization.id)
                ),
                "tag_presets": await isolated.scalar(
                    select(func.count())
                    .select_from(SavedTagFilter)
                    .where(SavedTagFilter.organization_id == organization.id)
                ),
            }

        assert membership.role == OrganizationRole.OWNER
        assert channel_member.user_id == env.admin_id
        assert agent_count == 1
        assert defaults_count > 0
        assert all(count and count > 0 for count in required_counts.values())
        assert Action.ORGANIZATION_CREATED in audit_actions
        assert Action.CHAT_CHANNEL_CREATED in audit_actions
    finally:
        await _delete_organization(session, organization.id)


async def test_organization_creation_survives_starter_content_failure(
    session,
    env,
    search_indexer,
) -> None:
    slug = f"degraded-org-{generate_id().hex[:12]}"
    operations = OrganizationOperations(session, search_indexer=search_indexer)
    operations._directory_projection.index_for_organization = AsyncMock()
    with (
        patch(
            "uniffy.domains.chat.channels.creation.check_chat_mutation_limit",
            new=AsyncMock(),
        ),
        patch(
            "uniffy.domains.organizations.operations.ChatChannelOperations.finish_channel_create_after_commit",
            new=AsyncMock(),
        ),
        patch(
            "uniffy.domains.organizations.operations.finish_default_agent_after_commit",
            new=AsyncMock(),
        ),
        patch(
            "uniffy.domains.organizations.operations.starter_content_enabled",
            return_value=True,
        ),
        patch(
            "uniffy.domains.organizations.operations.workspace_docs_available",
            return_value=True,
        ),
        patch(
            "uniffy.domains.organizations.operations.seed_workspace_docs",
            new=AsyncMock(side_effect=RuntimeError("starter content unavailable")),
        ),
    ):
        organization = await operations.create(
            name="Degraded organization",
            slug=slug,
            owner_user_id=env.admin_id,
        )

    try:
        async with open_session() as isolated:
            persisted = await isolated.get(Organization, organization.id)
            audit = (
                await isolated.execute(
                    select(AuditEvent).where(
                        AuditEvent.organization_id == organization.id,
                        AuditEvent.action == Action.ORGANIZATION_CREATED,
                    )
                )
            ).scalar_one_or_none()

        assert persisted is not None
        assert audit is not None
    finally:
        await _delete_organization(session, organization.id)
