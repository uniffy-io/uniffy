"""Business logic for skill management."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.models.agents.message_feedback import AgentMessageFeedback
from uniffy.core.models.agents.session import AgentSession
from uniffy.core.models.agents.skill import AgentSkill
from uniffy.core.models.agents.skill_draft import AgentSkillDraft
from uniffy.core.models.agents.skill_usage import AgentSkillUsage
from uniffy.core.models.agents.skill_version import AgentSkillVersion
from uniffy.domains.agents.cache import (
    invalidate_agents_using_skill,
    invalidate_org_always_active_skills,
)
from uniffy.domains.agents.content_policy import check_admin_content
from uniffy.domains.agents.skills.validation import (
    SKILL_DISPLAY_NAME_MAX,
    SKILL_NAME_MAX,
    clean_skill_write,
    sanitize_skill_text,
)
from uniffy.domains.organizations.operations import OrganizationOperations


class SkillOperations:
    """Operations for managing skill definitions.

    Parameters
    ----------
    session : AsyncSession
        Database session.

    """

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
        always_active: bool = False,
        owner_id: UUID | None = None,
    ) -> AgentSkill:
        """Create a new organization skill.

        Only org admins can create skills.

        Parameters
        ----------
        user_id : UUID
            The user creating the skill.
        organization_id : UUID
            Organization context.
        name : str
            Machine name (unique within org).
        display_name : str
            Human-readable name.
        description : str
            Short description.
        content : str
            Markdown instructions for the system prompt.
        always_active : bool
            Whether to always inject this skill.
        owner_id : UUID | None
            Owner user ID for personal skills.

        Returns
        -------
        AgentSkill
            The created skill.

        Raises
        ------
        PermissionDeniedError
            If user is not an org admin.
        ValidationError
            If name is empty or already taken.

        """
        await self._org_ops.require_org_admin(user_id, organization_id)

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

        source = "personal" if owner_id else "organization"
        skill = AgentSkill(
            organization_id=organization_id,
            name=clean.name,
            display_name=clean.display_name,
            description=clean.description,
            content=clean.content,
            source=source,
            always_active=always_active,
            owner_id=owner_id,
        )
        self._session.add(skill)
        await self._session.flush()
        await self._snapshot_version(skill, author_id=user_id, author_kind="user")
        await self._session.commit()
        await self._session.refresh(skill)

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.AGENT_SKILL_CREATED,
            resource_type="skill",
            resource_id=skill.id,
            details={
                "name": clean.name,
                "display_name": clean.display_name,
                "always_active": always_active,
            },
        )
        await self._session.commit()

        return skill

    async def get_skill(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        skill_id: UUID,
    ) -> AgentSkill:
        """Fetch a skill by ID.

        Returns bundled skills or org-specific skills.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        skill_id : UUID
            Skill to fetch.

        Returns
        -------
        AgentSkill
            The skill.

        Raises
        ------
        NotFoundError
            If the skill does not exist or is not accessible.
        PermissionDeniedError
            If user is not an org member.

        """
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
        """List skills visible to the organization.

        Returns both bundled skills and organization-specific skills.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        page : int
            Page number (1-based).
        page_size : int
            Results per page.

        Returns
        -------
        tuple[list[AgentSkill], int]
            (skills, total_count).

        Raises
        ------
        PermissionDeniedError
            If user is not an org member.

        """
        await self._org_ops.require_org_member(user_id, organization_id)

        base_filter = or_(
            AgentSkill.organization_id == organization_id,
            AgentSkill.organization_id.is_(None),
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
        always_active: bool | None = None,
    ) -> AgentSkill:
        """Update an organization skill.

        Cannot update bundled skills.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        skill_id : UUID
            Skill to update.
        name : str | None
            New machine name (None = no change).
        display_name : str | None
            New display name (None = no change).
        description : str | None
            New description (None = no change).
        content : str | None
            New content (None = no change).
        always_active : bool | None
            New always_active flag (None = no change).

        Returns
        -------
        AgentSkill
            The updated skill.

        Raises
        ------
        NotFoundError
            If the skill does not exist.
        PermissionDeniedError
            If user is not an org admin or skill is bundled.
        ValidationError
            If name is empty or already taken.

        """
        await self._org_ops.require_org_admin(user_id, organization_id)

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

        was_always_active = skill.always_active
        versioned_changes: list[str] = []

        if name is not None:
            if not name.strip():
                raise ValidationError("name", "Skill name cannot be empty")
            # Check uniqueness if name is changing
            if name.strip() != skill.name:
                existing = await self._session.execute(
                    select(AgentSkill).where(
                        AgentSkill.organization_id == organization_id,
                        AgentSkill.name == name.strip(),
                        AgentSkill.id != skill_id,
                    )
                )
                if existing.scalar_one_or_none():
                    raise ValidationError(
                        "name", f"Skill name '{name}' already exists in this organization"
                    )
                versioned_changes.append("name")
            skill.name = name.strip()

        if display_name is not None:
            if not display_name.strip():
                raise ValidationError("display_name", "Skill display name cannot be empty")
            if display_name.strip() != skill.display_name:
                versioned_changes.append("display name")
            skill.display_name = display_name.strip()

        if description is not None:
            if description != skill.description:
                versioned_changes.append("description")
            skill.description = description

        if content is not None:
            # Content policy check on skill content (warn-only)
            if content:
                check_admin_content(content, "skill_content")
            if content != skill.content:
                versioned_changes.append("content")
            skill.content = content

        if always_active is not None:
            skill.always_active = always_active

        # A content/metadata edit lands as a new immutable version; an
        # always_active-only toggle touches the row but adds no version.
        if versioned_changes:
            await self._snapshot_version(
                skill,
                author_id=user_id,
                author_kind="user",
                change_summary=f"Updated {', '.join(versioned_changes)}",
            )

        # Build audit details from changed fields
        audit_changes: dict = {}
        if name is not None:
            audit_changes["name"] = name
        if display_name is not None:
            audit_changes["display_name"] = display_name
        if content is not None:
            audit_changes["content_updated"] = True
        if always_active is not None:
            audit_changes["always_active"] = always_active

        skill.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(skill)

        if audit_changes:
            await write_audit_event(
                self._session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.AGENT_SKILL_UPDATED,
                resource_type="skill",
                resource_id=skill_id,
                details={"changes": audit_changes},
            )
            await self._session.commit()

        await invalidate_agents_using_skill(skill_id)

        if was_always_active or skill.always_active:
            await invalidate_org_always_active_skills(organization_id)

        return skill

    async def delete_skill(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        skill_id: UUID,
    ) -> None:
        """Delete an organization skill.

        Cannot delete bundled skills. Removes the skill ID from all
        agents' enabled_skills lists.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        skill_id : UUID
            Skill to delete.

        Raises
        ------
        NotFoundError
            If the skill does not exist.
        PermissionDeniedError
            If user is not an org admin or skill is bundled.

        """
        await self._org_ops.require_org_admin(user_id, organization_id)

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
        was_always_active = skill.always_active
        await self._session.delete(skill)
        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.AGENT_SKILL_DELETED,
            resource_type="skill",
            resource_id=skill_id,
            details={"name": skill_name},
        )
        await self._session.commit()

        await invalidate_agents_using_skill(skill_id, drop_tag_set=True)

        if was_always_active:
            await invalidate_org_always_active_skills(organization_id)

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
        when_to_use: str = "",
        requires_tools: list[str] | None = None,
        requires_context: list[str] | None = None,
        suggested_scope: str = "personal",
        suggested_always_active: bool = False,
        rationale: str = "",
    ) -> AgentSkillDraft:
        """Persist a user-authored draft awaiting review; activates nothing."""
        await self._org_ops.require_org_member(user_id, organization_id)
        if kind not in ("create", "edit", "evolve"):
            raise ValidationError("kind", f"Unknown draft kind '{kind}'")
        if suggested_scope not in ("personal", "organization"):
            raise ValidationError("suggested_scope", f"Unknown scope '{suggested_scope}'")
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
            when_to_use=sanitize_skill_text(when_to_use),
            requires_tools=list(requires_tools or []),
            requires_context=list(requires_context or []),
            suggested_scope=suggested_scope,
            suggested_always_active=suggested_always_active,
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
        when_to_use: str = "",
        suggested_scope: str = "personal",
        suggested_always_active: bool = False,
        rationale: str = "",
    ) -> AgentSkillDraft:
        """Persist an agent-proposed draft (status=pending); never auto-activates.

        Called from the ``skills.propose_skill`` tool inside a run that has
        already gated the acting user, so it does no permission check of its own.
        """
        draft = AgentSkillDraft(
            organization_id=organization_id,
            owner_id=user_id,
            target_skill_id=target_skill_id,
            kind=kind,
            proposed_by_agent_id=agent_id,
            session_id=session_id,
            rationale=sanitize_skill_text(rationale),
            name=(name or "").strip()[:SKILL_NAME_MAX] or None,
            display_name=(display_name or "").strip()[:SKILL_DISPLAY_NAME_MAX] or None,
            description=sanitize_skill_text(description),
            content=sanitize_skill_text(content),
            when_to_use=sanitize_skill_text(when_to_use),
            suggested_scope=suggested_scope,
            suggested_always_active=suggested_always_active,
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
        """Fetch a draft the user owns."""
        await self._org_ops.require_org_member(user_id, organization_id)
        return await self._get_owned_draft(
            user_id=user_id, organization_id=organization_id, draft_id=draft_id
        )

    async def list_skill_drafts(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        status: str = "pending",
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[AgentSkillDraft], int]:
        """List the user's own drafts (the review inbox), newest first."""
        await self._org_ops.require_org_member(user_id, organization_id)
        filters = [
            AgentSkillDraft.organization_id == organization_id,
            AgentSkillDraft.owner_id == user_id,
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
        when_to_use: str = "",
        requires_tools: list[str] | None = None,
        requires_context: list[str] | None = None,
        suggested_scope: str = "personal",
        suggested_always_active: bool = False,
        change_summary: str = "",
    ) -> tuple[AgentSkill, AgentSkillVersion]:
        """Commit a pending draft to a skill version using the reviewer's edits.

        A create draft becomes a new skill at version 1; an edit/evolve draft
        appends a new version to its target. The acting user must own the draft,
        and the resulting skill's scope gate (org admin for org, owner for
        personal) still applies.
        """
        await self._org_ops.require_org_member(user_id, organization_id)
        draft = await self._get_owned_draft(
            user_id=user_id,
            organization_id=organization_id,
            draft_id=draft_id,
            require_pending=True,
        )

        clean = clean_skill_write(
            name=name,
            display_name=display_name,
            description=description,
            content=content,
            when_to_use=when_to_use,
        )
        if clean.content:
            check_admin_content(clean.content, "skill_content")

        author_kind = "agent" if draft.proposed_by_agent_id else "user"
        author_id = None if author_kind == "agent" else user_id
        was_always_active = False

        # A create draft whose name already belongs to a skill the reviewer can
        # edit is reconciled into an edit of that skill: two skills can never
        # share a machine name in an org, so saving it versions the existing
        # skill instead of failing with a duplicate-name error.
        reconcile_id = draft.target_skill_id
        if draft.kind == "create" and reconcile_id is None:
            collision = await self._find_skill_by_name(organization_id, clean.name)
            if collision is not None:
                reconcile_id = collision.id

        if draft.kind == "create" and reconcile_id is None:
            scope = (
                suggested_scope
                if suggested_scope in ("personal", "organization")
                else draft.suggested_scope
            )
            if scope == "organization":
                await self._org_ops.require_org_admin(user_id, organization_id)
                source = "organization"
                owner_id: UUID | None = None
            else:
                source = "personal"
                owner_id = user_id
            await self._require_unique_name(organization_id, clean.name)
            origin = "agent_proposed" if draft.proposed_by_agent_id else "user"
            skill = AgentSkill(
                organization_id=organization_id,
                name=clean.name,
                display_name=clean.display_name,
                description=clean.description,
                content=clean.content,
                source=source,
                owner_id=owner_id,
                always_active=bool(suggested_always_active),
                when_to_use=clean.when_to_use,
                requires_tools=list(requires_tools or []),
                requires_context=list(requires_context or []),
                status="active",
                origin=origin,
                created_by_agent_id=draft.proposed_by_agent_id,
            )
            self._session.add(skill)
            await self._session.flush()
            version = await self._snapshot_version(
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
            was_always_active = skill.always_active
            new_tools = list(requires_tools or [])
            new_context = list(requires_context or [])
            # always_active is a row flag, not a versioned field, so an
            # always-active-only edit updates the row without cutting a new
            # version. A version is snapshotted only when versioned content moves.
            versioned_changed = (
                clean.name != skill.name
                or clean.display_name != skill.display_name
                or clean.description != (skill.description or "")
                or clean.content != (skill.content or "")
                or clean.when_to_use != (skill.when_to_use or "")
                or new_tools != list(skill.requires_tools or [])
                or new_context != list(skill.requires_context or [])
            )
            skill.name = clean.name
            skill.display_name = clean.display_name
            skill.description = clean.description
            skill.content = clean.content
            skill.when_to_use = clean.when_to_use
            skill.requires_tools = new_tools
            skill.requires_context = new_context
            skill.always_active = bool(suggested_always_active)
            skill.updated_at = datetime.now(UTC)
            if versioned_changed:
                version = await self._snapshot_version(
                    skill,
                    author_id=author_id,
                    author_kind=author_kind,
                    change_summary=change_summary or "Edited via draft",
                )
            else:
                version = await self._load_active_version(skill)
            audit_action = Action.AGENT_SKILL_UPDATED

        draft.status = "saved"
        await self._session.commit()
        await self._session.refresh(skill)
        await self._session.refresh(version)

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=audit_action,
            resource_type="skill",
            resource_id=skill.id,
            details={
                "name": skill.name,
                "from_draft": str(draft.id),
                "version": version.version_number,
            },
        )
        await self._session.commit()

        await invalidate_agents_using_skill(skill.id)
        if skill.always_active or was_always_active:
            await invalidate_org_always_active_skills(organization_id)

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
        await self._org_ops.require_org_member(user_id, organization_id)
        draft = await self._get_owned_draft(
            user_id=user_id,
            organization_id=organization_id,
            draft_id=draft_id,
            require_pending=True,
        )
        draft.status = "discarded"
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
        await self.get_skill(
            user_id=user_id, organization_id=organization_id, skill_id=skill_id
        )
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
        """Pin a version as the main one, or unpin to follow the latest edit.

        The runtime resolves skill content through ``active_version_id``, so a
        change here invalidates the dependent agent skill caches.
        """
        skill = await self._load_skill_for_edit(
            user_id=user_id, organization_id=organization_id, skill_id=skill_id
        )

        if follow_latest:
            skill.active_version_pinned = False
            latest = await self._get_version_or_none(skill_id, skill.latest_version_number)
            if latest is not None:
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
        if skill.always_active:
            await invalidate_org_always_active_skills(organization_id)
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

        was_always_active = skill.always_active
        skill.name = target.name
        skill.display_name = target.display_name
        skill.description = target.description or ""
        skill.content = target.content or ""
        skill.when_to_use = target.when_to_use or ""
        skill.requires_tools = list(target.requires_tools or [])
        skill.requires_context = list(target.requires_context or [])
        skill.updated_at = datetime.now(UTC)
        version = await self._snapshot_version(
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
            resource_type="skill",
            resource_id=skill_id,
            details={"reverted_to": version_number, "new_version": version.version_number},
        )
        await self._session.commit()

        await invalidate_agents_using_skill(skill_id)
        if skill.always_active or was_always_active:
            await invalidate_org_always_active_skills(organization_id)
        return skill, version

    async def get_skill_metrics(
        self, *, user_id: UUID, organization_id: UUID
    ) -> dict:
        """Aggregate per-skill usage + org feedback for the admin metrics view.

        Org-admin gated: this is an organization-wide reporting surface, not
        personal content. Counts injected/viewed/invoked from
        ``agents_skill_usages`` and pairs them with each org/bundled skill.
        """
        await self._org_ops.require_org_admin(user_id, organization_id)

        usage_rows = (
            await self._session.execute(
                select(
                    AgentSkillUsage.skill_id,
                    func.count().filter(AgentSkillUsage.injected == True).label("injected"),  # noqa: E712
                    func.count().filter(AgentSkillUsage.viewed == True).label("viewed"),  # noqa: E712
                    func.count().filter(AgentSkillUsage.invoked == True).label("invoked"),  # noqa: E712
                )
                .where(AgentSkillUsage.organization_id == organization_id)
                .group_by(AgentSkillUsage.skill_id)
            )
        ).all()
        usage_by_skill = {
            skill_id: (injected, viewed, invoked)
            for skill_id, injected, viewed, invoked in usage_rows
        }

        skills = (
            await self._session.execute(
                select(AgentSkill).where(
                    or_(
                        AgentSkill.organization_id == organization_id,
                        AgentSkill.organization_id.is_(None),
                    )
                )
            )
        ).scalars().all()

        metrics = []
        for skill in skills:
            injected, viewed, invoked = usage_by_skill.get(skill.id, (0, 0, 0))
            if injected == 0 and viewed == 0 and invoked == 0:
                continue
            metrics.append(
                {
                    "skill_id": skill.id,
                    "display_name": skill.display_name,
                    "origin": skill.origin or "user",
                    "injected": injected,
                    "viewed": viewed,
                    "invoked": invoked,
                }
            )
        metrics.sort(key=lambda m: m["injected"], reverse=True)

        feedback_rows = (
            await self._session.execute(
                select(
                    AgentMessageFeedback.rating,
                    func.count().label("count"),
                )
                .select_from(AgentMessageFeedback)
                .join(AgentMessage, AgentMessage.id == AgentMessageFeedback.message_id)
                .join(AgentSession, AgentSession.id == AgentMessage.session_id)
                .where(AgentSession.organization_id == organization_id)
                .group_by(AgentMessageFeedback.rating)
            )
        ).all()
        feedback = {rating: count for rating, count in feedback_rows}

        pending_agent_drafts = (
            await self._session.execute(
                select(func.count())
                .select_from(AgentSkillDraft)
                .where(
                    AgentSkillDraft.organization_id == organization_id,
                    AgentSkillDraft.status == "pending",
                    AgentSkillDraft.is_deleted == False,  # noqa: E712
                    AgentSkillDraft.proposed_by_agent_id.is_not(None),
                )
            )
        ).scalar() or 0

        return {
            "metrics": metrics,
            "positive": feedback.get("up", 0),
            "negative": feedback.get("down", 0),
            "pending_agent_drafts": pending_agent_drafts,
        }

    async def resolve_active_version_number(self, skill: AgentSkill) -> int:
        """Resolve the main version's number for a skill's SkillInfo conversion."""
        if not skill.active_version_pinned or skill.active_version_id is None:
            return skill.latest_version_number or 1
        result = await self._session.execute(
            select(AgentSkillVersion.version_number).where(
                AgentSkillVersion.id == skill.active_version_id
            )
        )
        return result.scalar() or (skill.latest_version_number or 1)

    async def resolve_active_version_numbers(
        self, skills: list[AgentSkill]
    ) -> dict[UUID, int]:
        """Batch-resolve main version numbers; one query covers all pinned skills."""
        numbers = {s.id: (s.latest_version_number or 1) for s in skills}
        pinned = {
            s.active_version_id: s.id
            for s in skills
            if s.active_version_pinned and s.active_version_id is not None
        }
        if pinned:
            result = await self._session.execute(
                select(AgentSkillVersion.id, AgentSkillVersion.version_number).where(
                    AgentSkillVersion.id.in_(pinned.keys())
                )
            )
            for version_id, number in result.all():
                numbers[pinned[version_id]] = number
        return numbers

    async def _get_version(self, skill_id: UUID, version_number: int) -> AgentSkillVersion:
        version = await self._get_version_or_none(skill_id, version_number)
        if version is None:
            raise NotFoundError("AgentSkillVersion", f"{skill_id}:{version_number}")
        return version

    async def _load_active_version(self, skill: AgentSkill) -> AgentSkillVersion:
        """Return the skill's current main (active) version, falling back to the latest."""
        if skill.active_version_id is not None:
            version = await self._session.get(AgentSkillVersion, skill.active_version_id)
            if version is not None:
                return version
        version = await self._get_version_or_none(skill.id, skill.latest_version_number or 1)
        if version is None:
            raise NotFoundError("AgentSkillVersion", str(skill.id))
        return version

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
        """Load an editable skill and gate it: owner for personal, admin for org."""
        await self._org_ops.require_org_member(user_id, organization_id)
        skill = await self._load_editable_skill(organization_id, skill_id)
        if skill.owner_id is not None:
            if skill.owner_id != user_id:
                raise PermissionDeniedError("update", "Only the owner can edit this skill")
        else:
            await self._org_ops.require_org_admin(user_id, organization_id)
        return skill

    async def _get_owned_draft(
        self,
        *,
        user_id: UUID,
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
        if draft is None or draft.owner_id != user_id:
            raise NotFoundError("AgentSkillDraft", str(draft_id))
        if require_pending and draft.status != "pending":
            raise ValidationError("status", "This draft has already been resolved")
        return draft

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
            raise ValidationError(
                "name", f"Skill name '{name}' already exists in this organization"
            )

    async def _find_skill_by_name(
        self, organization_id: UUID, name: str
    ) -> AgentSkill | None:
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
    ) -> list[AgentSkill]:
        """Resolve the skills a user may invoke on-demand against an agent.

        The set is the agent's own resolved skills (explicitly enabled +
        always-active). Access is gated by view permission on the agent, so a
        user cannot enumerate skills for an agent they cannot see. Reads the
        ``agent:{id}:skills`` cache like the runtime pre-flight does.
        """
        # Lazy import: skills.operations sits on the hot runtime import path;
        # AgentOperations pulls in the heavier content stack.
        from uniffy.domains.agents.agents.operations import AgentOperations
        from uniffy.domains.agents.cache import fetch_agent_skills

        agent = await AgentOperations(self._session).get_for_runtime(
            user_id, organization_id, agent_id
        )
        return await fetch_agent_skills(
            self,
            agent_id=agent.id,
            organization_id=organization_id,
            enabled_skill_ids=agent.enabled_skills or [],
        )

    async def get_skills_for_agent(
        self,
        *,
        organization_id: UUID,
        enabled_skill_ids: list[str],
    ) -> list[AgentSkill]:
        """Fetch skills for an agent runtime session.

        Returns the union of explicitly enabled skills and all
        always_active skills (bundled + org), deduplicated.

        Parameters
        ----------
        organization_id : UUID
            Organization context.
        enabled_skill_ids : list[str]
            Skill IDs explicitly enabled on the agent.

        Returns
        -------
        list[AgentSkill]
            Deduplicated list of skills to inject.

        """
        seen_ids: set[UUID] = set()
        skills: list[AgentSkill] = []

        # Fetch explicitly enabled skills
        if enabled_skill_ids:
            enabled_uuids = []
            for sid in enabled_skill_ids:
                try:
                    enabled_uuids.append(UUID(sid))
                except ValueError:
                    continue

            if enabled_uuids:
                result = await self._session.execute(
                    select(AgentSkill).where(
                        AgentSkill.id.in_(enabled_uuids),
                        or_(
                            AgentSkill.organization_id == organization_id,
                            AgentSkill.organization_id.is_(None),
                        ),
                    )
                )
                for skill in result.scalars().all():
                    seen_ids.add(skill.id)
                    skills.append(skill)

        # Fetch always_active skills (bundled + org)
        always_result = await self._session.execute(
            select(AgentSkill).where(
                AgentSkill.always_active == True,  # noqa: E712
                or_(
                    AgentSkill.organization_id == organization_id,
                    AgentSkill.organization_id.is_(None),
                ),
            )
        )
        for skill in always_result.scalars().all():
            if skill.id not in seen_ids:
                seen_ids.add(skill.id)
                skills.append(skill)

        await self._overlay_active_versions(skills)
        return skills

    async def _snapshot_version(
        self,
        skill: AgentSkill,
        *,
        author_id: UUID | None,
        author_kind: str = "user",
        change_summary: str = "",
    ) -> AgentSkillVersion:
        """Capture the skill's current fields as the next immutable version.

        Bumps ``latest_version_number`` and, unless a version is pinned as the
        main one, repoints ``active_version_id`` at the new snapshot - the main
        version follows the latest edit until the user pins one. The skill must
        already be flushed (``skill.id`` assigned).
        """
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
            when_to_use=skill.when_to_use or "",
            requires_tools=list(skill.requires_tools or []),
            requires_context=list(skill.requires_context or []),
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
        # Lazy imports keep the chat surface off the hot skills import path.
        from uniffy.core.models.chat.channel_member import ChatChannelMember
        from uniffy.core.models.chat.message import ChatMessage
        from uniffy.core.types import SubjectType
        from uniffy.domains.chat.streaming import events as chat_evt
        from uniffy.domains.chat.streaming.publisher import publish_channel_event_to_members

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

    async def _overlay_active_versions(self, skills: list[AgentSkill]) -> None:
        """Replace each skill's content/metadata with its pinned main version, in place.

        The runtime uses the main (active) version, never blindly the latest. A
        skill with no resolved version keeps its own row fields as the fallback.
        """
        version_ids = [s.active_version_id for s in skills if s.active_version_id]
        if not version_ids:
            return
        result = await self._session.execute(
            select(AgentSkillVersion).where(AgentSkillVersion.id.in_(version_ids))
        )
        versions = {v.id: v for v in result.scalars().all()}
        for skill in skills:
            version = versions.get(skill.active_version_id) if skill.active_version_id else None
            if version is None:
                continue
            skill.content = version.content
            skill.when_to_use = version.when_to_use
            skill.requires_tools = list(version.requires_tools or [])
            skill.requires_context = list(version.requires_context or [])
