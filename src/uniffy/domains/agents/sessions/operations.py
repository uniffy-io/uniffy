"""Business logic for session and message management."""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.models.agents.session import AgentSession
from uniffy.core.valkey.queue import get_queue_safe
from uniffy.domains.agents.runtime.compactor import summarise_conversation
from uniffy.domains.organizations.operations import OrganizationOperations

VALID_SESSION_KINDS = {"direct", "group", "global", "cron"}
VALID_MESSAGE_ROLES = {"user", "assistant", "tool", "system", "summary"}


def apply_emergency_truncation(
    context: list[AgentMessage],
    token_budget: int,
) -> list[AgentMessage]:
    """Drop oldest non-summary tool rows when the context still overruns budget.

    Compaction is async (ARQ ``compact_session``); the worker may not have
    caught up by the time the runtime issues an LLM call. This helper is
    the in-memory safety net: walk the context oldest-first, drop
    ``role="tool"`` rows until the running ``token_estimate`` total falls
    below ``token_budget`` (or no more tool rows remain). Orphaned
    ``tool_use`` blocks left behind on assistant messages are tolerated --
    ``RuntimeOperations._build_llm_messages`` synthesises an
    "interrupted" tool_result for any orphan it finds.

    Summary messages are never dropped (they are the compressed history).
    Returns the trimmed list. Mutates nothing in place.
    """
    if token_budget <= 0 or not context:
        return list(context)

    total = sum(int(getattr(m, "token_estimate", 0) or 0) for m in context)
    if total <= token_budget:
        return list(context)

    keep: list[AgentMessage] = list(context)
    for idx, msg in enumerate(context):
        if total <= token_budget:
            break
        if msg.role != "tool":
            continue
        msg_tokens = int(getattr(msg, "token_estimate", 0) or 0)
        keep[idx] = None  # type: ignore[call-overload]
        total -= msg_tokens

    return [m for m in keep if m is not None]


# Default context window budget: how much of the model's context window
# we allow for conversation history (the rest is reserved for system prompt,
# tool schemas, and the LLM's response).
DEFAULT_CONTEXT_TOKEN_BUDGET_RATIO = 0.65
# When compaction triggers, compact messages until active token usage
# drops below this ratio of the model's context window.
COMPACTION_TARGET_RATIO = 0.40
# Fallback context window when model info is unavailable.
FALLBACK_CONTEXT_WINDOW = 200_000


@dataclass
class CompactionResult:
    """Result of a compaction operation."""

    performed: bool
    messages_compacted: int = 0
    tokens_before: int = 0
    tokens_after: int = 0
    tokens_saved: int = 0
    summary_tokens: int = 0


@dataclass
class _CompactionUnit:
    """Atomic group of messages that must be compacted together.

    A unit is one of:
    - A standalone user message
    - A standalone assistant message (no tool calls)
    - An assistant tool-call chain (assistant with tool_use + all tool
      results + optional final assistant response)
    """

    messages: list[AgentMessage]
    tokens: int = 0


def _build_compaction_units(messages: list[AgentMessage]) -> list[_CompactionUnit]:
    """Group messages into atomic compaction units.

    Tool call chains (assistant tool_use + tool results) are grouped
    together so they are never split during compaction.

    Parameters
    ----------
    messages : list[AgentMessage]
        Messages ordered by created_at (oldest first).

    Returns
    -------
    list[_CompactionUnit]
        Ordered list of compaction units.

    """
    units: list[_CompactionUnit] = []
    i = 0

    while i < len(messages):
        msg = messages[i]

        # Assistant message with a tool_call_id starts a tool chain
        if msg.role == "assistant" and msg.tool_call_id:
            chain = [msg]
            i += 1

            # Collect all subsequent tool results that belong to this chain
            # and any follow-up assistant messages with tool calls
            while i < len(messages):
                next_msg = messages[i]
                if next_msg.role == "tool":
                    chain.append(next_msg)
                    i += 1
                elif next_msg.role == "assistant" and next_msg.tool_call_id:
                    # Another tool call in the same turn
                    chain.append(next_msg)
                    i += 1
                elif next_msg.role == "assistant" and not next_msg.tool_call_id:
                    # Final assistant response after tool results
                    chain.append(next_msg)
                    i += 1
                    break
                else:
                    break

            tokens = sum(_estimate_message_tokens(m) for m in chain)
            units.append(_CompactionUnit(messages=chain, tokens=tokens))
        else:
            # Standalone message (user, assistant without tools, system)
            tokens = _estimate_message_tokens(msg)
            units.append(_CompactionUnit(messages=[msg], tokens=tokens))
            i += 1

    return units


