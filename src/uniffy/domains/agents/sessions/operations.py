"""Business logic for session and message management."""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.models.agents.session import AgentSession
from uniffy.core.valkey.queue import get_queue_safe
from uniffy.core.valkey.streams import session_has_active_run
from uniffy.domains.agents.runtime.compactor import summarise_conversation
from uniffy.domains.organizations.operations import OrganizationOperations

VALID_SESSION_KINDS = {"direct", "group", "global", "cron"}
VALID_MESSAGE_ROLES = {"user", "assistant", "tool", "system", "summary"}

# Maximum age (in seconds) at which a user message remains editable.
# After the window expires, the user must use "retry" or send a new
# message rather than editing in-place. The window is kept tight so
# that audit logs and downstream invalidation cascades stay relevant
# to the current conversation, not to history a model has long since
# moved past.
EDIT_WINDOW_SECONDS = 600


# Hard cap on rows handed to the LLM when the async compaction worker
# hasn't caught up yet. The runtime trusts the provider-reported prompt
# size for budget decisions; this cap protects against pathological row
# counts (thousands of tool messages in a stuck session) hitting the API.
EMERGENCY_TRUNCATION_KEEP_ROWS = 100


def apply_emergency_truncation(
    context: list[AgentMessage],
    token_budget: int,
) -> list[AgentMessage]:
    """Drop oldest tool rows when active context exceeds the row cap.

    In-memory safety net for the gap between an over-budget read and the
    async compaction worker catching up. Summary rows are never dropped;
    orphaned `tool_use` blocks are tolerated by the LLM message builder.
    """
    del token_budget  # unused; sizing is row-based now
    if len(context) <= EMERGENCY_TRUNCATION_KEEP_ROWS:
        return list(context)

    keep: list[AgentMessage | None] = list(context)
    for idx, msg in enumerate(context):
        active_count = sum(1 for m in keep if m is not None)
        if active_count <= EMERGENCY_TRUNCATION_KEEP_ROWS:
            break
        if msg.role != "tool":
            continue
        keep[idx] = None

    return [m for m in keep if m is not None]


# Default context window budget: how much of the model's context window
# we allow for conversation history (the rest is reserved for system prompt,
# tool schemas, and the LLM's response).
DEFAULT_CONTEXT_TOKEN_BUDGET_RATIO = 0.65
# When compaction triggers, compact this fraction of the oldest
# compactable units in one pass. The next turn re-triggers if still
# over budget; we no longer have per-row token data to size the cut
# precisely against a target ratio.
COMPACTION_FRACTION = 0.50
# Fallback context window when model info is unavailable.
FALLBACK_CONTEXT_WINDOW = 200_000
# Most recent non-summary rows fed into the next LLM prompt. The async
# compaction worker keeps the active set bounded under normal load; this
# cap is the safety ceiling for the read path.
MAX_CONTEXT_RECENT_MESSAGES = 200
# Most recent summary rows included in the prompt (oldest summaries are
# already merged into a super-summary by ``_consolidate_summaries``).
MAX_CONTEXT_SUMMARIES = 5


@dataclass
class CompactionResult:
    performed: bool
    messages_compacted: int = 0
    tokens_before: int = 0
    tokens_after: int = 0
    tokens_saved: int = 0
    summary_tokens: int = 0


@dataclass
class _CompactionUnit:
    """Atomic group of messages that must be compacted together.

    A unit is one of: a standalone user message, a standalone assistant
    message, or an assistant tool-call chain (tool_use + results + final).
    """

    messages: list[AgentMessage]


def _build_compaction_units(messages: list[AgentMessage]) -> list[_CompactionUnit]:
    """Group messages into atomic compaction units; tool chains stay together."""
    units: list[_CompactionUnit] = []
    i = 0

    while i < len(messages):
        msg = messages[i]

        if msg.role == "assistant" and msg.tool_call_id:
            chain = [msg]
            i += 1
            while i < len(messages):
                next_msg = messages[i]
                if next_msg.role == "tool" or (
                    next_msg.role == "assistant" and next_msg.tool_call_id
                ):
                    chain.append(next_msg)
                    i += 1
                elif next_msg.role == "assistant" and not next_msg.tool_call_id:
                    chain.append(next_msg)
                    i += 1
                    break
                else:
                    break
            units.append(_CompactionUnit(messages=chain))
        else:
            units.append(_CompactionUnit(messages=[msg]))
            i += 1

    return units


