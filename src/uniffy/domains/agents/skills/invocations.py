"""Isolated invocation persistence after the runtime's access and snapshot validation."""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from uniffy.core.database import SessionFactory
from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.skill import SkillSurface
from uniffy.core.models.agents.skill_invocation import (
    AgentSkillInvocation,
    SkillInvocationErrorCode,
    SkillInvocationStatus,
)

logger = logger.bind(component="agents.skills.invocations")


@dataclass(frozen=True)
class InvocationTarget:
    organization_id: UUID
    user_id: UUID
    agent_id: UUID
    skill_id: UUID
    skill_version_id: UUID
    skill_version_number: int
    surface: SkillSurface
    session_id: UUID | None = None
    channel_id: UUID | None = None
    trigger_message_id: UUID | None = None

    def __post_init__(self) -> None:
        session_target = self.session_id is not None and self.channel_id is None
        chat_target = self.channel_id is not None and self.session_id is None
        if not (
            (self.surface == SkillSurface.SESSION and session_target)
            or (self.surface == SkillSurface.CHAT and chat_target)
        ):
            raise ValidationError(
                "destination", "A skill invocation requires one matching destination"
            )
        if self.skill_version_number < 1:
            raise ValidationError("skill_version_number", "An exact skill version is required")

    def values(self) -> dict:
        return {
            "organization_id": self.organization_id,
            "user_id": self.user_id,
            "agent_id": self.agent_id,
            "skill_id": self.skill_id,
            "skill_version_id": self.skill_version_id,
            "skill_version_number": self.skill_version_number,
            "surface": self.surface,
            "session_id": self.session_id,
            "channel_id": self.channel_id,
            "trigger_message_id": self.trigger_message_id,
        }


class SkillInvocationRecorder:
    def __init__(self, session_factory: SessionFactory) -> None:
        self._session_factory = session_factory

    async def start(self, *, invocation_id: UUID, target: InvocationTarget) -> AgentSkillInvocation:
        """A run-owned ID makes persistence retries safe without merging distinct human turns."""
        candidate = AgentSkillInvocation(id=invocation_id, **target.values())
        async with self._session_factory() as session:
            await session.execute(
                insert(AgentSkillInvocation)
                .values(**candidate.model_dump())
                .on_conflict_do_nothing(index_elements=[AgentSkillInvocation.id])
            )
            row = (
                await session.execute(
                    select(AgentSkillInvocation).where(
                        AgentSkillInvocation.id == invocation_id,
                        AgentSkillInvocation.organization_id == target.organization_id,
                    )
                )
            ).scalar_one_or_none()
            expected = target.values()
            if target.trigger_message_id is None:
                expected.pop("trigger_message_id")
            if row is None or any(getattr(row, field) != value for field, value in expected.items()):
                raise ValidationError(
                    "invocation_id", "Invocation identity does not match its target"
                )
            # Detach before commit so callers never trigger expired-attribute I/O.
            session.expunge(row)
            await session.commit()
            return row

    async def finalize(
        self,
        *,
        invocation_id: UUID,
        organization_id: UUID,
        status: SkillInvocationStatus,
        run_log_id: UUID | None = None,
        response_message_id: UUID | None = None,
        trigger_message_id: UUID | None = None,
        error_code: SkillInvocationErrorCode | None = None,
        tool_calls: list[dict] | None = None,
    ) -> bool:
        """First terminal outcome wins, even if a retry or cancellation finalizes again."""
        if status == SkillInvocationStatus.STARTED:
            raise ValidationError("status", "Finalization requires a terminal invocation status")
        try:
            async with self._session_factory() as session:
                updated = await session.execute(
                    update(AgentSkillInvocation)
                    .where(
                        AgentSkillInvocation.id == invocation_id,
                        AgentSkillInvocation.organization_id == organization_id,
                        AgentSkillInvocation.status == SkillInvocationStatus.STARTED,
                    )
                    .values(
                        status=status,
                        run_log_id=run_log_id,
                        response_message_id=response_message_id,
                        **({"trigger_message_id": trigger_message_id} if trigger_message_id else {}),
                        error_code=error_code,
                        tool_error_count=sum(
                            call.get("success") is False for call in tool_calls or []
                        ),
                        completed_at=datetime.now(UTC),
                    )
                    .returning(AgentSkillInvocation.id)
                )
                changed = updated.scalar_one_or_none() is not None
                await session.commit()
                return changed
        except Exception:
            logger.opt(exception=True).warning(
                "Skill invocation finalization failed",
                invocation_id=str(invocation_id),
                organization_id=str(organization_id),
                status=status,
            )
            return False