def _estimate_message_tokens(msg: AgentMessage) -> int:
    """Estimate token count for a message based on content length.

    Uses a rough heuristic of ~4 characters per token for English text.
    This is intentionally conservative (overestimates slightly) to avoid
    exceeding the actual context window.

    Parameters
    ----------
    msg : AgentMessage
        The message to estimate tokens for.

    Returns
    -------
    int
        Estimated token count.

    """
    chars = len(msg.content or "")
    if msg.tool_args:
        try:
            chars += len(json.dumps(msg.tool_args))
        except TypeError, ValueError:
            chars += 100
    if msg.tool_result:
        chars += len(msg.tool_result)
    # Role overhead (role tag, formatting)
    chars += 20
    return max(1, chars // 4)


class SessionOperations:
    """Operations for managing conversation sessions.

    Parameters
    ----------
    session : AsyncSession
        Database session.

    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._org_ops = OrganizationOperations(session)

    async def create_session(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        kind: str,
        display_name: str | None = None,
        model_override: str | None = None,
    ) -> AgentSession:
        """Create a new conversation session.

        Always creates a new session regardless of kind.

        Parameters
        ----------
        user_id : UUID
            The user creating the session.
        organization_id : UUID
            Organization context.
        agent_id : UUID
            Agent to converse with.
        kind : str
            Session kind: "direct", "group", or "global".
        display_name : str | None
            Optional user-provided name.
        model_override : str | None
            Optional per-session model override.

        Returns
        -------
        AgentSession
            The created or existing session.

        Raises
        ------
        ValidationError
            If kind is invalid.
        PermissionDeniedError
            If user is not an org member.

        """
        await self._org_ops.require_org_member(user_id, organization_id)

        if kind not in VALID_SESSION_KINDS:
            raise ValidationError("kind", f"Must be one of: {', '.join(VALID_SESSION_KINDS)}")

        agent_session = AgentSession(
            organization_id=organization_id,
            agent_id=agent_id,
            user_id=user_id,
            kind=kind,
            display_name=display_name.strip() if display_name else None,
            model_override=model_override.strip() if model_override else None,
        )
        self._session.add(agent_session)
        await self._session.commit()
        await self._session.refresh(agent_session)
        return agent_session

    async def get_session(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
    ) -> AgentSession:
        """Fetch a session by ID.

        Verifies the user owns the session or it is a global session.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        session_id : UUID
            Session to fetch.

        Returns
        -------
        AgentSession
            The session.

        Raises
        ------
        NotFoundError
            If the session does not exist.
        PermissionDeniedError
            If the user cannot access this session.

        """
        await self._org_ops.require_org_member(user_id, organization_id)

        result = await self._session.execute(
            select(AgentSession).where(
                AgentSession.id == session_id,
                AgentSession.organization_id == organization_id,
            )
        )
        agent_session = result.scalar_one_or_none()
        if not agent_session:
            raise NotFoundError("AgentSession", str(session_id))

        self._verify_session_access(agent_session, user_id)
        return agent_session

    async def list_sessions(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        page: int = 1,
        page_size: int = 50,
        agent_id: UUID | None = None,
        kind: str | None = None,
        is_archived: bool | None = None,
    ) -> tuple[list[AgentSession], int]:
        """List sessions for a user in an organization.

        Returns the user's own sessions plus any global sessions.

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
        agent_id : UUID | None
            Optional filter by agent.
        kind : str | None
            Optional filter by session kind.
        is_archived : bool | None
            Optional filter by archived status.

        Returns
        -------
        tuple[list[AgentSession], int]
            (sessions, total_count).

        Raises
        ------
        PermissionDeniedError
            If user is not an org member.

        """
        await self._org_ops.require_org_member(user_id, organization_id)

        # User sees their own sessions + global sessions
        base_filter = and_(
            AgentSession.organization_id == organization_id,
            or_(
                AgentSession.user_id == user_id,
                AgentSession.kind == "global",
            ),
        )

        stmt = select(AgentSession).where(base_filter)
        count_stmt = select(func.count()).select_from(AgentSession).where(base_filter)

        if agent_id is not None:
            stmt = stmt.where(AgentSession.agent_id == agent_id)
            count_stmt = count_stmt.where(AgentSession.agent_id == agent_id)

        if kind is not None:
            stmt = stmt.where(AgentSession.kind == kind)
            count_stmt = count_stmt.where(AgentSession.kind == kind)

        if is_archived is not None:
            stmt = stmt.where(AgentSession.is_archived == is_archived)
            count_stmt = count_stmt.where(AgentSession.is_archived == is_archived)

        total_result = await self._session.execute(count_stmt)
        total = total_result.scalar() or 0

        offset = (page - 1) * page_size
        stmt = stmt.order_by(AgentSession.updated_at.desc()).offset(offset).limit(page_size)

        result = await self._session.execute(stmt)
        sessions = list(result.scalars().all())
        return sessions, total

    async def update_session(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        display_name: str | None = None,
        model_override: str | None = None,
    ) -> AgentSession:
        """Update session settings.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        session_id : UUID
            Session to update.
        display_name : str | None
            New display name (None = no change).
        model_override : str | None
            New model override (None = no change).

        Returns
        -------
        AgentSession
            The updated session.

        Raises
        ------
        NotFoundError
            If the session does not exist.
        PermissionDeniedError
            If the user cannot modify this session.

        """
        await self._org_ops.require_org_member(user_id, organization_id)

        result = await self._session.execute(
            select(AgentSession).where(
                AgentSession.id == session_id,
                AgentSession.organization_id == organization_id,
            )
        )
        agent_session = result.scalar_one_or_none()
        if not agent_session:
            raise NotFoundError("AgentSession", str(session_id))

        self._verify_session_owner_or_admin(agent_session, user_id, organization_id)

        if display_name is not None:
            agent_session.display_name = display_name.strip() or None

        if model_override is not None:
            agent_session.model_override = model_override.strip() or None

        agent_session.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(agent_session)
        return agent_session

    async def archive_session(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
    ) -> None:
        """Archive a session (soft delete).

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        session_id : UUID
            Session to archive.

        Raises
        ------
        NotFoundError
            If the session does not exist.
        PermissionDeniedError
            If the user cannot archive this session.

        """
        await self._org_ops.require_org_member(user_id, organization_id)

        result = await self._session.execute(
            select(AgentSession).where(
                AgentSession.id == session_id,
                AgentSession.organization_id == organization_id,
            )
        )
        agent_session = result.scalar_one_or_none()
        if not agent_session:
            raise NotFoundError("AgentSession", str(session_id))

        self._verify_session_owner_or_admin(agent_session, user_id, organization_id)

        agent_session.is_archived = True
        agent_session.updated_at = datetime.now(UTC)
        await self._session.commit()

    async def add_message(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        role: str,
        content: str | None = None,
        input_tokens: int = 0,
        output_tokens: int = 0,
        model: str | None = None,
        tool_name: str | None = None,
        tool_call_id: str | None = None,
        tool_args: dict | None = None,
        tool_result: str | None = None,
        is_thinking: bool = False,
        file_ids: list[str] | None = None,
    ) -> AgentMessage:
        """Add a message to a session.

        Creates the message and updates session aggregate counters
        (token counts, message_count, last_model_used, updated_at).

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        session_id : UUID
            Session to add message to.
        role : str
            Message role: "user", "assistant", "tool", "system", "summary".
        content : str | None
            Text content (nullable for tool messages).
        input_tokens : int
            Input tokens consumed.
        output_tokens : int
            Output tokens produced.
        model : str | None
            Which model produced this message.
        tool_name : str | None
            Tool name for tool-role messages.
        tool_call_id : str | None
            Anthropic tool_use ID.
        tool_args : dict | None
            Tool call arguments.
        tool_result : str | None
            Tool execution result.
        is_thinking : bool
            Whether this is a thinking/reasoning message.

        Returns
        -------
        AgentMessage
            The created message.

        Raises
        ------
        NotFoundError
            If the session does not exist.
        PermissionDeniedError
            If the user cannot add messages to this session.
        ValidationError
            If the role is invalid.

        """
        await self._org_ops.require_org_member(user_id, organization_id)

        if role not in VALID_MESSAGE_ROLES:
            raise ValidationError("role", f"Must be one of: {', '.join(VALID_MESSAGE_ROLES)}")

        result = await self._session.execute(
            select(AgentSession).where(
                AgentSession.id == session_id,
                AgentSession.organization_id == organization_id,
            )
        )
        agent_session = result.scalar_one_or_none()
        if not agent_session:
            raise NotFoundError("AgentSession", str(session_id))

        self._verify_session_access(agent_session, user_id)

        message = AgentMessage(
            session_id=session_id,
            role=role,
            content=content,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            model=model,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            tool_args=tool_args,
            tool_result=tool_result,
            file_ids=file_ids,
            is_thinking=is_thinking,
        )
        message.token_estimate = _estimate_message_tokens(message)
        self._session.add(message)

        # Update session aggregates
        agent_session.total_input_tokens += input_tokens
        agent_session.total_output_tokens += output_tokens
        agent_session.message_count += 1
        agent_session.updated_at = datetime.now(UTC)
        if model:
            agent_session.last_model_used = model

        await self._session.commit()
        await self._session.refresh(message)
        return message

    async def list_messages(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        page: int = 1,
        page_size: int = 50,
        include_compacted: bool = False,
    ) -> tuple[list[AgentMessage], int]:
        """List messages in a session ordered by created_at.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        session_id : UUID
            Session to list messages for.
        page : int
            Page number (1-based).
        page_size : int
            Results per page.
        include_compacted : bool
            Whether to include compacted messages (default False).

        Returns
        -------
        tuple[list[AgentMessage], int]
            (messages, total_count).

        Raises
        ------
        NotFoundError
            If the session does not exist.
        PermissionDeniedError
            If the user cannot access this session.

        """
        await self._org_ops.require_org_member(user_id, organization_id)

        # Verify session exists and user has access
        session_result = await self._session.execute(
            select(AgentSession).where(
                AgentSession.id == session_id,
                AgentSession.organization_id == organization_id,
            )
        )
        agent_session = session_result.scalar_one_or_none()
        if not agent_session:
            raise NotFoundError("AgentSession", str(session_id))

        self._verify_session_access(agent_session, user_id)

        base_filter = AgentMessage.session_id == session_id
        stmt = select(AgentMessage).where(base_filter)
        count_stmt = select(func.count()).select_from(AgentMessage).where(base_filter)

        if not include_compacted:
            stmt = stmt.where(AgentMessage.is_compacted == False)  # noqa: E712
            count_stmt = count_stmt.where(AgentMessage.is_compacted == False)  # noqa: E712

        total_result = await self._session.execute(count_stmt)
        total = total_result.scalar() or 0

        offset = (page - 1) * page_size
        stmt = stmt.order_by(AgentMessage.created_at).offset(offset).limit(page_size)

        result = await self._session.execute(stmt)
        messages = list(result.scalars().all())
        return messages, total

    async def get_context_stats(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        context_window_tokens: int = FALLBACK_CONTEXT_WINDOW,
    ) -> dict:
        """Get context window statistics for a session.

        All thresholds and budgets are token-based, estimated from
        message content length (~4 chars/token).

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        session_id : UUID
            Session to get stats for.
        context_window_tokens : int
            Model context window size in tokens.

        Returns
        -------
        dict
            Token-based statistics about context usage and compaction state.

        Raises
        ------
        NotFoundError
            If the session does not exist.
        PermissionDeniedError
            If the user cannot access this session.

        """
        await self._org_ops.require_org_member(user_id, organization_id)

        session_result = await self._session.execute(
            select(AgentSession).where(
                AgentSession.id == session_id,
                AgentSession.organization_id == organization_id,
            )
        )
        agent_session = session_result.scalar_one_or_none()
        if not agent_session:
            raise NotFoundError("AgentSession", str(session_id))
        self._verify_session_access(agent_session, user_id)

        # Total messages (all, including compacted)
        total_result = await self._session.execute(
            select(func.count())
            .select_from(AgentMessage)
            .where(AgentMessage.session_id == session_id)
        )
        total_messages = total_result.scalar() or 0

        # Compacted messages
        compacted_result = await self._session.execute(
            select(func.count())
            .select_from(AgentMessage)
            .where(
                AgentMessage.session_id == session_id,
                AgentMessage.is_compacted == True,  # noqa: E712
            )
        )
        compacted_messages = compacted_result.scalar() or 0

        # All active (non-compacted) messages for token estimation
        active_result = await self._session.execute(
            select(AgentMessage).where(
                AgentMessage.session_id == session_id,
                AgentMessage.is_compacted == False,  # noqa: E712
            )
        )
        active_msgs = list(active_result.scalars().all())

        active_messages = len(active_msgs)
        summary_count = sum(1 for m in active_msgs if m.role == "summary")
        active_tokens = sum(_estimate_message_tokens(m) for m in active_msgs)

        # Token budget for conversation history
        token_budget = int(context_window_tokens * DEFAULT_CONTEXT_TOKEN_BUDGET_RATIO)
        tokens_until_compaction = max(0, token_budget - active_tokens)

        return {
            "total_messages": total_messages,
            "active_messages": active_messages,
            "compacted_messages": compacted_messages,
            "summary_count": summary_count,
            "active_tokens": active_tokens,
            "token_budget": token_budget,
            "tokens_until_compaction": tokens_until_compaction,
            "context_window_tokens": context_window_tokens,
        }

    async def get_session_context(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        token_budget: int | None = None,
    ) -> tuple[list[AgentMessage], int]:
        """Get recent messages for LLM context assembly.

        Returns summary messages first (if any), then the most recent
        non-compacted messages that fit within the token budget. The
        recent-messages slice is computed by a single window-function
        query over ``token_estimate``, so the read path does not
        re-estimate per row.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        session_id : UUID
            Session to get context for.
        token_budget : int | None
            Maximum estimated tokens for context (default: 65% of 200k).

        Returns
        -------
        tuple[list[AgentMessage], int]
            (context_messages, total_non_compacted_count).

        Raises
        ------
        NotFoundError
            If the session does not exist.
        PermissionDeniedError
            If the user cannot access this session.

        """
        await self._org_ops.require_org_member(user_id, organization_id)

        session_result = await self._session.execute(
            select(AgentSession).where(
                AgentSession.id == session_id,
                AgentSession.organization_id == organization_id,
            )
        )
        agent_session = session_result.scalar_one_or_none()
        if not agent_session:
            raise NotFoundError("AgentSession", str(session_id))

        self._verify_session_access(agent_session, user_id)

        budget = (
            token_budget
            if token_budget and token_budget > 0
            else int(FALLBACK_CONTEXT_WINDOW * DEFAULT_CONTEXT_TOKEN_BUDGET_RATIO)
        )

        count_result = await self._session.execute(
            select(func.count())
            .select_from(AgentMessage)
            .where(
                AgentMessage.session_id == session_id,
                AgentMessage.is_compacted == False,  # noqa: E712
            )
        )
        total = count_result.scalar() or 0

        summary_result = await self._session.execute(
            select(AgentMessage)
            .where(
                AgentMessage.session_id == session_id,
                AgentMessage.role == "summary",
                AgentMessage.is_compacted == False,  # noqa: E712
            )
            .order_by(AgentMessage.created_at)
        )
        all_summaries = list(summary_result.scalars().all())

        summary_budget = budget // 5
        tokens_used = 0
        summaries: list[AgentMessage] = []
        for s in reversed(all_summaries):
            s_tokens = int(s.token_estimate or 0) or _estimate_message_tokens(s)
            if tokens_used + s_tokens > summary_budget and summaries:
                break
            summaries.insert(0, s)
            tokens_used += s_tokens

        remaining_budget = max(0, budget - tokens_used)

        cumulative = func.sum(
            func.coalesce(AgentMessage.token_estimate, 0)
        ).over(order_by=AgentMessage.created_at.desc()).label("cumulative_tokens")

        ranked = (
            select(AgentMessage, cumulative)
            .where(
                AgentMessage.session_id == session_id,
                AgentMessage.is_compacted == False,  # noqa: E712
                AgentMessage.role != "summary",
            )
            .subquery()
        )
        ranked_msg = aliased(AgentMessage, ranked)

        most_recent_id = (
            select(ranked.c.id)
            .order_by(ranked.c.cumulative_tokens)
            .limit(1)
            .scalar_subquery()
        )

        recent_stmt = (
            select(ranked_msg)
            .where(
                or_(
                    ranked.c.cumulative_tokens <= remaining_budget,
                    ranked_msg.id == most_recent_id,
                )
            )
            .order_by(ranked_msg.created_at)
        )
        recent_result = await self._session.execute(recent_stmt)
        recent = list(recent_result.scalars().all())

        return summaries + recent, total

    def _verify_session_access(
        self,
        agent_session: AgentSession,
        user_id: UUID,
    ) -> None:
        """Verify user can access a session.

        Users can access sessions they own or global sessions.

        Parameters
        ----------
        agent_session : AgentSession
            The session to check.
        user_id : UUID
            The requesting user.

        Raises
        ------
        PermissionDeniedError
            If access is denied.

        """
        if agent_session.user_id != user_id and agent_session.kind != "global":
            raise PermissionDeniedError("access", "AgentSession")

    def _verify_session_owner_or_admin(
        self,
        agent_session: AgentSession,
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        """Verify user owns the session or is an org admin.

        Parameters
        ----------
        agent_session : AgentSession
            The session to check.
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context (for future admin check).

        Raises
        ------
        PermissionDeniedError
            If the user is not the session owner.

        """
        if agent_session.user_id != user_id:
            raise PermissionDeniedError("modify", "AgentSession")

    async def enqueue_compaction_if_needed(
        self,
        *,
        session_id: UUID,
        token_budget: int,
    ) -> bool:
        """Enqueue async compaction when active token usage exceeds the budget.

        The active-tokens probe is a single ``SUM(token_estimate)`` over
        non-compacted, non-summary rows -- cheap, no LLM call. When the
        sum exceeds ``token_budget`` an ARQ ``compact_session`` job is
        enqueued. The worker side is idempotent via a Valkey
        ``SET NX compaction_lock:{session_id}`` lock, so spamming this
        helper across concurrent requests does not duplicate the work.

        Returns
        -------
        bool
            True if a job was enqueued (or attempted), False if the
            session was under budget.

        """
        if token_budget <= 0:
            return False

        result = await self._session.execute(
            select(func.coalesce(func.sum(AgentMessage.token_estimate), 0)).where(
                AgentMessage.session_id == session_id,
                AgentMessage.is_compacted == False,  # noqa: E712
                AgentMessage.role != "summary",
            )
        )
        active_tokens = int(result.scalar() or 0)
        if active_tokens <= token_budget:
            return False

        queue = await get_queue_safe()
        if queue is None:
            logger.warning(
                "Compaction queue unavailable; session over budget but no enqueue",
                session_id=str(session_id),
                active_tokens=active_tokens,
                token_budget=token_budget,
            )
            return False

        try:
            await queue.enqueue_job("compact_session", str(session_id))
        except Exception:
            logger.warning(
                "compact_session enqueue failed",
                session_id=str(session_id),
                exc_info=True,
            )
            return False
        return True

    async def compact_session_if_needed(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        provider,
        model: str,
        context_window_tokens: int = FALLBACK_CONTEXT_WINDOW,
        force: bool = False,
    ) -> CompactionResult:
        """Compact old messages when estimated token usage exceeds the budget.

        Groups messages into atomic "compaction units" (standalone messages
        or tool-call chains) and compacts the oldest units until active
        token usage drops below the target ratio (40% of context window).

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        session_id : UUID
            Session to compact.
        provider : LLMProvider
            LLM provider for generating the summary.
        model : str
            Model to use for summarization.
        context_window_tokens : int
            Model context window size in tokens.
        force : bool
            Force compaction regardless of token usage.

        Returns
        -------
        CompactionResult
            Stats about the compaction operation.

        """
        no_op = CompactionResult(performed=False)
        token_budget = int(context_window_tokens * DEFAULT_CONTEXT_TOKEN_BUDGET_RATIO)
        target_tokens = int(context_window_tokens * COMPACTION_TARGET_RATIO)

        # Fetch all active non-summary messages ordered oldest first
        active_result = await self._session.execute(
            select(AgentMessage)
            .where(
                AgentMessage.session_id == session_id,
                AgentMessage.is_compacted == False,  # noqa: E712
                AgentMessage.role != "summary",
            )
            .order_by(AgentMessage.created_at)
        )
        all_active = list(active_result.scalars().all())

        # Build compaction units - atomic groups of messages
        units = _build_compaction_units(all_active)

        # Need at least 2 units (compact some, keep some)
        if len(units) < 2:
            return no_op

        # Calculate total active tokens
        total_active_tokens = sum(u.tokens for u in units)

        if not force and total_active_tokens <= token_budget:
            return no_op

        # Determine how many tokens to remove to reach the target
        tokens_to_remove = total_active_tokens - target_tokens
        if tokens_to_remove <= 0 and not force:
            return no_op

        # Walk from oldest, accumulating units until we have enough
        # tokens to compact. Always keep at least the last unit.
        units_to_compact: list[_CompactionUnit] = []
        compact_tokens = 0
        max_compactable = len(units) - 1  # keep at least the last unit

        for i in range(max_compactable):
            units_to_compact.append(units[i])
            compact_tokens += units[i].tokens
            if not force and compact_tokens >= tokens_to_remove:
                break

        if not units_to_compact:
            return no_op

        # Flatten units into messages
        messages_to_compact: list[AgentMessage] = []
        for unit in units_to_compact:
            messages_to_compact.extend(unit.messages)

        tokens_before = total_active_tokens

        entries: list[tuple[str, str]] = []
        for msg in messages_to_compact:
            content = msg.content or ""
            if msg.tool_name:
                content = f"[Tool: {msg.tool_name}] {msg.tool_result or content}"
            entries.append((msg.role.upper(), content))

        summary_result = await summarise_conversation(
            provider=provider,
            model=model,
            entries=entries,
        )
        if summary_result is None:
            return no_op

        for msg in messages_to_compact:
            msg.is_compacted = True

        summary_message = AgentMessage(
            session_id=session_id,
            role="summary",
            content=summary_result.content,
            input_tokens=summary_result.input_tokens,
            output_tokens=summary_result.output_tokens,
            model=model,
        )
        summary_message.token_estimate = _estimate_message_tokens(summary_message)
        self._session.add(summary_message)
        await self._session.commit()

        # Calculate post-compaction tokens
        summary_msg_tokens = _estimate_message_tokens(summary_message)
        tokens_after = tokens_before - compact_tokens + summary_msg_tokens

        # Re-compact old summaries if too many have accumulated
        await self._consolidate_summaries(
            session_id=session_id,
            provider=provider,
            model=model,
            max_summaries=5,
        )

        return CompactionResult(
            performed=True,
            messages_compacted=len(messages_to_compact),
            tokens_before=tokens_before,
            tokens_after=tokens_after,
            tokens_saved=max(0, tokens_before - tokens_after),
            summary_tokens=summary_result.input_tokens + summary_result.output_tokens,
        )

    async def _consolidate_summaries(
        self,
        *,
        session_id: UUID,
        provider,
        model: str,
        max_summaries: int = 5,
    ) -> bool:
        """Merge old summaries when they exceed the limit.

        Keeps the most recent ``max_summaries - 1`` summaries intact
        and consolidates all older ones into a single super-summary.
        This prevents unbounded summary growth in long-running sessions.

        Parameters
        ----------
        session_id : UUID
            Session whose summaries to consolidate.
        provider : LLMProvider
            LLM provider for generating the consolidated summary.
        model : str
            Model to use for summarization.
        max_summaries : int
            Maximum number of summary messages to keep.

        Returns
        -------
        bool
            True if consolidation was performed.

        """
        summary_result = await self._session.execute(
            select(AgentMessage)
            .where(
                AgentMessage.session_id == session_id,
                AgentMessage.role == "summary",
                AgentMessage.is_compacted == False,  # noqa: E712
            )
            .order_by(AgentMessage.created_at)
        )
        all_summaries = list(summary_result.scalars().all())

        if len(all_summaries) <= max_summaries:
            return False

        # Keep the newest (max_summaries - 1), consolidate the rest
        to_merge = all_summaries[: -(max_summaries - 1)]
        merge_text = "\n\n---\n\n".join(s.content for s in to_merge if s.content)

        if not merge_text:
            return False

        consolidation_prompt = (
            "The following are multiple conversation summaries from the same "
            "session, listed chronologically. Merge them into a single concise "
            "summary that preserves all key facts, decisions, user preferences, "
            "and referenced content URNs. Remove redundancy.\n\n"
            f"{merge_text}"
        )

        try:
            result = await provider.chat_completion(
                messages=[{"role": "user", "content": consolidation_prompt}],
                model=model,
                system="You are a conversation summarizer. Produce a concise merged summary.",
            )
            merged_content = result.content
        except Exception as exc:
            logger.error(f"Summary consolidation failed: {exc}")
            return False

        if not merged_content:
            return False

        # Mark old summaries as compacted
        for summary in to_merge:
            summary.is_compacted = True

        # Create the consolidated summary with token usage
        consolidated = AgentMessage(
            session_id=session_id,
            role="summary",
            content=merged_content,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            model=model,
        )
        consolidated.token_estimate = _estimate_message_tokens(consolidated)
        self._session.add(consolidated)
        await self._session.commit()

        return True
