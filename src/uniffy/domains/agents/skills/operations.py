"""Business logic for skill management."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, func, or_, select, tuple_
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.skill import (
    AgentSkill,
    AgentSkillOrigin,
    AgentSkillSource,
    AgentSkillStatus,
)
from uniffy.core.models.agents.skill_draft import (
    AgentSkillDraft,
    AgentSkillDraftKind,
    AgentSkillDraftStatus,
)
from uniffy.core.models.agents.skill_version import AgentSkillVersion, AgentSkillVersionAuthor
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.types import SubjectType
from uniffy.domains.agents.access import require_agents_builder
from uniffy.domains.agents.agents.operations import AgentOperations
from uniffy.domains.agents.cache import (
    invalidate_agents_using_skill,
)
from uniffy.domains.agents.policy import check_admin_content
from uniffy.domains.agents.runtime.images.config import apply_image_tool_schema, resolve_image_config
from uniffy.domains.agents.runtime.tooling import allowed_tool_names, resolve_tool_schemas
from uniffy.domains.agents.skills.resolution import (
    SkillSummary,
    SkillSurface,
    resolve_runnable_skills,
)
from uniffy.domains.agents.skills.validation import (
    SKILL_CONTENT_MAX,
    SKILL_DESCRIPTION_MAX,
    SKILL_DISPLAY_NAME_MAX,
    SKILL_NAME_MAX,
    SKILL_RATIONALE_MAX,
    cap_preserving_mentions,
    clean_skill_update,
    clean_skill_write,
    has_hard_injection,
    sanitize_skill_text,
    validate_supported_surfaces,
)
from uniffy.domains.agents.tools.registry import get_tool_registry
from uniffy.domains.chat import agents as chat_evt
from uniffy.domains.chat.agents import publish_channel_event_to_members
from uniffy.domains.integrations.advertisement import filter_integration_tool_schemas
from uniffy.domains.organizations.operations import OrganizationOperations

# The proposal path is reachable by any org member through an agent tool loop,
# so a single user cannot hold more than this many open drafts in the org-wide
# builder review inbox.
MAX_PENDING_DRAFTS_PER_USER = 25

# Validation field the draft review surface keys its replace-confirmation on.
SKILL_NAME_CONFLICT_FIELD = "skill_name_conflict"


class SkillOperations:
    """Operations for managing skill definitions."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._org_ops = OrganizationOperations(session)

    async def create_skill(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        display_name: str,
        description: str = "",
        content: str = "",
    ) -> AgentSkill:
        await require_agents_builder(self._session, user_id, organization_id)

        clean = clean_skill_write(
            name=name,
            display_name=display_name,
            description=description,
            content=content,
        )

        existing = await self._session.execute(
            select(AgentSkill).where(
                AgentSkill.organization_id == organization_id,
                AgentSkill.name == clean.name,
            )
        )
        if existing.scalar_one_or_none():
            raise ValidationError(
                "name", f"Skill name '{clean.name}' already exists in this organization"
            )

        # Soft natural-language injection patterns are warn-only; clean_skill_write
        # already rejected the hard structural delimiters.
        if clean.content:
            check_admin_content(clean.content, "skill_content")

        skill = AgentSkill(
            organization_id=organization_id,
            name=clean.name,
            display_name=clean.display_name,
            description=clean.description,
            content=clean.content,
            source="organization",
        )
        self._session.add(skill)
        await self._session.flush()
        await self.stage_skill_version(skill, author_id=user_id, author_kind="user")

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.AGENT_SKILL_CREATED,
            resource_type=AuditResourceType.SKILL,
            resource_id=skill.id,
            details={
                "name": clean.name,
                "display_name": clean.display_name,
            },
        )
        try:
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            raise
        await self._session.refresh(skill)

        return skill

    async def get_skill(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        skill_id: UUID,
    ) -> AgentSkill:
        """Fetch a bundled or org-specific skill by ID."""
        await self._org_ops.require_org_member(user_id, organization_id)

        result = await self._session.execute(
            select(AgentSkill).where(
                AgentSkill.id == skill_id,
                or_(
                    AgentSkill.organization_id == organization_id,
                    AgentSkill.organization_id.is_(None),
                ),
            )
        )
        skill = result.scalar_one_or_none()
        if not skill:
            raise NotFoundError("AgentSkill", str(skill_id))

        return skill

    async def list_skills(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[AgentSkill], int]:
        """List bundled and org-specific skills visible to the organization."""
        await self._org_ops.require_org_member(user_id, organization_id)

        # Retired bundled skills stay injectable for agents that already enabled
        # them, but they are gone from the pickers.
        base_filter = and_(
            or_(
                AgentSkill.organization_id == organization_id,
                AgentSkill.organization_id.is_(None),
            ),
            AgentSkill.status != AgentSkillStatus.RETIRED,
        )

        count_result = await self._session.execute(
            select(func.count()).select_from(AgentSkill).where(base_filter)
        )
        total = count_result.scalar() or 0

        offset = (page - 1) * page_size
        result = await self._session.execute(
            select(AgentSkill)
            .where(base_filter)
            .order_by(AgentSkill.source, AgentSkill.name)
            .offset(offset)
            .limit(page_size)
        )
        skills = list(result.scalars().all())
        return skills, total

    async def update_skill(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        skill_id: UUID,
        name: str | None = None,
        display_name: str | None = None,
        description: str | None = None,
        content: str | None = None,
    ) -> AgentSkill:
        """Update an organization skill; bundled skills are read-only."""
        result = await self._session.execute(
            select(AgentSkill).where(
                AgentSkill.id == skill_id,
                AgentSkill.organization_id == organization_id,
            )
        )
        skill = result.scalar_one_or_none()
        if not skill:
            # Check if it's a bundled skill
            bundled = await self._session.execute(
                select(AgentSkill).where(
                    AgentSkill.id == skill_id,
                    AgentSkill.organization_id.is_(None),
                )
            )
            if bundled.scalar_one_or_none():
                raise PermissionDeniedError("update", "Cannot update bundled skills")
            raise NotFoundError("AgentSkill", str(skill_id))

        await require_agents_builder(self._session, user_id, organization_id)

        # Partial updates are held to the same caps and hard-injection guard as a
        # full write, so a raw UpdateSkill cannot land content a CreateSkill would
        # reject. The softer warn-only content policy still runs below.
        clean = clean_skill_update(
            name=name,
            display_name=display_name,
            description=description,
            content=content,
        )

        versioned_changes: list[str] = []

        # The slug is the stable identifier agents and enrollments resolve
        # against, so it is fixed at creation; the display name carries renames.
        if clean.name is not None and clean.name != skill.name:
            raise ValidationError("name", "Skill name cannot be changed after creation")

        if clean.display_name is not None:
            if clean.display_name != skill.display_name:
                versioned_changes.append("display name")
            skill.display_name = clean.display_name

        if clean.description is not None:
            if clean.description != (skill.description or ""):
                versioned_changes.append("description")
            skill.description = clean.description

        if clean.content is not None:
            if clean.content:
                check_admin_content(clean.content, "skill_content")
            if clean.content != (skill.content or ""):
                versioned_changes.append("content")
            skill.content = clean.content

        if versioned_changes:
            await self.stage_skill_version(
                skill,
                author_id=user_id,
                author_kind="user",
                change_summary=f"Updated {', '.join(versioned_changes)}",
            )

        audit_changes: dict = {}
        if clean.display_name is not None:
            audit_changes["display_name"] = clean.display_name
        if clean.content is not None:
            audit_changes["content_updated"] = True

        skill.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(skill)

        if audit_changes:
            await write_audit_event(
                self._session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.AGENT_SKILL_UPDATED,
                resource_type=AuditResourceType.SKILL,
                resource_id=skill_id,
                details={"changes": audit_changes},
            )
            await self._session.commit()

        await invalidate_agents_using_skill(skill_id)

        return skill

    async def delete_skill(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        skill_id: UUID,
    ) -> None:
        """Delete an organization skill and strip its ID from every agent's
        enabled_skills; bundled skills are read-only."""
        result = await self._session.execute(
            select(AgentSkill).where(
                AgentSkill.id == skill_id,
                AgentSkill.organization_id == organization_id,
            )
        )
        skill = result.scalar_one_or_none()
        if not skill:
            # Check if it's a bundled skill
            bundled = await self._session.execute(
                select(AgentSkill).where(
                    AgentSkill.id == skill_id,
                    AgentSkill.organization_id.is_(None),
                )
            )
            if bundled.scalar_one_or_none():
                raise PermissionDeniedError("delete", "Cannot delete bundled skills")
            raise NotFoundError("AgentSkill", str(skill_id))

        await require_agents_builder(self._session, user_id, organization_id)

        # Remove skill ID from agents' enabled_skills lists
        skill_id_str = str(skill_id)
        agents_result = await self._session.execute(
            select(Agent).where(
                Agent.organization_id == organization_id,
                Agent.enabled_skills.cast(JSONB).contains([skill_id_str]),
            )
        )
        for agent in agents_result.scalars().all():
            agent.enabled_skills = [sid for sid in agent.enabled_skills if sid != skill_id_str]

        skill_name = skill.name
        await self._session.delete(skill)
        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.AGENT_SKILL_DELETED,
            resource_type=AuditResourceType.SKILL,
            resource_id=skill_id,
            details={"name": skill_name},
        )
        await self._session.commit()

        await invalidate_agents_using_skill(skill_id, drop_tag_set=True)

    async def create_skill_draft(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        kind: str,
        target_skill_id: UUID | None = None,
        name: str = "",
        display_name: str = "",
        description: str = "",
        content: str = "",
        requires_tools: list[str] | None = None,
        supported_surfaces: list[str] | None = None,
        rationale: str = "",
    ) -> AgentSkillDraft:
        """Persist a user-authored draft awaiting review; activates nothing."""
        await require_agents_builder(self._session, user_id, organization_id)
        if kind not in ("create", "edit", "evolve"):
            raise ValidationError("kind", f"Unknown draft kind '{kind}'")
        if kind in ("edit", "evolve"):
            if target_skill_id is None:
                raise ValidationError("target_skill_id", "Edit drafts require a target skill")
            # View-gate the target so a draft can't reference an unseen skill.
            await self.get_skill(
                user_id=user_id, organization_id=organization_id, skill_id=target_skill_id
            )

        draft = AgentSkillDraft(
            organization_id=organization_id,
            owner_id=user_id,
            target_skill_id=target_skill_id,
            kind=kind,
            rationale=sanitize_skill_text(rationale),
            name=(name or "").strip()[:SKILL_NAME_MAX] or None,
            display_name=(display_name or "").strip()[:SKILL_DISPLAY_NAME_MAX] or None,
            description=sanitize_skill_text(description),
            content=sanitize_skill_text(content),
            requires_tools=list(requires_tools or []),
            supported_surfaces=validate_supported_surfaces(supported_surfaces),
            status="pending",
        )
        self._session.add(draft)
        await self._session.commit()
        await self._session.refresh(draft)
        return draft

    async def propose_skill_draft(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID | None,
        session_id: UUID | None,
        kind: str,
        target_skill_id: UUID | None,
        name: str,
        display_name: str,
        description: str = "",
        content: str = "",
        requires_tools: list[str] | None = None,
        supported_surfaces: list[str] | None = None,
        rationale: str = "",
    ) -> AgentSkillDraft:
        """Persist an agent-proposed draft (status=pending); never auto-activates.

        Called from the ``skills.propose_skill`` tool inside a run that has
        already gated the acting user, so it does no permission check of its own.
        Being the one ungated write, it carries its own bounds: every free-text
        field is capped, hard delimiter-injection markers are rejected before the
        text can render for a reviewer, and one user's open drafts are quota'd so
        a looped agent cannot flood the org-wide inbox.
        """
        clean_content = cap_preserving_mentions(sanitize_skill_text(content), SKILL_CONTENT_MAX)
        clean_description = cap_preserving_mentions(
            sanitize_skill_text(description), SKILL_DESCRIPTION_MAX
        )
        clean_rationale = cap_preserving_mentions(
            sanitize_skill_text(rationale), SKILL_RATIONALE_MAX
        )
        if has_hard_injection(clean_content, clean_description, clean_rationale):
            raise ValidationError(
                "content", "Skill content contains a disallowed system-prompt delimiter"
            )
        await self._require_pending_draft_quota(user_id, organization_id)

        seed_tools = requires_tools
        seed_context = supported_surfaces
        # Preserve requirements when the proposal only supplies new content.
        if (
            kind in ("edit", "evolve")
            and target_skill_id is not None
            and (seed_tools is None or seed_context is None)
        ):
            target = await self._load_skill_for_seed(organization_id, target_skill_id)
            if target is not None:
                if seed_tools is None:
                    seed_tools = list(target.requires_tools or [])
                if seed_context is None:
                    seed_context = list(target.supported_surfaces or [])

        draft = AgentSkillDraft(
            organization_id=organization_id,
            owner_id=user_id,
            target_skill_id=target_skill_id,
            kind=kind,
            proposed_by_agent_id=agent_id,
            session_id=session_id,
            rationale=clean_rationale,
            name=(name or "").strip()[:SKILL_NAME_MAX] or None,
            display_name=(display_name or "").strip()[:SKILL_DISPLAY_NAME_MAX] or None,
            description=clean_description,
            content=clean_content,
            requires_tools=list(seed_tools or []),
            supported_surfaces=validate_supported_surfaces(seed_context),
            status="pending",
        )
        self._session.add(draft)
        await self._session.commit()
        await self._session.refresh(draft)
        return draft

    async def get_skill_draft(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        draft_id: UUID,
    ) -> AgentSkillDraft:
        """Fetch a draft from the builder review inbox."""
        await require_agents_builder(self._session, user_id, organization_id)
        return await self._get_draft(organization_id=organization_id, draft_id=draft_id)

    async def list_skill_drafts(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        status: str = "pending",
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[AgentSkillDraft], int]:
        """List the org's drafts (the builder review inbox), newest first."""
        await require_agents_builder(self._session, user_id, organization_id)
        filters = [
            AgentSkillDraft.organization_id == organization_id,
            AgentSkillDraft.is_deleted == False,  # noqa: E712
        ]
        if status:
            filters.append(AgentSkillDraft.status == status)

        count_result = await self._session.execute(
            select(func.count()).select_from(AgentSkillDraft).where(*filters)
        )
        total = count_result.scalar() or 0

        offset = (page - 1) * page_size
        result = await self._session.execute(
            select(AgentSkillDraft)
            .where(*filters)
            .order_by(AgentSkillDraft.created_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        return list(result.scalars().all()), total

    async def save_skill_draft(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        draft_id: UUID,
        name: str,
        display_name: str,
        description: str = "",
        content: str = "",
        requires_tools: list[str] | None = None,
        supported_surfaces: list[str] | None = None,
        change_summary: str = "",
        allow_replace: bool = False,
    ) -> tuple[AgentSkill, AgentSkillVersion]:
        """Commit a pending draft to a skill version using the reviewer's edits.

        A create draft becomes a new skill at version 1; an edit/evolve draft
        appends a new version to its target.
        """
        await require_agents_builder(self._session, user_id, organization_id)
        draft = await self._get_draft(
            organization_id=organization_id,
            draft_id=draft_id,
            require_pending=True,
        )

        clean = clean_skill_write(
            name=name,
            display_name=display_name,
            description=description,
            content=content,
        )
        if clean.content:
            check_admin_content(clean.content, "skill_content")

        author_kind = (
            AgentSkillVersionAuthor.AGENT
            if draft.proposed_by_agent_id
            else AgentSkillVersionAuthor.USER
        )
        author_id = None if author_kind is AgentSkillVersionAuthor.AGENT else user_id

        # Two skills can never share a machine name in an org, so a create draft
        # whose name already belongs to one can only be saved by versioning that
        # skill. Any org member can raise a create draft with an arbitrary name,
        # so the reviewer must acknowledge the replacement: without
        # allow_replace the save is refused rather than quietly rewriting the
        # content of a skill the inbox presented as new.
        reconcile_id = draft.target_skill_id
        if draft.kind == AgentSkillDraftKind.CREATE and reconcile_id is None:
            collision = await self._find_skill_by_name(organization_id, clean.name)
            if collision is not None:
                if not allow_replace:
                    raise ValidationError(
                        SKILL_NAME_CONFLICT_FIELD,
                        f"A skill named '{collision.display_name}' already uses the identifier "
                        f"'{clean.name}'. Saving this draft replaces its content with a new "
                        "version.",
                    )
                reconcile_id = collision.id

        if draft.kind == AgentSkillDraftKind.CREATE and reconcile_id is None:
            await self._require_unique_name(organization_id, clean.name)
            origin = (
                AgentSkillOrigin.AGENT_PROPOSED
                if draft.proposed_by_agent_id
                else AgentSkillOrigin.USER
            )
            skill = AgentSkill(
                organization_id=organization_id,
                name=clean.name,
                display_name=clean.display_name,
                description=clean.description,
                content=clean.content,
                source=AgentSkillSource.ORGANIZATION,
                requires_tools=list(requires_tools or []),
                supported_surfaces=validate_supported_surfaces(supported_surfaces),
                status=AgentSkillStatus.ACTIVE,
                origin=origin,
                created_by_agent_id=draft.proposed_by_agent_id,
            )
            self._session.add(skill)
            await self._session.flush()
            version = await self.stage_skill_version(
                skill,
                author_id=author_id,
                author_kind=author_kind,
                change_summary=change_summary or "Initial version",
            )
            audit_action = Action.AGENT_SKILL_CREATED
        else:
            skill = await self._load_skill_for_edit(
                user_id=user_id,
                organization_id=organization_id,
                skill_id=reconcile_id,
            )
            if clean.name != skill.name:
                await self._require_unique_name(organization_id, clean.name, exclude_id=skill.id)
            new_tools = list(requires_tools or [])
            new_context = validate_supported_surfaces(supported_surfaces)
            versioned_changed = (
                clean.name != skill.name
                or clean.display_name != skill.display_name
                or clean.description != (skill.description or "")
                or clean.content != (skill.content or "")
                or new_tools != list(skill.requires_tools or [])
                or new_context != list(skill.supported_surfaces or [])
            )
            skill.name = clean.name
            skill.display_name = clean.display_name
            skill.description = clean.description
            skill.content = clean.content
            skill.requires_tools = new_tools
            skill.supported_surfaces = new_context
            skill.updated_at = datetime.now(UTC)
            if versioned_changed:
                version = await self.stage_skill_version(
                    skill,
                    author_id=author_id,
                    author_kind=author_kind,
                    change_summary=change_summary or "Edited via draft",
                )
            else:
                version = await self._load_active_version(skill)
            audit_action = Action.AGENT_SKILL_UPDATED

        draft.status = AgentSkillDraftStatus.SAVED
        await self._session.commit()
        await self._session.refresh(skill)
        await self._session.refresh(version)

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=audit_action,
            resource_type=AuditResourceType.SKILL,
            resource_id=skill.id,
            details={
                "name": skill.name,
                "from_draft": str(draft.id),
                "version": version.version_number,
            },
        )
        await self._session.commit()

        await invalidate_agents_using_skill(skill.id)

        await self._notify_chat_draft_resolved(draft, status="saved", saved_skill_id=skill.id)
        return skill, version

    async def discard_skill_draft(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        draft_id: UUID,
    ) -> None:
        """Soft-discard a pending draft. Activates nothing."""
        await require_agents_builder(self._session, user_id, organization_id)
        draft = await self._get_draft(
            organization_id=organization_id,
            draft_id=draft_id,
            require_pending=True,
        )
        draft.status = AgentSkillDraftStatus.DISCARDED
        draft.is_deleted = True
        draft.deleted_at = datetime.now(UTC)
        await self._session.commit()
        await self._notify_chat_draft_resolved(draft, status="discarded")

    async def list_skill_versions(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        skill_id: UUID,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[AgentSkillVersion], int, AgentSkill]:
        """List a skill's immutable versions, newest first.

        Returns the skill too so the caller can echo the current main-version
        pointer. View-gated through ``get_skill``.
        """
        skill = await self.get_skill(
            user_id=user_id, organization_id=organization_id, skill_id=skill_id
        )
        count_result = await self._session.execute(
            select(func.count())
            .select_from(AgentSkillVersion)
            .where(AgentSkillVersion.skill_id == skill_id)
        )
        total = count_result.scalar() or 0

        offset = (page - 1) * page_size
        result = await self._session.execute(
            select(AgentSkillVersion)
            .where(AgentSkillVersion.skill_id == skill_id)
            .order_by(AgentSkillVersion.version_number.desc())
            .offset(offset)
            .limit(page_size)
        )
        return list(result.scalars().all()), total, skill

    async def get_skill_version(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        skill_id: UUID,
        version_number: int,
    ) -> AgentSkillVersion:
        """Fetch a single version of a skill by number. View-gated."""
        await self.get_skill(user_id=user_id, organization_id=organization_id, skill_id=skill_id)
        return await self._get_version(skill_id, version_number)

    async def set_main_skill_version(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        skill_id: UUID,
        version_number: int | None,
        follow_latest: bool,
    ) -> AgentSkill:
        skill = await self._load_skill_for_edit(
            user_id=user_id, organization_id=organization_id, skill_id=skill_id
        )

        if follow_latest:
            latest = await self._get_version(skill_id, skill.latest_version_number)
            skill.active_version_pinned = False
            skill.active_version_id = latest.id
        else:
            if version_number is None:
                raise ValidationError("version_number", "A version number is required to pin")
            target = await self._get_version(skill_id, version_number)
            skill.active_version_pinned = True
            skill.active_version_id = target.id

        skill.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(skill)

        await invalidate_agents_using_skill(skill_id)
        return skill

    async def revert_skill(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        skill_id: UUID,
        version_number: int,
    ) -> tuple[AgentSkill, AgentSkillVersion]:
        """Copy an earlier version's content into a new version at the head.

        The new version follows the same main-version rule as any edit: it
        becomes active when the skill is unpinned, and merely lands in history
        when a version is pinned.
        """
        skill = await self._load_skill_for_edit(
            user_id=user_id, organization_id=organization_id, skill_id=skill_id
        )
        target = await self._get_version(skill_id, version_number)

        if target.name != skill.name:
            await self._require_unique_name(organization_id, target.name, exclude_id=skill.id)

        skill.name = target.name
        skill.display_name = target.display_name
        skill.description = target.description or ""
        skill.content = target.content or ""
        skill.requires_tools = list(target.requires_tools or [])
        skill.supported_surfaces = list(target.supported_surfaces or [])
        skill.updated_at = datetime.now(UTC)
        version = await self.stage_skill_version(
            skill,
            author_id=user_id,
            author_kind="user",
            change_summary=f"Reverted to version {version_number}",
        )
        await self._session.commit()
        await self._session.refresh(skill)
        await self._session.refresh(version)

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.AGENT_SKILL_UPDATED,
            resource_type=AuditResourceType.SKILL,
            resource_id=skill_id,
            details={"reverted_to": version_number, "new_version": version.version_number},
        )
        await self._session.commit()

        await invalidate_agents_using_skill(skill_id)
        return skill, version

    async def resolve_active_version_number(self, skill: AgentSkill) -> int:
        return (await self.resolve_active_version_numbers([skill]))[skill.id]

    async def resolve_active_version_numbers(self, skills: list[AgentSkill]) -> dict[UUID, int]:
        if not skills:
            return {}
        if any(skill.active_version_id is None for skill in skills):
            raise ValidationError("active_version_id", "A skill's active version is unavailable")
        result = await self._session.execute(
            select(AgentSkillVersion.skill_id, AgentSkillVersion.version_number).where(
                tuple_(AgentSkillVersion.skill_id, AgentSkillVersion.id).in_([
                    (skill.id, skill.active_version_id) for skill in skills
                ])
            )
        )
        numbers = dict(result.all())
        if set(numbers) != {skill.id for skill in skills}:
            raise ValidationError("active_version_id", "A skill's active version is unavailable")
        return numbers

    async def _get_version(self, skill_id: UUID, version_number: int) -> AgentSkillVersion:
        version = await self._get_version_or_none(skill_id, version_number)
        if version is None:
            raise NotFoundError("AgentSkillVersion", f"{skill_id}:{version_number}")
        return version

    async def _load_active_version(self, skill: AgentSkill) -> AgentSkillVersion:
        if skill.active_version_id is not None:
            version = await self._session.get(AgentSkillVersion, skill.active_version_id)
            if version is not None and version.skill_id == skill.id:
                return version
        raise ValidationError("active_version_id", "The skill's active version is unavailable")

    async def _get_version_or_none(
        self, skill_id: UUID, version_number: int
    ) -> AgentSkillVersion | None:
        result = await self._session.execute(
            select(AgentSkillVersion).where(
                AgentSkillVersion.skill_id == skill_id,
                AgentSkillVersion.version_number == version_number,
            )
        )
        return result.scalar_one_or_none()

    async def _load_skill_for_edit(
        self, *, user_id: UUID, organization_id: UUID, skill_id: UUID | None
    ) -> AgentSkill:
        await require_agents_builder(self._session, user_id, organization_id)
        return await self._load_editable_skill(organization_id, skill_id)

    async def _get_draft(
        self,
        *,
        organization_id: UUID,
        draft_id: UUID,
        require_pending: bool = False,
    ) -> AgentSkillDraft:
        result = await self._session.execute(
            select(AgentSkillDraft).where(
                AgentSkillDraft.id == draft_id,
                AgentSkillDraft.organization_id == organization_id,
                AgentSkillDraft.is_deleted == False,  # noqa: E712
            )
        )
        draft = result.scalar_one_or_none()
        if draft is None:
            raise NotFoundError("AgentSkillDraft", str(draft_id))
        if require_pending and draft.status != AgentSkillDraftStatus.PENDING:
            raise ValidationError("status", "This draft has already been resolved")
        return draft

    async def _require_pending_draft_quota(self, user_id: UUID, organization_id: UUID) -> None:
        count = (
            await self._session.execute(
                select(func.count())
                .select_from(AgentSkillDraft)
                .where(
                    AgentSkillDraft.organization_id == organization_id,
                    AgentSkillDraft.owner_id == user_id,
                    AgentSkillDraft.status == AgentSkillDraftStatus.PENDING,
                    AgentSkillDraft.is_deleted == False,  # noqa: E712
                )
            )
        ).scalar() or 0
        if count >= MAX_PENDING_DRAFTS_PER_USER:
            raise ValidationError(
                "drafts",
                f"You already have {MAX_PENDING_DRAFTS_PER_USER} skill drafts awaiting "
                "review. Ask a builder to review them before proposing more.",
            )

    async def _require_unique_name(
        self, organization_id: UUID, name: str, *, exclude_id: UUID | None = None
    ) -> None:
        filters = [
            AgentSkill.organization_id == organization_id,
            AgentSkill.name == name,
        ]
        if exclude_id is not None:
            filters.append(AgentSkill.id != exclude_id)
        existing = await self._session.execute(select(AgentSkill).where(*filters))
        if existing.scalar_one_or_none():
            raise ValidationError("name", f"Skill name '{name}' already exists in this organization")

    async def _load_skill_for_seed(self, organization_id: UUID, skill_id: UUID) -> AgentSkill | None:
        """Read an org or bundled skill by id to seed a draft; no permission gate."""
        result = await self._session.execute(
            select(AgentSkill).where(
                AgentSkill.id == skill_id,
                or_(
                    AgentSkill.organization_id == organization_id,
                    AgentSkill.organization_id.is_(None),
                ),
            )
        )
        return result.scalar_one_or_none()

    async def _find_skill_by_name(self, organization_id: UUID, name: str) -> AgentSkill | None:
        """Return the org's skill with this exact machine name, if any."""
        result = await self._session.execute(
            select(AgentSkill).where(
                AgentSkill.organization_id == organization_id,
                AgentSkill.name == name,
            )
        )
        return result.scalar_one_or_none()

    async def _load_editable_skill(
        self, organization_id: UUID, target_skill_id: UUID | None
    ) -> AgentSkill:
        if target_skill_id is None:
            raise ValidationError("target_skill_id", "Edit drafts require a target skill")
        result = await self._session.execute(
            select(AgentSkill).where(
                AgentSkill.id == target_skill_id,
                AgentSkill.organization_id == organization_id,
            )
        )
        skill = result.scalar_one_or_none()
        if skill is not None:
            return skill
        bundled = await self._session.execute(
            select(AgentSkill).where(
                AgentSkill.id == target_skill_id,
                AgentSkill.organization_id.is_(None),
            )
        )
        if bundled.scalar_one_or_none():
            raise PermissionDeniedError("update", "Cannot edit bundled skills")
        raise NotFoundError("AgentSkill", str(target_skill_id))

    async def list_runnable_skills(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        surface: SkillSurface,
    ) -> list[SkillSummary]:
        agent = await AgentOperations(self._session).get_for_runtime(
            user_id, organization_id, agent_id
        )
        if not agent.enabled_skills:
            return []
        schemas = resolve_tool_schemas(get_tool_registry(), agent.enabled_tools or [])
        image_config = await resolve_image_config(
            self._session, agent, organization_id=organization_id
        )
        schemas = apply_image_tool_schema(schemas, image_config)
        schemas = await filter_integration_tool_schemas(self._session, organization_id, schemas)
        return await resolve_runnable_skills(
            self._session,
            organization_id=organization_id,
            enabled_skill_ids=agent.enabled_skills,
            surface=surface,
            executable_tools=allowed_tool_names(schemas),
        )

    async def resolve_bundled_skill_id_map(self, names: list[str]) -> dict[str, str]:
        """Map bundled skill names to row ids; unseeded names are absent."""
        if not names:
            return {}

        result = await self._session.execute(
            select(AgentSkill.id, AgentSkill.name).where(
                AgentSkill.organization_id.is_(None),
                AgentSkill.source == AgentSkillSource.BUNDLED,
                AgentSkill.name.in_(names),
            )
        )
        return {row[1]: str(row[0]) for row in result.all()}

    async def resolve_bundled_skill_ids(self, names: list[str]) -> list[str]:
        id_by_name = await self.resolve_bundled_skill_id_map(names)
        return [id_by_name[name] for name in names if name in id_by_name]

    async def stage_skill_version(
        self,
        skill: AgentSkill,
        *,
        author_id: UUID | None,
        author_kind: AgentSkillVersionAuthor = AgentSkillVersionAuthor.USER,
        change_summary: str = "",
    ) -> AgentSkillVersion:
        """Stage an immutable snapshot while preserving a pinned active version."""
        result = await self._session.execute(
            select(func.max(AgentSkillVersion.version_number)).where(
                AgentSkillVersion.skill_id == skill.id
            )
        )
        next_number = (result.scalar() or 0) + 1
        version = AgentSkillVersion(
            skill_id=skill.id,
            version_number=next_number,
            name=skill.name,
            display_name=skill.display_name,
            description=skill.description or "",
            content=skill.content or "",
            requires_tools=list(skill.requires_tools or []),
            supported_surfaces=list(skill.supported_surfaces or []),
            author_id=author_id,
            author_kind=author_kind,
            change_summary=change_summary,
            parent_version_id=skill.active_version_id,
        )
        self._session.add(version)
        await self._session.flush()
        skill.latest_version_number = next_number
        if not skill.active_version_pinned:
            skill.active_version_id = version.id
        return version

    async def _notify_chat_draft_resolved(
        self,
        draft: AgentSkillDraft,
        *,
        status: str,
        saved_skill_id: UUID | None = None,
    ) -> None:
        """Flip a chat-origin draft card to its resolved state and fan it out.

        A no-op for drafts that did not originate from a chat message. Stamps
        the original card row's metadata (wire type ``map<string,string>``) so
        every channel member sees the card settle to saved/discarded.
        """
        if draft.channel_id is None or draft.origin_chat_message_id is None:
            return
        msg = await self._session.get(ChatMessage, draft.origin_chat_message_id)
        if msg is None:
            return
        new_meta = {**(msg.message_metadata or {}), "draft_status": status}
        if saved_skill_id is not None:
            new_meta["saved_skill_id"] = str(saved_skill_id)
        payload = chat_evt.build_message_payload(
            message_id=msg.id,
            channel_id=msg.channel_id,
            sender_id=msg.sender_id,
            sender_type=msg.sender_type.value
            if hasattr(msg.sender_type, "value")
            else str(msg.sender_type),
            content=msg.content or "",
            root_id=msg.root_id,
            created_at=msg.created_at,
            metadata=new_meta,
            reply_to_id=msg.reply_to_id,
        )
        msg.message_metadata = new_meta
        await self._session.commit()
        members = await self._session.execute(
            select(ChatChannelMember.subject_id).where(
                ChatChannelMember.channel_id == draft.channel_id,
                ChatChannelMember.subject_type == SubjectType.USER,
            )
        )
        member_ids = [r[0] for r in members.all()]
        await publish_channel_event_to_members(
            member_ids,
            chat_evt.MESSAGE_UPDATED,
            payload,
            channel_id=draft.channel_id,
        )
