"""Business logic for audience-scoped agent memories."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.membership import is_active_member
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.memory import AgentMemory, MemoryScope, MemorySource
from uniffy.core.models.agents.session import AgentSession
from uniffy.domains.agents.cache import invalidate_memory_index
from uniffy.domains.agents.memories.scope import (
    MemoryScopeRef,
    scope_filters,
    scope_ref_for_memory,
    scope_subject_columns,
)
from uniffy.domains.chat.access import ChatAccessChecker

VALID_CATEGORIES: set[str] = {"preferences", "facts", "context", "instructions"}

MAX_MEMORIES_PER_SCOPE = 200
MAX_CONTENT_CHARS = 4000
MAX_PINNED_ENTRIES = 5
MAX_PINNED_CHARS = 2000


def _validate_entry_fields(
    *,
    key: str,
    description: str,
    content: str,
    category: str,
    importance: float,
) -> tuple[str, str, str]:
    key = key.strip()
    if not key:
        raise ValidationError("key", "Key is required")
    if len(key) > 255:
        raise ValidationError("key", "Key must be 255 characters or fewer")
    description = description.strip()
    if not description:
        raise ValidationError("description", "Description is required")
    if len(description) > 255:
        raise ValidationError("description", "Description must be 255 characters or fewer")
    content = content.strip()
    if not content:
        raise ValidationError("content", "Content is required")
    if len(content) > MAX_CONTENT_CHARS:
        raise ValidationError(
            "content", f"Content must be {MAX_CONTENT_CHARS} characters or fewer"
        )
    if category not in VALID_CATEGORIES:
        valid = ", ".join(sorted(VALID_CATEGORIES))
        raise ValidationError(
            "category", f"Invalid category '{category}'. Must be one of: {valid}"
        )
    if importance < 0.0 or importance > 1.0:
        raise ValidationError("importance", "Importance must be between 0.0 and 1.0")
    return key, description, content


class MemoryOperations:
    """Scope-gated CRUD for agent memories; every mutation invalidates the index cache."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._chat_checker = ChatAccessChecker(session)

    async def _get_agent(self, agent_id: UUID, organization_id: UUID) -> Agent:
        result = await self._session.execute(
            select(Agent).where(
                Agent.id == agent_id,
                Agent.organization_id == organization_id,
                Agent.is_deleted.is_(False),  # type: ignore[union-attr]
            )
        )
        agent = result.scalar_one_or_none()
        if not agent:
            raise NotFoundError("Agent", str(agent_id))
        return agent

    async def _get_session_row(
        self, session_id: UUID, organization_id: UUID
    ) -> AgentSession:
        result = await self._session.execute(
            select(AgentSession).where(
                AgentSession.id == session_id,
                AgentSession.organization_id == organization_id,
            )
        )
        row = result.scalar_one_or_none()
        if not row:
            raise NotFoundError("AgentSession", str(session_id))
        return row

    async def _require_agent_manage(
        self, user_id: UUID, organization_id: UUID, agent_id: UUID
    ) -> None:
        from uniffy.domains.agents.access import require_agents_builder

        await self._get_agent(agent_id, organization_id)
        await require_agents_builder(self._session, user_id, organization_id)

    async def _require_view(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        ref: MemoryScopeRef,
    ) -> None:
        if ref.scope is MemoryScope.USER:
            if ref.subject_id != user_id:
                raise PermissionDeniedError("view", "Cannot view another user's memory")
            return
        if ref.scope is MemoryScope.CHANNEL:
            if ref.subject_id is None:
                raise ValidationError("channel_id", "channel_id is required")
            channel = await self._chat_checker.get_channel(ref.subject_id, organization_id)
            await self._chat_checker.check_access(user_id, organization_id, channel)
            return
        if ref.scope is MemoryScope.SESSION:
            if ref.subject_id is None:
                raise ValidationError("session_id", "session_id is required")
            row = await self._get_session_row(ref.subject_id, organization_id)
            if row.user_id == user_id:
                return
            if row.kind == "global" and await is_active_member(
                user_id, organization_id, session=self._session
            ):
                return
            raise PermissionDeniedError("view", "Not a participant of this session")
        if not await is_active_member(user_id, organization_id, session=self._session):
            raise PermissionDeniedError("view", "Not a member of this organization")

    async def _require_create(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        ref: MemoryScopeRef,
    ) -> None:
        if ref.scope is MemoryScope.ORG:
            await self._require_agent_manage(user_id, organization_id, agent_id)
            return
        if ref.scope is MemoryScope.CHANNEL:
            if ref.subject_id is None:
                raise ValidationError("channel_id", "channel_id is required")
            channel = await self._chat_checker.get_channel(ref.subject_id, organization_id)
            await self._chat_checker.require_send(user_id, channel)
            return
        await self._require_view(
            user_id=user_id,
            organization_id=organization_id,
            agent_id=agent_id,
            ref=ref,
        )

    async def _require_mutate(
        self, *, user_id: UUID, organization_id: UUID, memory: AgentMemory
    ) -> None:
        scope = MemoryScope(memory.scope)
        if scope is MemoryScope.USER:
            if memory.user_id != user_id:
                raise PermissionDeniedError("update", "Cannot modify another user's memory")
            return
        if scope is MemoryScope.CHANNEL:
            if memory.created_by_user_id == user_id:
                member = await self._chat_checker.get_membership(
                    memory.channel_id, user_id
                )
                if member is not None:
                    return
            if await self._chat_checker.require_elevated(
                user_id, organization_id, memory.channel_id
            ):
                return
            raise PermissionDeniedError(
                "update", "Only the creator or a channel moderator can modify this memory"
            )
        if scope is MemoryScope.SESSION:
            row = await self._get_session_row(memory.session_id, organization_id)
            if memory.created_by_user_id == user_id or row.user_id == user_id:
                return
            raise PermissionDeniedError(
                "update", "Only the creator or the session owner can modify this memory"
            )
        await self._require_agent_manage(user_id, organization_id, memory.agent_id)

    async def _require_pin(
        self, *, user_id: UUID, organization_id: UUID, memory: AgentMemory
    ) -> None:
        scope = MemoryScope(memory.scope)
        if scope is MemoryScope.USER:
            if memory.user_id != user_id:
                raise PermissionDeniedError("pin", "Cannot pin another user's memory")
            return
        if scope is MemoryScope.CHANNEL:
            if await self._chat_checker.require_elevated(
                user_id, organization_id, memory.channel_id
            ):
                return
            raise PermissionDeniedError("pin", "Only channel moderators can pin memories")
        if scope is MemoryScope.SESSION:
            row = await self._get_session_row(memory.session_id, organization_id)
            if row.user_id == user_id:
                return
            raise PermissionDeniedError("pin", "Only the session owner can pin memories")
        await self._require_agent_manage(user_id, organization_id, memory.agent_id)

    async def _check_quota(
        self, agent_id: UUID, organization_id: UUID, ref: MemoryScopeRef
    ) -> None:
        count = (
            await self._session.execute(
                select(func.count())
                .select_from(AgentMemory)
                .where(*scope_filters(agent_id, organization_id, ref))
            )
        ).scalar() or 0
        if count >= MAX_MEMORIES_PER_SCOPE:
            raise ValidationError(
                "key",
                f"Memory limit reached ({MAX_MEMORIES_PER_SCOPE} entries in this scope). "
                "Delete an entry before adding another.",
            )

    async def _invalidate(self, memory: AgentMemory) -> None:
        ref = scope_ref_for_memory(memory)
        await invalidate_memory_index(
            memory.agent_id, ref.scope.value, ref.cache_subject
        )

    async def _get_memory(self, memory_id: UUID, organization_id: UUID) -> AgentMemory:
        result = await self._session.execute(
            select(AgentMemory).where(
                AgentMemory.id == memory_id,
                AgentMemory.organization_id == organization_id,
            )
        )
        memory = result.scalar_one_or_none()
        if not memory:
            raise NotFoundError("AgentMemory", str(memory_id))
        return memory

    async def create_memory(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        ref: MemoryScopeRef,
        key: str,
        description: str,
        content: str,
        category: str = "facts",
        importance: float = 0.5,
        source: str = MemorySource.MANUAL.value,
    ) -> AgentMemory:
        key, description, content = _validate_entry_fields(
            key=key,
            description=description,
            content=content,
            category=category,
            importance=importance,
        )
        await self._get_agent(agent_id, organization_id)
        await self._require_create(
            user_id=user_id,
            organization_id=organization_id,
            agent_id=agent_id,
            ref=ref,
        )

        existing = (
            await self._session.execute(
                select(AgentMemory).where(
                    *scope_filters(agent_id, organization_id, ref),
                    AgentMemory.key == key,
                )
            )
        ).scalar_one_or_none()
        if existing:
            raise ValidationError(
                "key", f"A memory with key '{key}' already exists in this scope"
            )
        await self._check_quota(agent_id, organization_id, ref)

        memory = AgentMemory(
            agent_id=agent_id,
            organization_id=organization_id,
            created_by_user_id=user_id,
            scope=ref.scope.value,
            **scope_subject_columns(ref),
            key=key,
            description=description,
            content=content,
            category=category,
            importance=float(importance),
            source=source,
        )
        self._session.add(memory)
        await self._session.commit()
        await self._session.refresh(memory)
        await self._invalidate(memory)
        return memory

    async def save_from_tool(
        self,
        *,
        created_by_user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        ref: MemoryScopeRef,
        key: str,
        description: str,
        content: str,
        category: str = "facts",
        importance: float = 0.5,
    ) -> tuple[AgentMemory, bool]:
        """Upsert for the runtime tools; scope was resolved by the runtime, no user gate.

        Returns (row, created). Concurrent saves of the same key land on the
        unique constraint and become updates instead of raising.
        """
        key, description, content = _validate_entry_fields(
            key=key,
            description=description,
            content=content,
            category=category,
            importance=importance,
        )
        existing = (
            await self._session.execute(
                select(AgentMemory).where(
                    *scope_filters(agent_id, organization_id, ref),
                    AgentMemory.key == key,
                )
            )
        ).scalar_one_or_none()
        created = existing is None
        if created:
            await self._check_quota(agent_id, organization_id, ref)

        now = datetime.now(UTC)
        stmt = (
            pg_insert(AgentMemory)
            .values(
                agent_id=agent_id,
                organization_id=organization_id,
                created_by_user_id=created_by_user_id,
                scope=ref.scope.value,
                **scope_subject_columns(ref),
                key=key,
                description=description,
                content=content,
                category=category,
                importance=float(importance),
                source=MemorySource.TOOL.value,
                pinned=False,
                access_count=0,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_update(
                constraint="uq_agents_memories_scope_key",
                set_={
                    "description": description,
                    "content": content,
                    "category": category,
                    "importance": float(importance),
                    "updated_at": now,
                },
            )
            .returning(AgentMemory)
        )
        row = (await self._session.execute(stmt)).scalar_one()
        await self._session.commit()
        await self._invalidate(row)
        return row, created

    async def list_memories(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        ref: MemoryScopeRef,
        category: str | None = None,
        search: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[AgentMemory], int]:
        await self._require_view(
            user_id=user_id,
            organization_id=organization_id,
            agent_id=agent_id,
            ref=ref,
        )

        base_filters = scope_filters(agent_id, organization_id, ref)
        if category is not None:
            base_filters.append(AgentMemory.category == category)
        if search is not None and search.strip():
            pattern = f"%{search.strip()}%"
            base_filters.append(
                or_(
                    AgentMemory.key.ilike(pattern),  # type: ignore[union-attr]
                    AgentMemory.description.ilike(pattern),  # type: ignore[union-attr]
                    AgentMemory.content.ilike(pattern),  # type: ignore[union-attr]
                )
            )

        total = (
            await self._session.execute(
                select(func.count()).select_from(AgentMemory).where(*base_filters)
            )
        ).scalar() or 0

        offset = (page - 1) * page_size
        result = await self._session.execute(
            select(AgentMemory)
            .where(*base_filters)
            .order_by(
                AgentMemory.pinned.desc(),  # type: ignore[union-attr]
                AgentMemory.importance.desc(),
                AgentMemory.updated_at.desc(),
            )
            .offset(offset)
            .limit(page_size)
        )
        return list(result.scalars().all()), total

    async def update_memory(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        memory_id: UUID,
        description: str | None = None,
        content: str | None = None,
        category: str | None = None,
        importance: float | None = None,
    ) -> AgentMemory:
        memory = await self._get_memory(memory_id, organization_id)
        await self._require_mutate(
            user_id=user_id, organization_id=organization_id, memory=memory
        )

        if description is not None:
            description = description.strip()
            if not description or len(description) > 255:
                raise ValidationError(
                    "description", "Description must be 1-255 characters"
                )
            memory.description = description
        if content is not None:
            content = content.strip()
            if not content or len(content) > MAX_CONTENT_CHARS:
                raise ValidationError(
                    "content", f"Content must be 1-{MAX_CONTENT_CHARS} characters"
                )
            memory.content = content
        if category is not None:
            if category not in VALID_CATEGORIES:
                valid = ", ".join(sorted(VALID_CATEGORIES))
                raise ValidationError(
                    "category", f"Invalid category '{category}'. Must be one of: {valid}"
                )
            memory.category = category
        if importance is not None:
            if importance < 0.0 or importance > 1.0:
                raise ValidationError(
                    "importance", "Importance must be between 0.0 and 1.0"
                )
            memory.importance = importance

        memory.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(memory)
        await self._invalidate(memory)
        return memory

    async def delete_memory(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        memory_id: UUID,
    ) -> None:
        memory = await self._get_memory(memory_id, organization_id)
        await self._require_mutate(
            user_id=user_id, organization_id=organization_id, memory=memory
        )
        await self._invalidate(memory)
        await self._session.delete(memory)
        await self._session.commit()

    async def set_memory_pinned(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        memory_id: UUID,
        pinned: bool,
    ) -> AgentMemory:
        memory = await self._get_memory(memory_id, organization_id)
        await self._require_pin(
            user_id=user_id, organization_id=organization_id, memory=memory
        )

        if pinned and not memory.pinned:
            ref = scope_ref_for_memory(memory)
            rows = (
                await self._session.execute(
                    select(AgentMemory.id, AgentMemory.content).where(
                        *scope_filters(memory.agent_id, organization_id, ref),
                        AgentMemory.pinned.is_(True),  # type: ignore[union-attr]
                    )
                )
            ).all()
            if len(rows) >= MAX_PINNED_ENTRIES:
                raise ValidationError(
                    "pinned",
                    f"Pin limit reached ({MAX_PINNED_ENTRIES} entries in this scope)",
                )
            pinned_chars = sum(len(c) for _, c in rows) + len(memory.content)
            if pinned_chars > MAX_PINNED_CHARS:
                raise ValidationError(
                    "pinned",
                    f"Pinned content limit reached ({MAX_PINNED_CHARS} characters in this scope)",
                )

        memory.pinned = pinned
        memory.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(memory)
        await self._invalidate(memory)
        return memory
