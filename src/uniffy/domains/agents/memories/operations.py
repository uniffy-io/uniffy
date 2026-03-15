"""Business logic for agent memory management."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.memory import AgentMemory

VALID_CATEGORIES: set[str] = {"preferences", "facts", "context", "instructions"}


class MemoryOperations:
    """Operations for managing agent memories.

    Parameters
    ----------
    session : AsyncSession
        Database session.

    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_memory(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        key: str,
        content: str,
        category: str = "facts",
        importance: float = 0.5,
    ) -> AgentMemory:
        """Create a new memory entry.

        Parameters
        ----------
        user_id : UUID
            The user creating the memory.
        organization_id : UUID
            Organization context.
        agent_id : UUID
            Agent this memory belongs to.
        key : str
            Short descriptive key for this memory.
        content : str
            The memory content text.
        category : str
            Memory category (default "facts").
        importance : float
            Importance weight 0.0-1.0 (default 0.5).

        Returns
        -------
        AgentMemory
            The created memory.

        Raises
        ------
        ValidationError
            If key/content is empty, category is invalid, or importance is out of range.

        """
        key = key.strip()
        if not key:
            raise ValidationError("key", "Key is required")

        content = content.strip()
        if not content:
            raise ValidationError("content", "Content is required")

        if category not in VALID_CATEGORIES:
            valid = ", ".join(sorted(VALID_CATEGORIES))
            raise ValidationError(
                "category",
                f"Invalid category '{category}'. Must be one of: {valid}",
            )

        if importance < 0.0 or importance > 1.0:
            raise ValidationError(
                "importance",
                "Importance must be between 0.0 and 1.0",
            )

        # Check for duplicate key
        result = await self._session.execute(
            select(AgentMemory).where(
                AgentMemory.agent_id == agent_id,
                AgentMemory.user_id == user_id,
                AgentMemory.organization_id == organization_id,
                AgentMemory.key == key,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            raise ValidationError(
                "key",
                f"A memory with key '{key}' already exists for this agent",
            )

        memory = AgentMemory(
            agent_id=agent_id,
            user_id=user_id,
            organization_id=organization_id,
            key=key,
            content=content,
            category=category,
            importance=float(importance),
        )
        self._session.add(memory)
        await self._session.commit()
        await self._session.refresh(memory)
        return memory

    async def list_memories(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        category: str | None = None,
        search: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[AgentMemory], int]:
        """List memories for an agent-user pair.

        Parameters
        ----------
        user_id : UUID
            The user whose memories to list.
        organization_id : UUID
            Organization context.
        agent_id : UUID
            Agent the memories belong to.
        category : str | None
            Optional category filter.
        search : str | None
            Optional ILIKE search on key and content.
        page : int
            Page number (1-based).
        page_size : int
            Results per page.

        Returns
        -------
        tuple[list[AgentMemory], int]
            (memories, total_count).

        """
        base_filters = [
            AgentMemory.agent_id == agent_id,
            AgentMemory.user_id == user_id,
            AgentMemory.organization_id == organization_id,
        ]

        if category is not None:
            base_filters.append(AgentMemory.category == category)

        if search is not None and search.strip():
            search_pattern = f"%{search.strip()}%"
            base_filters.append(
                or_(
                    AgentMemory.key.ilike(search_pattern),
                    AgentMemory.content.ilike(search_pattern),
                )
            )

        # Count total
        count_result = await self._session.execute(
            select(func.count()).select_from(AgentMemory).where(*base_filters)
        )
        total = count_result.scalar() or 0

        # Fetch paginated results
        offset = (page - 1) * page_size
        result = await self._session.execute(
            select(AgentMemory)
            .where(*base_filters)
            .order_by(AgentMemory.importance.desc(), AgentMemory.updated_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        memories = list(result.scalars().all())

        return memories, total

    async def update_memory(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        memory_id: UUID,
        content: str | None = None,
        category: str | None = None,
        importance: float | None = None,
    ) -> AgentMemory:
        """Update an existing memory entry.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        memory_id : UUID
            Memory to update.
        content : str | None
            New content (None = no change).
        category : str | None
            New category (None = no change).
        importance : float | None
            New importance (None = no change).

        Returns
        -------
        AgentMemory
            The updated memory.

        Raises
        ------
        NotFoundError
            If the memory does not exist.
        PermissionDeniedError
            If user_id does not match the memory owner.
        ValidationError
            If category or importance values are invalid.

        """
        result = await self._session.execute(
            select(AgentMemory).where(
                AgentMemory.id == memory_id,
                AgentMemory.organization_id == organization_id,
            )
        )
        memory = result.scalar_one_or_none()
        if not memory:
            raise NotFoundError("AgentMemory", str(memory_id))

        if memory.user_id != user_id:
            raise PermissionDeniedError("update", "Cannot update another user's memory")

        if content is not None:
            memory.content = content

        if category is not None:
            if category not in VALID_CATEGORIES:
                valid = ", ".join(sorted(VALID_CATEGORIES))
                raise ValidationError(
                    "category",
                    f"Invalid category '{category}'. Must be one of: {valid}",
                )
            memory.category = category

        if importance is not None:
            if importance < 0.0 or importance > 1.0:
                raise ValidationError(
                    "importance",
                    "Importance must be between 0.0 and 1.0",
                )
            memory.importance = importance

        memory.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(memory)
        return memory

    async def delete_memory(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        memory_id: UUID,
    ) -> None:
        """Delete a memory entry.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        memory_id : UUID
            Memory to delete.

        Raises
        ------
        NotFoundError
            If the memory does not exist.
        PermissionDeniedError
            If user_id does not match the memory owner.

        """
        result = await self._session.execute(
            select(AgentMemory).where(
                AgentMemory.id == memory_id,
                AgentMemory.organization_id == organization_id,
            )
        )
        memory = result.scalar_one_or_none()
        if not memory:
            raise NotFoundError("AgentMemory", str(memory_id))

        if memory.user_id != user_id:
            raise PermissionDeniedError("delete", "Cannot delete another user's memory")

        await self._session.delete(memory)
        await self._session.commit()
