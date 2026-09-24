from uuid import UUID

from connectrpc.request import RequestContext
from protobuf import Oneof
from uniffy_proto.agents.v1 import skill_evaluations_pb as proto

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.errors import ValidationError
from uniffy.domains.agents.skills.evaluations.access import EvaluationScope, EvaluationTarget
from uniffy.domains.agents.skills.evaluations.cases import EvaluationCases
from uniffy.domains.agents.skills.evaluations.converters import case_to_proto, run_to_proto
from uniffy.domains.agents.skills.evaluations.operations import EvaluationOperations
from uniffy.domains.agents.skills.evaluations.reader import EvaluationReader
from uniffy.infrastructure.database import open_session


def parse_id(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise ValidationError("id", "Invalid evaluation identifier") from exc


def parse_scope(scope: proto.EvaluationScope | None) -> EvaluationScope:
    match scope.scope if scope is not None else None:
        case Oneof(field="skill_id", value=identifier):
            return EvaluationScope(skill_id=parse_id(identifier))
        case Oneof(field="draft_id", value=identifier):
            return EvaluationScope(draft_id=parse_id(identifier))
        case _:
            raise ValidationError("scope", "Select one skill or pending draft")


def parse_target(target: proto.EvaluationTarget | None) -> EvaluationTarget:
    if target is None:
        raise ValidationError("target", "Select one skill version or pending draft")
    draft_content = target.draft_content if target.has_field("draft_content") else None
    match target.target:
        case Oneof(field="skill_version_id", value=identifier):
            return EvaluationTarget(
                skill_version_id=parse_id(identifier), draft_content=draft_content
            )
        case Oneof(field="draft_id", value=identifier):
            return EvaluationTarget(draft_id=parse_id(identifier), draft_content=draft_content)
        case _:
            raise ValidationError("target", "Select one skill version or pending draft")


def parse_fields(fields: proto.EvaluationCaseFields | None) -> dict:
    if fields is None:
        fields = proto.EvaluationCaseFields()
    return {
        "name": fields.name,
        "input": fields.input,
        "rubric": fields.rubric,
        "expected_tools": list(fields.expected_tools),
        "forbidden_tools": list(fields.forbidden_tools),
        "fixtures": [
            {
                "tool_name": fixture.tool_name,
                "response": fixture.response,
                "is_error": fixture.is_error,
            }
            for fixture in fields.fixtures
        ],
    }


class SkillEvaluationHandlers:
    async def create_case(
        self, request: proto.CreateCaseRequest, ctx: RequestContext
    ) -> proto.CreateCaseResponse:
        organization_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            case = await EvaluationCases(session).create(
                user_id=current_user_id(),
                organization_id=organization_id,
                scope=parse_scope(request.scope),
                fields=parse_fields(request.fields),
            )
            return proto.CreateCaseResponse(evaluation_case=case_to_proto(case))

    async def update_case(
        self, request: proto.UpdateCaseRequest, ctx: RequestContext
    ) -> proto.UpdateCaseResponse:
        organization_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            case = await EvaluationCases(session).update(
                user_id=current_user_id(),
                organization_id=organization_id,
                case_id=parse_id(request.case_id),
                fields=parse_fields(request.fields),
            )
            return proto.UpdateCaseResponse(evaluation_case=case_to_proto(case))

    async def delete_case(
        self, request: proto.DeleteCaseRequest, ctx: RequestContext
    ) -> proto.DeleteCaseResponse:
        organization_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            await EvaluationCases(session).delete(
                user_id=current_user_id(),
                organization_id=organization_id,
                case_id=parse_id(request.case_id),
            )
        return proto.DeleteCaseResponse()

    async def list_cases(
        self, request: proto.ListCasesRequest, ctx: RequestContext
    ) -> proto.ListCasesResponse:
        organization_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            cases = await EvaluationCases(session).list(
                user_id=current_user_id(),
                organization_id=organization_id,
                scope=parse_scope(request.scope),
            )
            return proto.ListCasesResponse(cases=[case_to_proto(case) for case in cases])

    async def run_case(
        self, request: proto.RunCaseRequest, ctx: RequestContext
    ) -> proto.RunCaseResponse:
        if len(request.case_ids) != 1:
            raise ValidationError("cases", "Select exactly one evaluation case")
        return proto.RunCaseResponse(runs=await self._run(request))

    async def run_suite(
        self, request: proto.RunSuiteRequest, ctx: RequestContext
    ) -> proto.RunSuiteResponse:
        return proto.RunSuiteResponse(runs=await self._run(request))

    async def _run(
        self, request: proto.RunCaseRequest | proto.RunSuiteRequest
    ) -> list[proto.EvaluationRun]:
        organization_id = resolve_organization_id(request.organization_id)
        target = parse_target(request.target)
        async with open_session() as session:
            runs = await EvaluationOperations(session).request(
                user_id=current_user_id(),
                organization_id=organization_id,
                request_id=parse_id(request.request_id),
                agent_id=parse_id(request.agent_id),
                target=target,
                case_ids=[parse_id(value) for value in request.case_ids],
                judge=request.judge,
                model_override=request.model_override,
                judge_model=request.judge_model,
            )
            return [run_to_proto(run) for run in runs]

    async def list_runs(
        self, request: proto.ListRunsRequest, ctx: RequestContext
    ) -> proto.ListRunsResponse:
        organization_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            runs, cursor = await EvaluationReader(session).list(
                user_id=current_user_id(),
                organization_id=organization_id,
                agent_id=parse_id(request.agent_id),
                scope=parse_scope(request.scope),
                page_size=request.page_size,
                cursor=request.cursor,
            )
            return proto.ListRunsResponse(
                runs=[run_to_proto(run) for run in runs], next_cursor=cursor
            )

    async def get_run(
        self, request: proto.GetRunRequest, ctx: RequestContext
    ) -> proto.GetRunResponse:
        organization_id = resolve_organization_id(request.organization_id)
        async with open_session() as session:
            run = await EvaluationReader(session).get(
                user_id=current_user_id(),
                organization_id=organization_id,
                run_id=parse_id(request.run_id),
            )
            return proto.GetRunResponse(run=run_to_proto(run))
