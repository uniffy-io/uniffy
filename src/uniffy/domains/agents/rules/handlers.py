"""ConnectRPC delivery for builder rule management."""

from uuid import UUID

from connectrpc.request import RequestContext
from uniffy_proto.agents.v1 import rules_pb2 as pb

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.rule import RuleStatus
from uniffy.domains.agents.rules.converters import rule_to_proto, version_to_proto
from uniffy.domains.agents.rules.operations import RuleOperations
from uniffy.domains.agents.rules.reader import RuleReader
from uniffy.domains.agents.rules.selection import RuleSelectionOperations
from uniffy.infrastructure.database import open_session


def _uuid(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise ValidationError("id", "Invalid identifier") from exc


class RulesHandlers:
    async def create_rule(
        self, request: pb.CreateRuleRequest, ctx: RequestContext
    ) -> pb.CreateRuleResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            row = await RuleOperations(session).create(
                user_id,
                org_id,
                name=request.name,
                display_name=request.display_name,
                description=request.description,
                content=request.content,
            )
            return pb.CreateRuleResponse(rule=rule_to_proto(row))

    async def get_rule(self, request: pb.GetRuleRequest, ctx: RequestContext) -> pb.GetRuleResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            row = await RuleReader(session).get(user_id, org_id, _uuid(request.rule_id))
            return pb.GetRuleResponse(rule=rule_to_proto(row))

    async def update_rule(
        self, request: pb.UpdateRuleRequest, ctx: RequestContext
    ) -> pb.UpdateRuleResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            row = await RuleOperations(session).update(
                user_id,
                org_id,
                _uuid(request.rule_id),
                display_name=request.display_name,
                description=request.description,
                content=request.content,
                change_summary=request.change_summary,
            )
            return pb.UpdateRuleResponse(rule=rule_to_proto(row))

    async def retire_rule(
        self, request: pb.RetireRuleRequest, ctx: RequestContext
    ) -> pb.RetireRuleResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            row = await RuleOperations(session).set_status(
                user_id, org_id, _uuid(request.rule_id), RuleStatus.RETIRED
            )
            return pb.RetireRuleResponse(rule=rule_to_proto(row))

    async def restore_rule(
        self, request: pb.RestoreRuleRequest, ctx: RequestContext
    ) -> pb.RestoreRuleResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            row = await RuleOperations(session).set_status(
                user_id, org_id, _uuid(request.rule_id), RuleStatus.ACTIVE
            )
            return pb.RestoreRuleResponse(rule=rule_to_proto(row))

    async def set_main_rule_version(
        self, request: pb.SetMainRuleVersionRequest, ctx: RequestContext
    ) -> pb.SetMainRuleVersionResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            row = await RuleOperations(session).set_main(
                user_id,
                org_id,
                _uuid(request.rule_id),
                version_number=request.version_number,
                follow_latest=request.follow_latest,
            )
            return pb.SetMainRuleVersionResponse(rule=rule_to_proto(row))

    async def revert_rule(
        self, request: pb.RevertRuleRequest, ctx: RequestContext
    ) -> pb.RevertRuleResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            row = await RuleOperations(session).revert(
                user_id, org_id, _uuid(request.rule_id), request.version_number
            )
            return pb.RevertRuleResponse(rule=rule_to_proto(row))

    async def get_rule_version(
        self, request: pb.GetRuleVersionRequest, ctx: RequestContext
    ) -> pb.GetRuleVersionResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            row = await RuleReader(session).get_version(
                user_id, org_id, _uuid(request.rule_id), request.version_number
            )
            return pb.GetRuleVersionResponse(version=version_to_proto(row))

    async def list_rules(
        self, request: pb.ListRulesRequest, ctx: RequestContext
    ) -> pb.ListRulesResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            rows, token = await RuleReader(session).list(
                user_id,
                org_id,
                page_size=request.page_size,
                page_token=request.page_token,
                include_retired=request.include_retired,
            )
            return pb.ListRulesResponse(
                rules=[rule_to_proto(row, include_content=False) for row in rows],
                next_page_token=token,
            )

    async def list_rule_versions(
        self, request: pb.ListRuleVersionsRequest, ctx: RequestContext
    ) -> pb.ListRuleVersionsResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            rows, token = await RuleReader(session).list_versions(
                user_id,
                org_id,
                _uuid(request.rule_id),
                page_size=request.page_size,
                page_token=request.page_token,
            )
            return pb.ListRuleVersionsResponse(
                versions=[version_to_proto(row) for row in rows], next_page_token=token
            )

    async def get_enabled_rules(
        self, request: pb.GetEnabledRulesRequest, ctx: RequestContext
    ) -> pb.GetEnabledRulesResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            ids = await RuleSelectionOperations(session).get(
                user_id, org_id, _uuid(request.agent_id)
            )
            return pb.GetEnabledRulesResponse(rule_ids=ids)

    async def set_enabled_rules(
        self, request: pb.SetEnabledRulesRequest, ctx: RequestContext
    ) -> pb.SetEnabledRulesResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            ids = await RuleSelectionOperations(session).set(
                user_id,
                org_id,
                _uuid(request.agent_id),
                list(request.rule_ids),
            )
            return pb.SetEnabledRulesResponse(rule_ids=ids)
