"""Run-scoped exact skill attribution across preparation, execution, and termination."""

import asyncio
import time
from types import TracebackType
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.database import SessionFactory
from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.skill_invocation import (
    SkillInvocationErrorCode,
    SkillInvocationStatus,
)
from uniffy.core.types import generate_id
from uniffy.domains.agents.providers.base import EventType, StreamEvent
from uniffy.domains.agents.skills.invocations import InvocationTarget, SkillInvocationRecorder
from uniffy.domains.agents.skills.resolution import (
    ResolvedSkill,
    SkillInvocationError,
    SkillSurface,
    resolve_skill_invocation,
)


class InvocationRun:
    def __init__(
        self,
        session_factory: SessionFactory,
        *,
        run_id: UUID | None = None,
        deadline_at: float | None = None,
    ) -> None:
        self.id = run_id or generate_id()
        self._recorder = SkillInvocationRecorder(session_factory)
        self.target: InvocationTarget | None = None
        self.run_log_id: UUID | None = None
        self.response_message_id: UUID | None = None
        self.trigger_message_id: UUID | None = None
        self.tool_calls: list[dict] = []
        self.status = SkillInvocationStatus.FAILED
        self.error_code: SkillInvocationErrorCode | None = SkillInvocationErrorCode.RUN_FAILURE
        self.deadline_at = deadline_at
        self._finalized = False
        self._terminal = False

    async def __aenter__(self) -> InvocationRun:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        if isinstance(exc, (asyncio.CancelledError, GeneratorExit)):
            if not self._terminal:
                if self.deadline_at is not None and time.monotonic() >= self.deadline_at:
                    self.status = SkillInvocationStatus.FAILED
                    self.error_code = SkillInvocationErrorCode.DEADLINE_EXCEEDED
                else:
                    self.status = SkillInvocationStatus.CANCELLED
                    self.error_code = SkillInvocationErrorCode.CANCELLED
        elif isinstance(exc, TimeoutError):
            self.error_code = SkillInvocationErrorCode.DEADLINE_EXCEEDED
        elif exc is None and not self._terminal:
            self.error_code = SkillInvocationErrorCode.INCOMPLETE
        await self.finalize()

    async def finalize(self) -> None:
        if self.target is None or self._finalized:
            return
        self._finalized = await self._recorder.finalize(
            invocation_id=self.id,
            organization_id=self.target.organization_id,
            status=self.status,
            run_log_id=self.run_log_id,
            response_message_id=self.response_message_id,
            trigger_message_id=self.trigger_message_id,
            error_code=self.error_code,
            tool_calls=self.tool_calls,
        )

    async def complete(self, response_message_id: UUID, run_log_id: UUID | None) -> None:
        self._terminal = True
        self.status = SkillInvocationStatus.COMPLETED
        self.error_code = None
        self.response_message_id = response_message_id
        self.run_log_id = run_log_id
        await self.finalize()

    async def fail(self, run_log_id: UUID | None, *, deadline_exceeded: bool = False) -> None:
        self._terminal = True
        self.status = SkillInvocationStatus.FAILED
        self.error_code = (
            SkillInvocationErrorCode.DEADLINE_EXCEEDED
            if deadline_exceeded
            else SkillInvocationErrorCode.PROVIDER_FAILURE
        )
        self.run_log_id = run_log_id
        await self.finalize()

    def observe_stream(self, event: StreamEvent) -> None:
        if event.type is EventType.MESSAGE_STORED and event.message is not None:
            self.response_message_id = event.message.id
        elif event.type is EventType.TOOL_CALL_START:
            self.response_message_id = None

    async def start(self, target: InvocationTarget) -> None:
        existing = await self._recorder.start(invocation_id=self.id, target=target)
        if existing.status != SkillInvocationStatus.STARTED:
            raise ValidationError("invocation_id", "This skill invocation has already finished")
        self.target = target


async def resolve_invoked_skill(
    session: AsyncSession,
    *,
    enabled_skill_ids: list[str],
    invoked_skill_id: UUID | None,
    executable_tools: frozenset[str],
    surface: SkillSurface,
    agent_id: UUID,
    user_id: UUID,
    organization_id: UUID,
    session_id: UUID | None,
    invocation: InvocationRun,
    channel_id: UUID | None = None,
    trigger_message_id: UUID | None = None,
) -> ResolvedSkill | None:
    def target(skill: ResolvedSkill) -> InvocationTarget:
        return InvocationTarget(
            organization_id=organization_id,
            user_id=user_id,
            agent_id=agent_id,
            skill_id=skill.id,
            skill_version_id=skill.version_id,
            skill_version_number=skill.version_number,
            surface=surface,
            session_id=session_id,
            channel_id=channel_id,
            trigger_message_id=trigger_message_id,
        )

    try:
        skill = await resolve_skill_invocation(
            session,
            organization_id=organization_id,
            enabled_skill_ids=enabled_skill_ids,
            invoked_skill_id=invoked_skill_id,
            surface=surface,
            executable_tools=executable_tools,
        )
    except SkillInvocationError as exc:
        # Only an assigned, tenant-visible exact snapshot can be attributed on rejection.
        if isinstance(exc.skill, ResolvedSkill):
            await invocation.start(target(exc.skill))
            invocation.status = SkillInvocationStatus.REJECTED
            invocation.error_code = SkillInvocationErrorCode(exc.reason.value)
        raise
    if skill is not None:
        await invocation.start(target(skill))
    return skill
