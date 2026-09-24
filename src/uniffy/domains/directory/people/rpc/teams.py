from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.people.v1 import people_pb as pb

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.domains.directory.groups import teams as team_ops
from uniffy.domains.directory.people.converters import team_node_to_proto
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="directory.people.rpc.teams")


class TeamHandlers:
    async def list_teams(
        self,
        request: pb.ListTeamsRequest,
        ctx: RequestContext,
    ) -> pb.ListTeamsResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(user_id, org_id)
                nodes = await team_ops.list_team_nodes(session, org_id)
            return pb.ListTeamsResponse(teams=[team_node_to_proto(node) for node in nodes])
        except ConnectError:
            raise
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except Exception as exc:
            logger.exception(f"Error listing teams: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_team(
        self,
        request: pb.GetTeamRequest,
        ctx: RequestContext,
    ) -> pb.GetTeamResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

        try:
            group_id = UUID(request.group_id)
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(user_id, org_id)
                node, member_ids = await team_ops.get_team(session, org_id, group_id)
            return pb.GetTeamResponse(team=team_node_to_proto(node), member_user_ids=member_ids)
        except ConnectError:
            raise
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except (ValidationError, ValueError) as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            logger.exception(f"Error fetching team: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_team(
        self,
        request: pb.UpdateTeamRequest,
        ctx: RequestContext,
    ) -> pb.UpdateTeamResponse:
        user_id = current_user_id()
        org_id = resolve_organization_id(request.organization_id)

        try:
            group_id = UUID(request.group_id)
            if request.clear_lead:
                lead: UUID | None | object = None
            elif request.has_field("lead_user_id"):
                lead = UUID(request.lead_user_id)
            else:
                lead = team_ops.UNSET
            if request.clear_parent:
                parent: UUID | None | object = None
            elif request.has_field("parent_group_id"):
                parent = UUID(request.parent_group_id)
            else:
                parent = team_ops.UNSET

            async with open_session() as session:
                await OrganizationOperations(session).require_org_admin(user_id, org_id)
                node = await team_ops.update_team(
                    session,
                    self.search_indexer,
                    org_id,
                    user_id,
                    group_id,
                    lead_user_id=lead,
                    parent_group_id=parent,
                )
            return pb.UpdateTeamResponse(team=team_node_to_proto(node))
        except ConnectError:
            raise
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except (ValidationError, ValueError) as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            logger.exception(f"Error updating team: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
