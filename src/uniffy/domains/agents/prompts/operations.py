"""Business logic for prompt template management."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.prompt import AgentPrompt
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.types import ContentType, VisibilityScope, slugify
from uniffy.domains.organizations.operations import OrganizationOperations


class PromptOperations:
    """Operations for managing prompt templates.

    Parameters
    ----------
    session : AsyncSession
        Database session.

    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._org_ops = OrganizationOperations(session)
        self._search = SearchIndexer(session)
        self._access_query = ContentAccessQuery(session)

    async def create_prompt(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        display_name: str,
        name: str | None = None,
        description: str = "",
        content: str = "",
        owner_id: UUID | None = None,
        visibility: VisibilityScope = VisibilityScope.PRIVATE,
    ) -> AgentPrompt:
        """Create a new prompt.

        Org admins can create organization prompts. Any user can create
        personal prompts (owner_id set to their own user_id).

        Parameters
        ----------
        user_id : UUID
            The user creating the prompt.
        organization_id : UUID
            Organization context.
        display_name : str
            Human-readable name.
        name : str | None
            Machine name (auto-generated from display_name if not provided).
        description : str
            Short description.
        content : str
            Markdown instructions.
        owner_id : UUID | None
            Owner user ID for personal prompts.
        visibility : VisibilityScope
            Visibility scope for the prompt (default PRIVATE).

        Returns
        -------
        AgentPrompt
            The created prompt.

        Raises
        ------
        PermissionDeniedError
            If user is not an org admin (for org prompts).
        ValidationError
            If display_name is empty.

        """
        if owner_id:
            # Personal prompts: user must be org member
            await self._org_ops.require_org_member(user_id, organization_id)
        else:
            # Organization prompts: user must be org admin
            await self._org_ops.require_org_admin(user_id, organization_id)

        if not display_name or not display_name.strip():
            raise ValidationError("display_name", "Prompt display name cannot be empty")

        # Auto-generate slug from display_name if not provided
        if name and name.strip():
            resolved_name = name.strip()
        else:
            resolved_name = slugify(display_name, max_length=100)
        if not resolved_name:
            resolved_name = "prompt"

        # Ensure uniqueness within org by appending a suffix if needed
        resolved_name = await self._ensure_unique_name(organization_id, resolved_name)

        source = "personal" if owner_id else "organization"
        prompt = AgentPrompt(
            organization_id=organization_id,
            name=resolved_name,
            display_name=display_name.strip(),
            description=description,
            content=content,
            source=source,
            owner_id=owner_id or user_id,
            visibility=visibility,
            created_by=user_id,
        )
        self._session.add(prompt)
        await self._session.commit()
        await self._session.refresh(prompt)
        await self._index_prompt(prompt)
        return prompt

    async def _ensure_unique_name(
        self,
        organization_id: UUID,
        base_name: str,
        exclude_id: UUID | None = None,
    ) -> str:
        """Ensure a prompt name is unique within the organization.

        Appends -2, -3, etc. if the base name is already taken.

        Parameters
        ----------
        organization_id : UUID
            Organization context.
        base_name : str
            Desired slug name.
        exclude_id : UUID | None
            Prompt ID to exclude from the check (for updates).

        Returns
        -------
        str
            A unique name.

        """
        candidate = base_name
        suffix = 1
        while True:
            query = select(AgentPrompt.id).where(
                AgentPrompt.organization_id == organization_id,
                AgentPrompt.name == candidate,
            )
            if exclude_id is not None:
                query = query.where(AgentPrompt.id != exclude_id)
            result = await self._session.execute(query)
            if result.scalar_one_or_none() is None:
                return candidate
            suffix += 1
            candidate = f"{base_name}-{suffix}"

    async def get_prompt(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        prompt_id: UUID,
    ) -> AgentPrompt:
        """Fetch a prompt by ID.

        Returns bundled prompts or org-specific prompts.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        prompt_id : UUID
            Prompt to fetch.

        Returns
        -------
        AgentPrompt
            The prompt.

        Raises
        ------
        NotFoundError
            If the prompt does not exist or is not accessible.
        PermissionDeniedError
            If user is not an org member.

        """
        await self._org_ops.require_org_member(user_id, organization_id)

        result = await self._session.execute(
            select(AgentPrompt).where(
                AgentPrompt.id == prompt_id,
                or_(
                    AgentPrompt.organization_id == organization_id,
                    AgentPrompt.organization_id.is_(None),
                ),
            )
        )
        prompt = result.scalar_one_or_none()
        if not prompt:
            raise NotFoundError("AgentPrompt", str(prompt_id))

        return prompt

    async def get_prompt_by_id(
        self,
        prompt_id: UUID,
    ) -> AgentPrompt | None:
        """Fetch a prompt by ID without permission checks.

        Used by the runtime to resolve prompt content.

        Parameters
        ----------
        prompt_id : UUID
            Prompt to fetch.

        Returns
        -------
        AgentPrompt | None
            The prompt, or None if not found.

        """
        result = await self._session.execute(select(AgentPrompt).where(AgentPrompt.id == prompt_id))
        return result.scalar_one_or_none()

    async def list_prompts(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[AgentPrompt], int]:
        """List prompts visible to the organization.

        Returns bundled, organization, and user's personal prompts.

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
        tuple[list[AgentPrompt], int]
            (prompts, total_count).

        Raises
        ------
        PermissionDeniedError
            If user is not an org member.

        """
        await self._org_ops.require_org_member(user_id, organization_id)

        # Use the standard access filter for org-scoped prompts (handles
        # ownership, org visibility, group membership, and explicit shares),
        # plus always include bundled prompts (org_id is null).
        access_filter = self._access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.PROMPT,
            content_id_column=AgentPrompt.id,
            owner_id_column=AgentPrompt.owner_id,
            visibility_column=AgentPrompt.visibility,
        )
        base_filter = or_(
            AgentPrompt.organization_id.is_(None),
            (AgentPrompt.organization_id == organization_id) & access_filter,
        )

        count_result = await self._session.execute(
            select(func.count()).select_from(AgentPrompt).where(base_filter)
        )
        total = count_result.scalar() or 0

        offset = (page - 1) * page_size
        result = await self._session.execute(
            select(AgentPrompt)
            .where(base_filter)
            .order_by(AgentPrompt.source, AgentPrompt.name)
            .offset(offset)
            .limit(page_size)
        )
        prompts = list(result.scalars().all())
        return prompts, total

    async def update_prompt(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        prompt_id: UUID,
        name: str | None = None,
        display_name: str | None = None,
        description: str | None = None,
        content: str | None = None,
        visibility: VisibilityScope | None = None,
    ) -> AgentPrompt:
        """Update a prompt.

        Cannot update bundled prompts. Org admins can update org prompts.
        Users can update their own personal prompts.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        prompt_id : UUID
            Prompt to update.
        name : str | None
            New machine name (None = no change).
        display_name : str | None
            New display name (None = no change).
        description : str | None
            New description (None = no change).
        content : str | None
            New content (None = no change).
        visibility : VisibilityScope | None
            New visibility scope (None = no change).

        Returns
        -------
        AgentPrompt
            The updated prompt.

        Raises
        ------
        NotFoundError
            If the prompt does not exist.
        PermissionDeniedError
            If user lacks permission or prompt is bundled.
        ValidationError
            If name is empty or already taken.

        """
        result = await self._session.execute(
            select(AgentPrompt).where(
                AgentPrompt.id == prompt_id,
                AgentPrompt.organization_id == organization_id,
            )
        )
        prompt = result.scalar_one_or_none()
        if not prompt:
            # Check if it's a bundled prompt
            bundled = await self._session.execute(
                select(AgentPrompt).where(
                    AgentPrompt.id == prompt_id,
                    AgentPrompt.organization_id.is_(None),
                )
            )
            if bundled.scalar_one_or_none():
                raise PermissionDeniedError("update", "Cannot update bundled prompts")
            raise NotFoundError("AgentPrompt", str(prompt_id))

        # Check permission based on source
        if prompt.source == "personal":
            if prompt.owner_id != user_id:
                raise PermissionDeniedError("update", "Cannot update another user's prompt")
        else:
            await self._org_ops.require_org_admin(user_id, organization_id)

        if name is not None:
            if not name.strip():
                raise ValidationError("name", "Prompt name cannot be empty")
            if name.strip() != prompt.name:
                existing = await self._session.execute(
                    select(AgentPrompt).where(
                        AgentPrompt.organization_id == organization_id,
                        AgentPrompt.name == name.strip(),
                        AgentPrompt.id != prompt_id,
                    )
                )
                if existing.scalar_one_or_none():
                    raise ValidationError(
                        "name",
                        f"Prompt name '{name}' already exists in this organization",
                    )
            prompt.name = name.strip()

        if display_name is not None:
            if not display_name.strip():
                raise ValidationError("display_name", "Prompt display name cannot be empty")
            prompt.display_name = display_name.strip()

        if description is not None:
            prompt.description = description

        if content is not None:
            prompt.content = content

        if visibility is not None:
            # Only allow moving from personal to organization, not the reverse
            if visibility == VisibilityScope.PRIVATE and prompt.source == "organization":
                raise ValidationError(
                    "visibility",
                    "Organization prompts cannot be moved back to personal",
                )
            prompt.visibility = visibility
            if visibility == VisibilityScope.ORGANIZATION:
                prompt.source = "organization"

        prompt.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(prompt)
        await self._index_prompt(prompt)
        return prompt

    async def delete_prompt(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        prompt_id: UUID,
    ) -> None:
        """Delete a prompt.

        Cannot delete bundled prompts. Org admins can delete org prompts.
        Users can delete their own personal prompts.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        prompt_id : UUID
            Prompt to delete.

        Raises
        ------
        NotFoundError
            If the prompt does not exist.
        PermissionDeniedError
            If user lacks permission or prompt is bundled.

        """
        result = await self._session.execute(
            select(AgentPrompt).where(
                AgentPrompt.id == prompt_id,
                AgentPrompt.organization_id == organization_id,
            )
        )
        prompt = result.scalar_one_or_none()
        if not prompt:
            # Check if it's a bundled prompt
            bundled = await self._session.execute(
                select(AgentPrompt).where(
                    AgentPrompt.id == prompt_id,
                    AgentPrompt.organization_id.is_(None),
                )
            )
            if bundled.scalar_one_or_none():
                raise PermissionDeniedError("delete", "Cannot delete bundled prompts")
            raise NotFoundError("AgentPrompt", str(prompt_id))

        # Check permission based on source
        if prompt.source == "personal":
            if prompt.owner_id != user_id:
                raise PermissionDeniedError("delete", "Cannot delete another user's prompt")
        else:
            await self._org_ops.require_org_admin(user_id, organization_id)

        urn = build_content_urn(ContentType.PROMPT, prompt.id)
        await self._session.delete(prompt)
        await self._session.commit()
        await self._search.remove(urn, organization_id)

    async def _index_prompt(self, prompt: AgentPrompt) -> None:
        """Index a prompt for search.

        Parameters
        ----------
        prompt : AgentPrompt
            The prompt to index.

        """
        if prompt.organization_id is None:
            # Bundled prompts are not org-scoped, skip indexing
            return

        keywords_parts = [prompt.display_name, prompt.name]
        if prompt.description:
            keywords_parts.append(prompt.description)
        if prompt.content:
            keywords_parts.append(prompt.content[:500])

        await self._search.index(
            urn=build_content_urn(ContentType.PROMPT, prompt.id),
            organization_id=prompt.organization_id,
            title=prompt.display_name,
            entity_type=ContentType.PROMPT.value,
            url_path=f"/agents/prompts/{prompt.id}",
            visibility=prompt.visibility.value,
            owner_id=prompt.owner_id or prompt.created_by,
            keywords=" ".join(keywords_parts),
            description=prompt.description or None,
            metadata={"source": prompt.source},
        )
