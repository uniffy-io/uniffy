"""Builder mutations for versioned rule definitions."""

from uuid import UUID

from sqlalchemy.exc import IntegrityError

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import ConflictError, PermissionDeniedError
from uniffy.core.models.agents.rule import AgentRule, RuleSource, RuleStatus
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.domains.agents.access import require_agents_builder
from uniffy.domains.agents.rules.reader import RuleReader
from uniffy.domains.agents.rules.resolution import invalidate_rules
from uniffy.domains.agents.rules.validation import clean_rule_fields
from uniffy.domains.agents.rules.versions import stage_rule_version


class RuleOperations(RuleReader):
    async def _editable(self, user_id: UUID, organization_id: UUID, rule_id: UUID) -> AgentRule:
        await require_agents_builder(self._session, user_id, organization_id)
        rule = await self._load(organization_id, rule_id, lock=True)
        if rule.source == RuleSource.BUNDLED:
            raise PermissionDeniedError("edit bundled rule")
        return rule

    async def _finish(self, rule: AgentRule, user_id: UUID, action: Action) -> AgentRule:
        await write_audit_event(
            self._session,
            organization_id=rule.organization_id,
            actor_user_id=user_id,
            action=action,
            resource_type=AuditResourceType.RULE,
            resource_id=rule.id,
            details={"version_number": rule.latest_version_number},
        )
        try:
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise ConflictError("Rule", "A rule with this name already exists") from exc
        await invalidate_rules(rule.organization_id)
        return rule

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        *,
        name: str,
        display_name: str,
        description: str,
        content: str,
    ) -> AgentRule:
        await require_agents_builder(self._session, user_id, organization_id)
        fields = clean_rule_fields(
            name=name, display_name=display_name, description=description, content=content
        )
        rule = AgentRule(
            organization_id=organization_id,
            source=RuleSource.ORGANIZATION,
            latest_version_number=0,
            **fields,
        )
        self._session.add(rule)
        try:
            await self._session.flush()
            await stage_rule_version(self._session, rule, author_id=user_id)
        except IntegrityError as exc:
            await self._session.rollback()
            raise ConflictError("Rule", "A rule with this name already exists") from exc
        return await self._finish(rule, user_id, Action.AGENT_RULE_CREATED)

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        rule_id: UUID,
        *,
        display_name: str,
        description: str,
        content: str,
        change_summary: str = "",
    ) -> AgentRule:
        rule = await self._editable(user_id, organization_id, rule_id)
        fields = clean_rule_fields(
            name=rule.name, display_name=display_name, description=description, content=content
        )
        if any(getattr(rule, key) != value for key, value in fields.items()):
            for key, value in fields.items():
                setattr(rule, key, value)
            await stage_rule_version(
                self._session, rule, author_id=user_id, change_summary=change_summary
            )
        return await self._finish(rule, user_id, Action.AGENT_RULE_UPDATED)

    async def set_status(
        self,
        user_id: UUID,
        organization_id: UUID,
        rule_id: UUID,
        status: RuleStatus,
    ) -> AgentRule:
        rule = await self._editable(user_id, organization_id, rule_id)
        rule.status = status
        return await self._finish(rule, user_id, Action.AGENT_RULE_UPDATED)

    async def set_main(
        self,
        user_id: UUID,
        organization_id: UUID,
        rule_id: UUID,
        *,
        version_number: int,
        follow_latest: bool,
    ) -> AgentRule:
        rule = await self._editable(user_id, organization_id, rule_id)
        version = await self._version(
            rule_id, rule.latest_version_number if follow_latest else version_number
        )
        rule.active_version_id = version.id
        rule.active_version_pinned = not follow_latest
        return await self._finish(rule, user_id, Action.AGENT_RULE_UPDATED)

    async def revert(
        self,
        user_id: UUID,
        organization_id: UUID,
        rule_id: UUID,
        version_number: int,
    ) -> AgentRule:
        rule = await self._editable(user_id, organization_id, rule_id)
        version = await self._version(rule_id, version_number)
        for field in ("name", "display_name", "description", "content"):
            setattr(rule, field, getattr(version, field))
        await stage_rule_version(self._session, rule, author_id=user_id)
        return await self._finish(rule, user_id, Action.AGENT_RULE_UPDATED)
