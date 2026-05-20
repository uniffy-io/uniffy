"""Agent prompt template operations."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import resolve_access_policy
from uniffy.core.auth.permissions.defaults import (
    resolve_content_defaults,
    resolve_effective_policy,
)
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.content.members import register_content_loader
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.prompt import AgentPrompt
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.types import AccessMode, ContentRole, ContentType, slugify
from uniffy.domains.agents.cache import invalidate_agents_using_prompt
from uniffy.domains.organizations.operations import OrganizationOperations


class PromptOperations:
    """Operations for managing prompt templates."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialize prompt operations."""
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
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
    ) -> AgentPrompt:
        """Create a new prompt.

        Personal prompts (``owner_id`` set) only need org membership.
        Organization prompts require org admin.
        """
        access_mode, baseline_role = await resolve_access_policy(
            self._session,
            organization_id,
            ContentType.PROMPT,
            access_mode,
            baseline_role,
        )

        if owner_id:
            await self._org_ops.require_org_member(user_id, organization_id)
        else:
            await self._org_ops.require_org_admin(user_id, organization_id)

        if not display_name or not display_name.strip():
            raise ValidationError("display_name", "Prompt display name cannot be empty")

        if name and name.strip():
            resolved_name = name.strip()
        else:
            resolved_name = slugify(display_name, max_length=100)
        if not resolved_name:
            resolved_name = "prompt"

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
            access_mode=access_mode,
            baseline_role=baseline_role,
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
        """Return ``base_name`` with a numeric suffix if already taken."""
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
        """Fetch a prompt by ID (bundled or org-scoped)."""
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
        """Fetch a prompt by ID without permission checks (runtime only)."""
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
        """List prompts visible in the organization.

        Always includes bundled prompts (``organization_id IS NULL``)
        plus any org-scoped prompts the user can access.
        """
        await self._org_ops.require_org_member(user_id, organization_id)

        access_filter = self._access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.PROMPT,
            content_id_column=AgentPrompt.id,
            owner_id_column=AgentPrompt.owner_id,
            access_mode_column=AgentPrompt.access_mode,
            baseline_role_column=AgentPrompt.baseline_role,
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
    ) -> AgentPrompt:
        """Update a prompt (access-policy changes go through MembersService)."""
        result = await self._session.execute(
            select(AgentPrompt).where(
                AgentPrompt.id == prompt_id,
                AgentPrompt.organization_id == organization_id,
            )
        )
        prompt = result.scalar_one_or_none()
        if not prompt:
            bundled = await self._session.execute(
                select(AgentPrompt).where(
                    AgentPrompt.id == prompt_id,
                    AgentPrompt.organization_id.is_(None),
                )
            )
            if bundled.scalar_one_or_none():
                raise PermissionDeniedError("update", "Cannot update bundled prompts")
            raise NotFoundError("AgentPrompt", str(prompt_id))

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

        prompt.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(prompt)
        await self._index_prompt(prompt)
        await invalidate_agents_using_prompt(prompt_id)
        return prompt

    async def delete_prompt(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        prompt_id: UUID,
    ) -> None:
        """Delete a prompt."""
        result = await self._session.execute(
            select(AgentPrompt).where(
                AgentPrompt.id == prompt_id,
                AgentPrompt.organization_id == organization_id,
            )
        )
        prompt = result.scalar_one_or_none()
        if not prompt:
            bundled = await self._session.execute(
                select(AgentPrompt).where(
                    AgentPrompt.id == prompt_id,
                    AgentPrompt.organization_id.is_(None),
                )
            )
            if bundled.scalar_one_or_none():
                raise PermissionDeniedError("delete", "Cannot delete bundled prompts")
            raise NotFoundError("AgentPrompt", str(prompt_id))

        if prompt.source == "personal":
            if prompt.owner_id != user_id:
                raise PermissionDeniedError("delete", "Cannot delete another user's prompt")
        else:
            await self._org_ops.require_org_admin(user_id, organization_id)

        urn = build_content_urn(ContentType.PROMPT, prompt.id)
        await self._session.delete(prompt)
        await self._session.commit()
        await self._search.remove(urn, organization_id)
        await invalidate_agents_using_prompt(prompt_id, drop_tag_set=True)

    async def _index_prompt(self, prompt: AgentPrompt) -> None:
        """Index a prompt for search (bundled prompts are skipped)."""
        if prompt.organization_id is None:
            return

        keywords_parts = [prompt.display_name, prompt.name]
        if prompt.description:
            keywords_parts.append(prompt.description)
        if prompt.content:
            keywords_parts.append(prompt.content[:500])

        default_mode, default_baseline = await resolve_content_defaults(
            self._session, prompt.organization_id, ContentType.PROMPT,
        )
        effective_mode, effective_baseline = resolve_effective_policy(
            prompt.access_mode, prompt.baseline_role, default_mode, default_baseline,
        )

        await self._search.index(
            urn=build_content_urn(ContentType.PROMPT, prompt.id),
            organization_id=prompt.organization_id,
            title=prompt.display_name,
            entity_type=ContentType.PROMPT.value,
            url_path=f"/agents/prompts/{prompt.id}",
            access_mode=effective_mode.value,
            baseline_role=(
                effective_baseline.value if effective_baseline is not None else None
            ),
            owner_id=prompt.owner_id or prompt.created_by,
            keywords=" ".join(keywords_parts),
            description=prompt.description or None,
            metadata={"source": prompt.source},
        )


# Content loader registration


async def _load_prompt(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> AgentPrompt | None:
    """Loader used by ``ContentMembersOperations`` to fetch a prompt."""
    result = await session.execute(
        select(AgentPrompt).where(
            AgentPrompt.id == content_id,
            AgentPrompt.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


register_content_loader(ContentType.PROMPT, _load_prompt)