class SessionOperations:
    """Operations for managing conversation sessions."""

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
        """Create a new conversation session."""
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
        """Fetch a session; the user must own it or it must be a global session."""
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
        """User's own sessions plus global sessions, with optional filters."""
        await self._org_ops.require_org_member(user_id, organization_id)

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
        """Update session settings; `None` arguments leave the field unchanged."""
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
        """Archive a session (soft delete)."""
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
        cache_read_input_tokens: int = 0,
        model: str | None = None,
        tool_name: str | None = None,
        tool_call_id: str | None = None,
        tool_args: dict | None = None,
        tool_result: str | None = None,
        is_thinking: bool = False,
        file_ids: list[str] | None = None,
    ) -> AgentMessage:
        """Add a message and update session aggregates (tokens, count, model)."""
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
            cache_read_input_tokens=cache_read_input_tokens,
            model=model,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            tool_args=tool_args,
            tool_result=tool_result,
            file_ids=file_ids,
            is_thinking=is_thinking,
        )
        self._session.add(message)

        agent_session.total_input_tokens += input_tokens
        agent_session.total_output_tokens += output_tokens
        agent_session.message_count += 1
        agent_session.updated_at = datetime.now(UTC)
        if model:
            agent_session.last_model_used = model

        await self._session.commit()
        await self._session.refresh(message)
        return message

    async def add_cancelled_placeholder(
        self,
        *,
        session_id: UUID,
    ) -> AgentMessage:
        """Insert an empty `was_cancelled` assistant placeholder after a user cancel."""
        result = await self._session.execute(
            select(AgentSession).where(AgentSession.id == session_id)
        )
        agent_session = result.scalar_one_or_none()
        if agent_session is None:
            raise NotFoundError("AgentSession", str(session_id))

        message = AgentMessage(
            session_id=session_id,
            role="assistant",
            content="",
            input_tokens=0,
            output_tokens=0,
            was_cancelled=True,
        )
        self._session.add(message)
        agent_session.message_count += 1
        agent_session.updated_at = datetime.now(UTC)
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
        """List session messages ordered by created_at."""
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

        ``active_tokens`` is the provider-reported prompt size of the
        most recent assistant turn (its ``input_tokens`` plus
        ``output_tokens``). That value is exactly what the model just
        ingested + just produced, which is the floor of the next
        prompt. Returns 0 before the first assistant reply.

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
            Token statistics about context usage and compaction state.

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

        counts_result = await self._session.execute(
            select(
                func.count().label("total"),
                func.count()
                .filter(AgentMessage.is_compacted == True)  # noqa: E712
                .label("compacted"),
                func.count()
                .filter(
                    and_(
                        AgentMessage.is_compacted == False,  # noqa: E712
                        AgentMessage.role == "summary",
                    )
                )
                .label("summary"),
                func.count()
                .filter(AgentMessage.is_compacted == False)  # noqa: E712
                .label("active"),
            ).where(AgentMessage.session_id == session_id)
        )
        counts = counts_result.one()
        total_messages = int(counts.total or 0)
        compacted_messages = int(counts.compacted or 0)
        summary_count = int(counts.summary or 0)
        active_messages = int(counts.active or 0)

        last_input, last_output, last_cache_read = (
            await self._latest_active_prompt_tokens(session_id)
        )
        active_tokens = last_input + last_output

        token_budget = int(context_window_tokens * DEFAULT_CONTEXT_TOKEN_BUDGET_RATIO)
        tokens_until_compaction = max(0, token_budget - active_tokens)

        return {
            "total_messages": total_messages,
            "active_messages": active_messages,
            "compacted_messages": compacted_messages,
            "summary_count": summary_count,
            "active_tokens": active_tokens,
            "last_input_tokens": last_input,
            "last_output_tokens": last_output,
            "last_cache_read_tokens": last_cache_read,
            "token_budget": token_budget,
            "tokens_until_compaction": tokens_until_compaction,
            "context_window_tokens": context_window_tokens,
        }

    async def _latest_active_prompt_tokens(
        self, session_id: UUID
    ) -> tuple[int, int, int]:
        """Return `(prompt, output, cache_read)` tokens for the latest assistant turn.

        `prompt` is the FULL size (uncached input + cache hits) since both
        count toward context window pressure; cache hits are surfaced
        separately so the meter can show the savings.
        """
        result = await self._session.execute(
            select(
                AgentMessage.input_tokens,
                AgentMessage.output_tokens,
                AgentMessage.cache_read_input_tokens,
            )
            .where(
                AgentMessage.session_id == session_id,
                AgentMessage.role == "assistant",
                AgentMessage.is_compacted == False,  # noqa: E712
            )
            .order_by(AgentMessage.created_at.desc())
            .limit(1)
        )
        row = result.one_or_none()
        if row is None:
            return 0, 0, 0
        uncached_input = int(row[0] or 0)
        output = int(row[1] or 0)
        cache_read = int(row[2] or 0)
        return uncached_input + cache_read, output, cache_read

    async def get_session_context(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        token_budget: int | None = None,
    ) -> tuple[list[AgentMessage], int]:
        """Get messages for LLM context assembly.

        Returns the most recent summaries followed by the most recent
        non-summary messages. Sizing is row-based -- per-message token
        estimates would be guesses since provider counts only exist on
        assistant rows. The compaction worker keeps the active set bounded.
        """
        del token_budget  # unused
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

        count_result = await self._session.execute(
            select(func.count())
            .select_from(AgentMessage)
            .where(
                AgentMessage.session_id == session_id,
                AgentMessage.is_compacted == False,  # noqa: E712
                AgentMessage.is_invalidated == False,  # noqa: E712
            )
        )
        total = count_result.scalar() or 0

        summary_result = await self._session.execute(
            select(AgentMessage)
            .where(
                AgentMessage.session_id == session_id,
                AgentMessage.role == "summary",
                AgentMessage.is_compacted == False,  # noqa: E712
                AgentMessage.is_invalidated == False,  # noqa: E712
            )
            .order_by(AgentMessage.created_at.desc())
            .limit(MAX_CONTEXT_SUMMARIES)
        )
        summaries = list(reversed(summary_result.scalars().all()))

        recent_result = await self._session.execute(
            select(AgentMessage)
            .where(
                AgentMessage.session_id == session_id,
                AgentMessage.is_compacted == False,  # noqa: E712
                AgentMessage.is_invalidated == False,  # noqa: E712
                AgentMessage.role != "summary",
            )
            .order_by(AgentMessage.created_at.desc())
            .limit(MAX_CONTEXT_RECENT_MESSAGES)
        )
        recent = list(reversed(recent_result.scalars().all()))

        return summaries + recent, total

    def _verify_session_access(
        self,
        agent_session: AgentSession,
        user_id: UUID,
    ) -> None:
        """Owner or global session only."""
        if agent_session.user_id != user_id and agent_session.kind != "global":
            raise PermissionDeniedError("access", "AgentSession")

    def _verify_session_owner_or_admin(
        self,
        agent_session: AgentSession,
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        if agent_session.user_id != user_id:
            raise PermissionDeniedError("modify", "AgentSession")

    async def edit_message(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        message_id: UUID,
        new_content: str,
    ) -> AgentMessage:
        """Edit a user message in-place and invalidate every later message.

        Allowed within `EDIT_WINDOW_SECONDS`. Previous content is snapshotted
        onto `previous_content`. Refused while a run is in flight on the
        session -- the edit would invalidate rows the runtime is about to write.
        """
        await self._org_ops.require_org_member(user_id, organization_id)

        new_content_clean = (new_content or "").strip()
        if not new_content_clean:
            raise ValidationError("new_content", "must not be empty")

        msg, agent_session = await self._load_message(
            user_id=user_id,
            organization_id=organization_id,
            message_id=message_id,
        )
        if agent_session.user_id != user_id:
            raise PermissionDeniedError("edit", "AgentMessage")
        if msg.role != "user":
            raise ValidationError("role", "edit is only supported on user messages")
        if msg.is_invalidated:
            raise ValidationError("message", "cannot edit an invalidated message")

        age = (datetime.now(UTC) - msg.created_at).total_seconds()
        if age > EDIT_WINDOW_SECONDS:
            raise ValidationError(
                "message",
                f"edit window expired ({EDIT_WINDOW_SECONDS}s)",
            )

        await self._ensure_no_inflight_run(agent_session.id)

        msg.previous_content = msg.content
        msg.content = new_content_clean
        msg.edited_at = datetime.now(UTC)

        await self._invalidate_downstream(
            session_id=agent_session.id,
            anchor_created_at=msg.created_at,
            user_id=user_id,
            include_anchor=False,
        )
        agent_session.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(msg)
        return msg

    async def delete_message(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        message_id: UUID,
    ) -> int:
        """Soft-delete a message; returns 1 if newly invalidated, 0 if not."""
        await self._org_ops.require_org_member(user_id, organization_id)

        msg, agent_session = await self._load_message(
            user_id=user_id,
            organization_id=organization_id,
            message_id=message_id,
        )
        if agent_session.user_id != user_id:
            raise PermissionDeniedError("delete", "AgentMessage")
        if msg.is_invalidated:
            return 0

        await self._ensure_no_inflight_run(agent_session.id)

        now = datetime.now(UTC)
        msg.is_invalidated = True
        msg.invalidated_at = now
        msg.invalidated_by = user_id
        agent_session.updated_at = now
        await self._session.commit()
        return 1

    async def retry_message(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        message_id: UUID,
    ) -> tuple[str, list[str]]:
        """Walk back to the user anchor, invalidate everything after, return content + files."""
        await self._org_ops.require_org_member(user_id, organization_id)

        msg, agent_session = await self._load_message(
            user_id=user_id,
            organization_id=organization_id,
            message_id=message_id,
        )
        if agent_session.user_id != user_id:
            raise PermissionDeniedError("retry", "AgentMessage")

        anchor: AgentMessage = msg
        if msg.role == "assistant":
            preceding_stmt = (
                select(AgentMessage)
                .where(
                    AgentMessage.session_id == agent_session.id,
                    AgentMessage.role == "user",
                    AgentMessage.is_invalidated == False,  # noqa: E712
                    AgentMessage.created_at < msg.created_at,
                )
                .order_by(AgentMessage.created_at.desc())
                .limit(1)
            )
            preceding_result = await self._session.execute(preceding_stmt)
            anchor_row = preceding_result.scalar_one_or_none()
            if anchor_row is None:
                raise ValidationError(
                    "message",
                    "no preceding user message to retry from",
                )
            anchor = anchor_row
        elif msg.role != "user":
            raise ValidationError(
                "role",
                "retry is only supported on user or assistant messages",
            )

        if anchor.is_invalidated:
            raise ValidationError("message", "cannot retry from an invalidated anchor")

        await self._ensure_no_inflight_run(agent_session.id)

        await self._invalidate_downstream(
            session_id=agent_session.id,
            anchor_created_at=anchor.created_at,
            user_id=user_id,
            include_anchor=False,
        )
        agent_session.updated_at = datetime.now(UTC)
        await self._session.commit()

        return anchor.content or "", list(anchor.file_ids or [])

    async def load_message(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        message_id: UUID,
    ) -> tuple[AgentMessage, AgentSession]:
        """Fetch a message + its session, gated on org and session ownership."""
        return await self._load_message(
            user_id=user_id,
            organization_id=organization_id,
            message_id=message_id,
        )

    async def _load_message(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        message_id: UUID,
    ) -> tuple[AgentMessage, AgentSession]:
        result = await self._session.execute(
            select(AgentMessage, AgentSession)
            .join(AgentSession, AgentMessage.session_id == AgentSession.id)
            .where(
                AgentMessage.id == message_id,
                AgentSession.organization_id == organization_id,
            )
        )
        row = result.one_or_none()
        if row is None:
            raise NotFoundError("AgentMessage", str(message_id))
        msg, agent_session = row
        self._verify_session_access(agent_session, user_id)
        return msg, agent_session

    async def _invalidate_downstream(
        self,
        *,
        session_id: UUID,
        anchor_created_at: datetime,
        user_id: UUID,
        include_anchor: bool,
    ) -> int:
        """Mark every later message (and optionally the anchor itself) invalidated."""
        if include_anchor:
            ts_filter = AgentMessage.created_at >= anchor_created_at
        else:
            ts_filter = AgentMessage.created_at > anchor_created_at

        stmt = select(AgentMessage).where(
            AgentMessage.session_id == session_id,
            AgentMessage.is_invalidated == False,  # noqa: E712
            ts_filter,
        )
        result = await self._session.execute(stmt)
        rows = list(result.scalars().all())
        now = datetime.now(UTC)
        for row in rows:
            row.is_invalidated = True
            row.invalidated_at = now
            row.invalidated_by = user_id
        return len(rows)

    async def _ensure_no_inflight_run(self, session_id: UUID) -> None:
        """Refuse a mutation when an LLM run is currently driving the session."""
        if await session_has_active_run(session_id):
            raise ValidationError(
                "session",
                "cannot mutate messages while a run is streaming",
            )

    async def enqueue_compaction_if_needed(
        self,
        *,
        session_id: UUID,
        token_budget: int,
    ) -> bool:
        """Enqueue async compaction when active context exceeds the budget.

        Probes provider-reported `input + output` on the latest assistant
        row. Worker-side idempotency via a Valkey `SET NX compaction_lock`
        so concurrent enqueues do not duplicate work.
        """
        if token_budget <= 0:
            return False

        last_input, last_output, _ = await self._latest_active_prompt_tokens(session_id)
        active_tokens = last_input + last_output
        if active_tokens <= token_budget:
            return False

        queue = await get_queue_safe("egress")
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
        """Compact oldest message units when usage exceeds the budget.

        Tool-call chains stay grouped. Compacts a fraction of the oldest
        units; the next turn re-triggers if still over.
        """
        no_op = CompactionResult(performed=False)
        token_budget = int(context_window_tokens * DEFAULT_CONTEXT_TOKEN_BUDGET_RATIO)

        last_input, last_output, _ = await self._latest_active_prompt_tokens(session_id)
        tokens_before = last_input + last_output

        if not force and tokens_before <= token_budget:
            return no_op

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

        units = _build_compaction_units(all_active)
        if len(units) < 2:
            return no_op

        # Compact a chunk of the oldest units; next turn re-triggers if still over.
        max_compactable = len(units) - 1
        units_to_drop = max(1, int(max_compactable * COMPACTION_FRACTION))
        units_to_compact = units[:units_to_drop]

        messages_to_compact: list[AgentMessage] = []
        for unit in units_to_compact:
            messages_to_compact.extend(unit.messages)
        if not messages_to_compact:
            return no_op

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
        self._session.add(summary_message)
        await self._session.commit()

        await self._consolidate_summaries(
            session_id=session_id,
            provider=provider,
            model=model,
            max_summaries=MAX_CONTEXT_SUMMARIES,
        )

        # tokens_after is unknown until the next live turn reports back; report 0.
        return CompactionResult(
            performed=True,
            messages_compacted=len(messages_to_compact),
            tokens_before=tokens_before,
            tokens_after=0,
            tokens_saved=tokens_before,
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
        """Merge old summaries into a single super-summary when over the limit."""
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

        for summary in to_merge:
            summary.is_compacted = True

        consolidated = AgentMessage(
            session_id=session_id,
            role="summary",
            content=merged_content,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            model=model,
        )
        self._session.add(consolidated)
        await self._session.commit()

        return True
