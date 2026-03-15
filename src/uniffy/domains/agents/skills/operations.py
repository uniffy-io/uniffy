"""Business logic for skill management."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.skill import AgentSkill
from uniffy.domains.agents.audit import create_audit_log
from uniffy.domains.agents.content_policy import check_admin_content
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

        if not name or not name.strip():
            raise ValidationError("name", "Skill name cannot be empty")

        if not display_name or not display_name.strip():
            raise ValidationError("display_name", "Skill display name cannot be empty")

        # Check name uniqueness within org
        existing = await self._session.execute(
            select(AgentSkill).where(
                AgentSkill.organization_id == organization_id,
                AgentSkill.name == name.strip(),
            )
        )
        if existing.scalar_one_or_none():
            raise ValidationError("name", f"Skill name '{name}' already exists in this organization")

        # Content policy check on skill content (warn-only)
        if content:
            check_admin_content(content, "skill_content")

        source = "personal" if owner_id else "organization"
        skill = AgentSkill(
            organization_id=organization_id,
            name=name.strip(),
            display_name=display_name.strip(),
            description=description,
            content=content,
            source=source,
            always_active=always_active,
            owner_id=owner_id,
        )
        self._session.add(skill)
        await self._session.commit()
        await self._session.refresh(skill)

        await create_audit_log(
            self._session,
            organization_id=organization_id,
            user_id=user_id,
            action="skill.create",
            resource_type="skill",
            resource_id=skill.id,
            details={
                "name": name,
                "display_name": display_name,
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
            skill.name = name.strip()

        if display_name is not None:
            if not display_name.strip():
                raise ValidationError("display_name", "Skill display name cannot be empty")
            skill.display_name = display_name.strip()

        if description is not None:
            skill.description = description

        if content is not None:
            # Content policy check on skill content (warn-only)
            if content:
                check_admin_content(content, "skill_content")
            skill.content = content

        if always_active is not None:
            skill.always_active = always_active

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
            await create_audit_log(
                self._session,
                organization_id=organization_id,
                user_id=user_id,
                action="skill.update",
                resource_type="skill",
                resource_id=skill_id,
                details={"changes": audit_changes},
            )
            await self._session.commit()

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
        await self._session.delete(skill)
        await create_audit_log(
            self._session,
            organization_id=organization_id,
            user_id=user_id,
            action="skill.delete",
            resource_type="skill",
            resource_id=skill_id,
            details={"name": skill_name},
        )
        await self._session.commit()

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

        return skills
