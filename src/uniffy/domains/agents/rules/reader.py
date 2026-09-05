"""Builder reads and scoped rule lookup."""

from base64 import b64decode, urlsafe_b64encode
from binascii import Error as Base64Error
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.agents.rule import AgentRule, RuleStatus
from uniffy.core.models.agents.rule_version import AgentRuleVersion
from uniffy.domains.agents.access import require_agents_builder


def page_cursor(token: str) -> UUID | None:
    if not token:
        return None
    try:
        return UUID(bytes=b64decode(token, altchars=b"-_", validate=True))
    except (ValueError, Base64Error) as exc:
        raise ValidationError("page_token", "Invalid pagination cursor") from exc


def next_cursor(row_id: UUID) -> str:
    return urlsafe_b64encode(row_id.bytes).decode()


class RuleReader:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _load(self, organization_id: UUID, rule_id: UUID, *, lock: bool = False) -> AgentRule:
        query = select(AgentRule).where(
            AgentRule.id == rule_id,
            or_(AgentRule.organization_id == organization_id, AgentRule.organization_id.is_(None)),
        )
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        row = (await self._session.execute(query)).scalar_one_or_none()
        if row is None:
            raise NotFoundError("Rule", rule_id)
        return row

    async def get(self, user_id: UUID, organization_id: UUID, rule_id: UUID) -> AgentRule:
        await require_agents_builder(self._session, user_id, organization_id)
        return await self._load(organization_id, rule_id)

    async def list(
        self,
        user_id: UUID,
        organization_id: UUID,
        *,
        page_size: int = 200,
        page_token: str = "",
        include_retired: bool = False,
    ) -> tuple[list[AgentRule], str]:
        await require_agents_builder(self._session, user_id, organization_id)
        size = min(max(page_size or 200, 1), 500)
        query = (
            select(AgentRule)
            .options(defer(AgentRule.content))
            .where(
                or_(
                    AgentRule.organization_id == organization_id, AgentRule.organization_id.is_(None)
                )
            )
        )
        if not include_retired:
            query = query.where(AgentRule.status == RuleStatus.ACTIVE)
        cursor = page_cursor(page_token)
        if cursor is not None:
            query = query.where(AgentRule.id < cursor)
        rows = list(
            (
                await self._session.execute(query.order_by(AgentRule.id.desc()).limit(size + 1))
            ).scalars()
        )
        return rows[:size], next_cursor(rows[size - 1].id) if len(rows) > size else ""

    async def list_versions(
        self,
        user_id: UUID,
        organization_id: UUID,
        rule_id: UUID,
        *,
        page_size: int = 200,
        page_token: str = "",
    ) -> tuple[list[AgentRuleVersion], str]:
        await self.get(user_id, organization_id, rule_id)
        size = min(max(page_size or 200, 1), 500)
        query = select(AgentRuleVersion).where(AgentRuleVersion.rule_id == rule_id)
        cursor = page_cursor(page_token)
        if cursor is not None:
            query = query.where(AgentRuleVersion.id < cursor)
        rows = list(
            (
                await self._session.execute(
                    query.order_by(AgentRuleVersion.id.desc()).limit(size + 1)
                )
            ).scalars()
        )
        return rows[:size], next_cursor(rows[size - 1].id) if len(rows) > size else ""

    async def get_version(
        self,
        user_id: UUID,
        organization_id: UUID,
        rule_id: UUID,
        version_number: int,
    ) -> AgentRuleVersion:
        await self.get(user_id, organization_id, rule_id)
        return await self._version(rule_id, version_number)

    async def _version(self, rule_id: UUID, version_number: int) -> AgentRuleVersion:
        row = (
            await self._session.execute(
                select(AgentRuleVersion).where(
                    AgentRuleVersion.rule_id == rule_id,
                    AgentRuleVersion.version_number == version_number,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFoundError("Rule version", str(version_number))
        return row
